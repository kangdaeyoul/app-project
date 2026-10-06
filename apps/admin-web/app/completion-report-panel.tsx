"use client";
import { useEffect, useRef, useState } from "react";
import {
  COMPLETION_REPORT_TYPES,
  CompletionReportInput,
  CompletionReportSource,
} from "@jongno/shared";
import PdfPreview from "./pdf-preview";
export default function CompletionReportPanel({ siteId }: { siteId: string }) {
  const [source, setSource] = useState<CompletionReportSource | null>(null);
  const [form, setForm] = useState<CompletionReportInput | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false);
  const url = useRef(""),
    version = useRef(0);
  function clear() {
    version.current++;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    setPreview("");
    setNotice("");
  }
  function change(patch: Partial<CompletionReportInput>) {
    clear();
    setForm((f) => (f ? { ...f, ...patch } : f));
  }
  async function load(signal?: AbortSignal) {
    try {
      const r = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/completion-reports/source`,
        { signal },
      );
      if (!r.ok) throw Error("완료보고서 정보를 불러오지 못했습니다.");
      const s: CompletionReportSource = await r.json();
      if (signal?.aborted) return;
      clear();
      setSource(s);
      setForm(s.defaults);
      setError("");
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => {
      c.abort();
      version.current++;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, [siteId]);
  async function render(download: boolean) {
    if (!form || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const current = version.current;
    try {
      const r = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/completion-reports/${download ? "generate" : "preview"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      if (!r.ok) {
        const b = await r.json();
        throw Error(b.message || "완료보고서 생성 실패");
      }
      const blob = await r.blob();
      if (current !== version.current) return;
      if (blob.type !== "application/pdf" || !blob.size)
        throw Error("PDF 파일을 확인할 수 없습니다.");
      const objectUrl = URL.createObjectURL(blob);
      if (download) {
        const name = r.headers
          .get("Content-Disposition")
          ?.match(/filename\*=UTF-8''(.+)$/)?.[1];
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = name ? decodeURIComponent(name) : "완료보고서.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        setNotice("완료보고서 PDF를 다운로드했습니다.");
      } else {
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = objectUrl;
        setPreview(objectUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 생성 실패");
    } finally {
      setBusy(false);
    }
  }
  if (!source || !form)
    return (
      <section>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : (
          <p>완료보고서 정보를 불러오는 중…</p>
        )}
      </section>
    );
  const photos = source.photos.filter(
    (p) => !form.photoType || p.type === form.photoType,
  );
  const count =
    form.photoSelection === "전체 사진"
      ? photos.length
      : photos.filter((p) => form.photoIds.includes(p.id)).length;
  const texts = [
    ["title", "공사명 또는 보수명"],
    ["purpose", "작업 목적"],
    ["summary", "작업 내용 요약"],
    ["notes", "특이사항"],
    ["opinion", "종합 의견"],
    ["followUp", "추가 보완 필요사항"],
  ] as const;
  return (
    <section className="report-panel completion-report">
      <div className="panel-title">
        <div>
          <h3>완료보고서 PDF</h3>
          <p>현장 작업내역과 사용자재·사진을 불러와 보고서를 작성합니다.</p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("작성한 내용을 현장 기록으로 다시 불러올까요?"))
              load();
          }}
        >
          현장 기록 다시 불러오기
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="report-options">
        <div className="form-grid">
          <label>
            문서종류
            <select
              aria-label="문서종류"
              value={form.documentType}
              onChange={(e) =>
                change({
                  documentType: e.target
                    .value as CompletionReportInput["documentType"],
                })
              }
            >
              {COMPLETION_REPORT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            현장
            <input readOnly value={source.site.name} />
          </label>
          <label>
            보고서 작성일
            <input
              type="date"
              value={form.createdDate}
              onChange={(e) => change({ createdDate: e.target.value })}
            />
          </label>
          <label>
            작업기간 시작
            <input
              type="date"
              value={form.periodStart}
              onChange={(e) => change({ periodStart: e.target.value })}
            />
          </label>
          <label>
            작업기간 종료
            <input
              type="date"
              value={form.periodEnd}
              onChange={(e) => change({ periodEnd: e.target.value })}
            />
          </label>
          <label>
            대표 작업진행자
            <select
              aria-label="대표 작업진행자"
              value={form.managerId}
              onChange={(e) => change({ managerId: e.target.value })}
            >
              <option value="">미배정</option>
              {source.workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.displayName}
                </option>
              ))}
            </select>
          </label>
          {texts.map(([key, label]) => (
            <label className="full-width" key={key}>
              {label}
              <textarea
                aria-label={label}
                rows={key === "summary" ? 4 : 2}
                maxLength={key === "title" ? 300 : 5000}
                value={form[key]}
                onChange={(e) => change({ [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <h4>참여 작업자</h4>
        <div className="report-checks">
          {source.workers.map((w) => (
            <label key={w.id}>
              <input
                type="checkbox"
                checked={form.participantIds.includes(w.id)}
                onChange={(e) =>
                  change({
                    participantIds: e.target.checked
                      ? [...form.participantIds, w.id]
                      : form.participantIds.filter((id) => id !== w.id),
                  })
                }
              />
              {w.displayName}
            </label>
          ))}
        </div>
        <h4>날짜별 작업내역 · 수동 수정 가능</h4>
        <div className="form-grid">
          {form.days.length ? (
            form.days.map((d, i) => (
              <label className="full-width" key={d.dailyWorkId}>
                {d.date} · {d.dailyWorkId}
                <textarea
                  aria-label={`${d.date} 작업내용`}
                  rows={2}
                  maxLength={5000}
                  value={d.content}
                  onChange={(e) =>
                    change({
                      days: form.days.map((day, n) =>
                        n === i ? { ...day, content: e.target.value } : day,
                      ),
                    })
                  }
                />
              </label>
            ))
          ) : (
            <p>등록된 일일작업이 없습니다.</p>
          )}
        </div>
        <h4>사용자재 요약 · 현장 전체 기록 기준</h4>
        {source.materials.length ? (
          <ul>
            {source.materials.map((m, i) => (
              <li key={i}>
                {m.name} {m.specification} {m.quantity}
                {m.unit}
              </li>
            ))}
          </ul>
        ) : (
          <p>등록된 사용자재가 없습니다.</p>
        )}
        <h4>사진 출력 옵션</h4>
        <div className="form-grid">
          <label>
            사진 구분
            <select
              aria-label="사진 구분"
              value={form.photoType}
              onChange={(e) =>
                change({
                  photoType: e.target
                    .value as CompletionReportInput["photoType"],
                  photoIds: [],
                })
              }
            >
              <option value="">작업 전/후 모두 포함</option>
              <option value="작업 전">작업 전 사진만 포함</option>
              <option value="작업 후">작업 후 사진만 포함</option>
            </select>
          </label>
          <label>
            사진 출력형식
            <select
              aria-label="사진 출력형식"
              value={form.photoLayout}
              onChange={(e) =>
                change({
                  photoLayout: e.target
                    .value as CompletionReportInput["photoLayout"],
                })
              }
            >
              <option value="사진대지">사진대지 형식으로 포함</option>
              <option value="사진 목록">사진 목록으로 포함</option>
            </select>
          </label>
          <label>
            사진 선택
            <select
              aria-label="사진 선택"
              value={form.photoSelection}
              onChange={(e) =>
                change({
                  photoSelection: e.target
                    .value as CompletionReportInput["photoSelection"],
                  photoIds: [],
                })
              }
            >
              <option>전체 사진</option>
              <option>선택한 사진만</option>
            </select>
          </label>
        </div>
        {form.photoSelection === "선택한 사진만" && (
          <div className="report-selection">
            {photos.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  aria-label={`${p.originalFilename} 완료보고서 포함`}
                  checked={form.photoIds.includes(p.id)}
                  onChange={(e) =>
                    change({
                      photoIds: e.target.checked
                        ? [...form.photoIds, p.id]
                        : form.photoIds.filter((id) => id !== p.id),
                    })
                  }
                />
                <img src={p.url} alt={p.description} />
                <span>
                  {p.workDate} · {p.type}
                  <br />
                  {p.location} · {p.description}
                </span>
              </label>
            ))}
          </div>
        )}
        <p>
          사진 {count}장 포함 · 원본 사진과 일일작업 기록은 변경하지 않습니다.
        </p>
      </fieldset>
      <div className="form-actions">
        <button
          className="secondary-button"
          disabled={busy || (form.photoSelection === "선택한 사진만" && !count)}
          onClick={() => render(false)}
        >
          {busy ? "PDF 준비 중…" : "완료보고서 미리보기"}
        </button>
        <button
          className="primary-button"
          disabled={busy || !preview}
          onClick={() => render(true)}
        >
          완료보고서 PDF 생성
        </button>
      </div>
      {preview && (
        <div className="report-preview">
          <h4>완료보고서 미리보기</h4>
          <PdfPreview url={preview} />
          <a href={preview} target="_blank" rel="noreferrer">
            미리보기 새 창으로 열기
          </a>
        </div>
      )}
      {notice && (
        <p role="status" className="save-message">
          {notice}
        </p>
      )}
    </section>
  );
}
