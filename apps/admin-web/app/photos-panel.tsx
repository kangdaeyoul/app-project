"use client";
import { useEffect, useRef, useState } from "react";
import {
  PHOTO_TYPES,
  PhotoMetadata,
  PhotoType,
  PhotoView,
} from "@jongno/shared";
const emptyMeta = (): PhotoMetadata => ({
  location: "",
  description: "",
  capturedAt: null,
  uploadedBy: "샘플 관리자",
});
const captureLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "촬영일시 미입력";
function localDate(value: string | null) {
  if (!value) return "";
  const shifted = new Date(new Date(value).getTime() + 9 * 3600000);
  return shifted.toISOString().slice(0, 16);
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/photos${path}`, init);
  const b = await r.json();
  if (!r.ok) throw Error(b.message || "사진 요청 실패");
  return b;
}
export default function PhotosPanel({
  dailyWorkId,
  siteId,
  onChanged,
}: {
  dailyWorkId?: string;
  siteId?: string;
  onChanged?: () => void;
}) {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [type, setType] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [uploadType, setUploadType] = useState<PhotoType | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [editing, setEditing] = useState<PhotoView | null>(null);
  const [preview, setPreview] = useState<PhotoView | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    const q = new URLSearchParams();
    if (dailyWorkId) q.set("dailyWorkId", dailyWorkId);
    if (siteId) q.set("siteId", siteId);
    if (type) q.set("type", type);
    if (date) q.set("workDate", date);
    api<PhotoView[]>(`?${q}`, { signal: c.signal })
      .then(setPhotos)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [dailyWorkId, siteId, type, date, revision]);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview]);
  function beginUpload(t: PhotoType) {
    setUploadType(t);
    setFiles([]);
    setEditing(null);
    setMeta(emptyMeta());
    setError("");
    setNotice("");
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api(`/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(meta),
        });
      } else {
        if (!files.length) throw Error("사진 파일을 선택해 주세요.");
        const data = new FormData();
        data.set("dailyWorkId", dailyWorkId!);
        data.set("type", uploadType!);
        data.set("location", meta.location);
        data.set("description", meta.description);
        data.set("capturedAt", meta.capturedAt ?? "");
        data.set("uploadedBy", meta.uploadedBy);
        files.forEach((f) => data.append("files", f));
        await api("/upload", { method: "POST", body: data });
      }
      setUploadType(null);
      setEditing(null);
      setRevision((v) => v + 1);
      onChanged?.();
      setNotice("사진 정보를 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진 저장 실패");
    } finally {
      setSaving(false);
    }
  }
  async function remove(photo: PhotoView) {
    if (
      !window.confirm(
        "이 사진을 삭제하시겠습니까? 임시 원본 파일도 삭제됩니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await api(`/${photo.id}`, { method: "DELETE" });
      setRevision((v) => v + 1);
      onChanged?.();
      setNotice("사진을 삭제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }
  async function move(photo: PhotoView, offset: number) {
    const group = photos.filter((p) => p.type === photo.type);
    const i = group.findIndex((p) => p.id === photo.id);
    const target = i + offset;
    if (target < 0 || target >= group.length) return;
    [group[i], group[target]] = [group[target], group[i]];
    setSaving(true);
    setError("");
    try {
      await api("/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyWorkId,
          type: photo.type,
          ids: group.map((p) => p.id),
        }),
      });
      setRevision((v) => v + 1);
      setNotice("사진 순서를 변경했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "순서 변경 실패");
    } finally {
      setSaving(false);
    }
  }
  const groups = [...new Set(photos.map((p) => `${p.workDate}|${p.type}`))];
  return (
    <section className="photo-panel">
      <div className="panel-title">
        <div>
          <h3>작업 전·후 사진</h3>
          <p>임시 저장소 · 샘플 이미지는 실제 현장 사진이 아닙니다.</p>
        </div>
        {dailyWorkId && (
          <div className="worker-actions">
            {PHOTO_TYPES.map((t) => (
              <button
                type="button"
                className="secondary-button"
                key={t}
                disabled={saving}
                onClick={() => beginUpload(t)}
              >
                {t} 사진 추가
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            다시 시도
          </button>
        </div>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      {(uploadType || editing) && (
        <div className="photo-edit">
          <h4>{editing ? "사진 정보 수정" : `${uploadType} 사진 등록`}</h4>
          <div className="form-grid">
            {!editing && (
              <label className="full-width">
                사진 파일 (여러 장 선택)
                <input
                  aria-label="사진 파일"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                <small>PNG/JPEG/WebP · 장당 10MB · 한 번에 최대 20장</small>
                {files.length > 0 && (
                  <small>{files.map((f) => f.name).join(", ")}</small>
                )}
              </label>
            )}
            <label>
              작업 위치
              <input
                maxLength={300}
                value={meta.location}
                onChange={(e) => setMeta({ ...meta, location: e.target.value })}
              />
            </label>
            <label>
              등록자
              <input
                maxLength={300}
                value={meta.uploadedBy}
                onChange={(e) =>
                  setMeta({ ...meta, uploadedBy: e.target.value })
                }
              />
              <small>인증 전 단계의 수동 입력입니다.</small>
            </label>
            <label>
              촬영일시 (서울)
              <input
                type="datetime-local"
                value={localDate(meta.capturedAt)}
                onChange={(e) =>
                  setMeta({
                    ...meta,
                    capturedAt: e.target.value
                      ? `${e.target.value}:00+09:00`
                      : null,
                  })
                }
              />
              <small>
                실제 촬영 시각을 아는 경우 입력하세요. EXIF 자동 추출은 아직
                제공하지 않습니다.
              </small>
            </label>
            <label className="full-width">
              사진 설명
              <textarea
                aria-label="사진 설명"
                maxLength={5000}
                rows={2}
                value={meta.description}
                onChange={(e) =>
                  setMeta({ ...meta, description: e.target.value })
                }
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => {
                setUploadType(null);
                setEditing(null);
              }}
            >
              사진 입력 취소
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={save}
            >
              {saving ? "사진 저장 중…" : "사진 저장"}
            </button>
          </div>
        </div>
      )}
      <div className="site-filters">
        <label>
          사진 구분
          <select
            aria-label="사진 구분"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">전체</option>
            {PHOTO_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          작업일자 필터
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setDate("");
            setType("");
          }}
        >
          필터 초기화
        </button>
      </div>
      {loading ? (
        <p role="status">사진을 불러오는 중입니다…</p>
      ) : (
        <>
          {groups.map((key) => {
            const [workDate, category] = key.split("|");
            const list = photos.filter(
              (p) => p.workDate === workDate && p.type === category,
            );
            return (
              <div className="photo-group" key={key}>
                <h4>
                  {workDate} · {category} ({list.length})
                </h4>
                <div className="photo-grid">
                  {list.map((photo, i) => (
                    <article className="photo-card" key={photo.id}>
                      <button
                        type="button"
                        className="photo-thumb"
                        aria-label={`${photo.originalFilename} 크게 보기`}
                        onClick={() => setPreview(photo)}
                      >
                        <img
                          src={photo.url}
                          alt={
                            photo.description ||
                            `${photo.type} ${photo.location}`
                          }
                        />
                      </button>
                      <div className="photo-card-info">
                        <strong>{photo.location || "위치 미입력"}</strong>
                        <p>{photo.description || "설명 미입력"}</p>
                        <small>
                          {captureLabel(photo.capturedAt)} · {photo.uploadedBy}
                        </small>
                        <small>
                          {photo.originalFilename} · 순서 {photo.sortOrder + 1}
                          {photo.isSample ? " · 샘플" : ""}
                        </small>
                        {dailyWorkId && (
                          <div className="worker-actions">
                            <button
                              type="button"
                              className="text-button"
                              disabled={saving}
                              onClick={() => {
                                setEditing(photo);
                                setUploadType(null);
                                setMeta({
                                  location: photo.location,
                                  description: photo.description,
                                  capturedAt: photo.capturedAt,
                                  uploadedBy: photo.uploadedBy,
                                });
                              }}
                            >
                              정보 수정
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={saving}
                              onClick={() => remove(photo)}
                            >
                              사진 삭제
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              aria-label={`${photo.originalFilename} 앞으로`}
                              disabled={saving || i === 0 || !!date}
                              onClick={() => move(photo, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              aria-label={`${photo.originalFilename} 뒤로`}
                              disabled={
                                saving || i === list.length - 1 || !!date
                              }
                              onClick={() => move(photo, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
          {!photos.length && (
            <p className="empty">조건에 맞는 사진이 없습니다.</p>
          )}
        </>
      )}
      <dialog
        className="photo-preview"
        ref={dialog}
        onCancel={() => setPreview(null)}
        onClose={() => setPreview(null)}
        aria-label="사진 크게 보기"
      >
        {preview && (
          <>
            <button
              type="button"
              className="secondary-button"
              autoFocus
              onClick={() => setPreview(null)}
            >
              미리보기 닫기
            </button>
            <img
              src={preview.url}
              alt={preview.description || preview.originalFilename}
            />
            <p>
              {preview.workDate} · {preview.type} · {preview.location}
            </p>
            <p>
              {preview.description} · {captureLabel(preview.capturedAt)}
            </p>
            <small>
              등록자 {preview.uploadedBy} · 원본 {preview.originalFilename}
              <br />
              현장 {preview.siteId} · 일일작업 {preview.dailyWorkId}
              <br />
              저장소 키 {preview.storageKey}
            </small>
          </>
        )}
      </dialog>
    </section>
  );
}
