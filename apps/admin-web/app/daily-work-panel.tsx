"use client";
import MaterialRows from "./material-rows";
import { useEffect, useState } from "react";
import {
  DAILY_WORK_STATUSES,
  DailyWork,
  DailyWorkInput,
  Site,
  WorkerSummary,
  workMinutes,
} from "@jongno/shared";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const duration = (minutes: number | null) =>
  minutes === null ? "—" : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, init);
  const b = await r.json();
  if (!r.ok) throw Error(b.message || "요청 실패");
  return b;
}
export default function DailyWorkPanel({
  siteId,
  workerId,
}: {
  siteId?: string;
  workerId?: string;
}) {
  const [rows, setRows] = useState<DailyWork[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [form, setForm] = useState<DailyWorkInput | null>(null);
  const [selected, setSelected] = useState<DailyWork | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    const q = new URLSearchParams();
    if (siteId) q.set("siteId", siteId);
    if (workerId) q.set("workerId", workerId);
    Promise.all([
      api<DailyWork[]>(`daily-work?${q}`, { signal: c.signal }),
      api<Site[]>("sites", { signal: c.signal }),
      api<WorkerSummary[]>("workers?includeDeleted=true", { signal: c.signal }),
    ])
      .then(([r, s, w]) => {
        setRows(r);
        setSites(s);
        setWorkers(w);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [siteId, workerId, revision]);
  function edit(work?: DailyWork) {
    setSelected(work ?? null);
    setForm(
      work
        ? {
            workDate: work.workDate,
            siteId: work.siteId,
            managerId: work.managerId,
            participantIds: work.participants.map((p) => p.workerId),
            startTime: work.startTime,
            endTime: work.endTime,
            content: work.content,
            notes: work.notes,
            status: work.status,
            materials: work.materials.map(m=>({...m})),
          }
        : {
            workDate: today(),
            siteId: siteId ?? "",
            managerId: "",
            participantIds: [],
            startTime: "",
            endTime: "",
            content: "",
            notes: "",
            status: "작업예정",
            materials: [],
          },
    );
    setError("");
    setNotice("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`daily-work${selected ? "/" + selected.id : ""}`, {
        method: selected ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm(null);
      setSelected(null);
      setRevision((v) => v + 1);
      setNotice("일일작업을 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  async function clock(work: DailyWork, action: "start" | "finish") {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`daily-work/${work.id}/${action}`, { method: "POST" });
      setRevision((v) => v + 1);
      setNotice(
        action === "start"
          ? "현재 시각으로 작업을 시작했습니다."
          : "현재 시각으로 작업을 종료했습니다.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "시각 기록 실패");
    } finally {
      setSaving(false);
    }
  }
  const selectable = workers.filter(
    (w) =>
      !w.deletedAt ||
      selected?.managerId === w.id ||
      selected?.participants.some((p) => p.workerId === w.id),
  );
  const minutes = form ? workMinutes(form.startTime, form.endTime) : null;
  return (
    <div className="sites-workspace daily-work-workspace">
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          {!form && (
            <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
          )}
        </div>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      {form ? (
        <section className="panel site-form">
          <div className="panel-title">
            <div>
              <h2>{selected ? "일일작업 수정" : "새 일일작업 등록"}</h2>
              <p>
                서울 시간 기준 · 당일 작업 기록입니다. 야간 작업은 날짜별로
                분리해 주세요.
              </p>
            </div>
          </div>
          <form onSubmit={save}>
            <fieldset disabled={saving}>
              <div className="form-grid">
                <label>
                  작업일자 *
                  <input
                    aria-label="작업일자"
                    type="date"
                    required
                    value={form.workDate}
                    onChange={(e) =>
                      setForm({ ...form, workDate: e.target.value })
                    }
                  />
                </label>
                <label>
                  현장 *
                  <select
                    aria-label="현장"
                    required
                    value={form.siteId}
                    disabled={!!siteId}
                    onChange={(e) => {
                      const site = sites.find((s) => s.id === e.target.value);
                      const manager = workers.find(
                        (w) => w.id === site?.managerId && !w.deletedAt,
                      );
                      setForm({
                        ...form,
                        siteId: e.target.value,
                        managerId: manager?.id ?? "",
                      });
                    }}
                  >
                    <option value="">현장 선택</option>
                    {sites.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  대표 작업진행자 *
                  <select
                    aria-label="대표 작업진행자"
                    required
                    value={form.managerId}
                    onChange={(e) =>
                      setForm({ ...form, managerId: e.target.value })
                    }
                  >
                    <option value="">대표 작업진행자 선택</option>
                    {selectable.map((w) => (
                      <option
                        disabled={!!w.deletedAt && selected?.managerId !== w.id}
                        value={w.id}
                        key={w.id}
                      >
                        {w.displayName}
                        {w.deletedAt ? " (삭제됨 · 기존 참여 유지)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="participant-fieldset full-width">
                  <legend>참여 작업자 (여러 명 선택)</legend>
                  <div className="participant-options">
                    {selectable.map((w) => (
                      <label key={w.id}>
                        <input
                          type="checkbox"
                          disabled={
                            !!w.deletedAt &&
                            !selected?.participants.some(
                              (p) => p.workerId === w.id,
                            )
                          }
                          checked={form.participantIds.includes(w.id)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              participantIds: e.target.checked
                                ? [...form.participantIds, w.id]
                                : form.participantIds.filter(
                                    (id) => id !== w.id,
                                  ),
                            })
                          }
                        />
                        {w.displayName}
                        {w.deletedAt ? " (삭제됨)" : ""}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  시작시간
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm({ ...form, startTime: e.target.value })
                    }
                  />
                </label>
                <label>
                  종료시간
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) =>
                      setForm({ ...form, endTime: e.target.value })
                    }
                  />
                </label>
                <p className="full-width">
                  총 작업시간:{" "}
                  {minutes !== null && minutes < 0
                    ? "종료시간을 확인해 주세요."
                    : duration(minutes)}{" "}
                  (휴게시간 공제 없음)
                </p>
                <label className="full-width">
                  작업내용
                  <textarea
                    rows={4}
                    maxLength={5000}
                    value={form.content}
                    onChange={(e) =>
                      setForm({ ...form, content: e.target.value })
                    }
                  />
                </label>
                <label className="full-width">
                  특이사항
                  <textarea
                    rows={2}
                    maxLength={5000}
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                  />
                </label>
                <label>
                  상태
                  <select
                    aria-label="상태"
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value as DailyWorkInput["status"],
                      })
                    }
                  >
                    {DAILY_WORK_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <MaterialRows rows={form.materials??[]} onChange={materials=>setForm({...form,materials})}/>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setForm(null);
                    setSelected(null);
                    setError("");
                  }}
                >
                  취소
                </button>
                <button className="primary-button" type="submit">
                  {saving ? "저장 중…" : "저장"}
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      ) : (
        <section className="panel site-list">
          <div className="panel-title">
            <div>
              <h2>
                {siteId
                  ? "현장 일일작업"
                  : workerId
                    ? "참여 일일작업 이력"
                    : "일일작업 목록"}
              </h2>
              <p>총 {rows.length}건 · 사진 등록은 다음 단계 · 사용자재는 상세·수정에서 관리</p>
            </div>
            <button
              disabled={loading}
              className="primary-button"
              onClick={() => edit()}
            >
              ＋ 새 일일작업 등록
            </button>
          </div>
          <div className="site-filters">
            <label>
              작업 상태 필터
              <select
                aria-label="작업 상태 필터"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">전체 상태</option>
                {DAILY_WORK_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <p className="empty" role="status">
              불러오는 중입니다…
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "작업일자",
                      "현장명",
                      "대표 작업진행자",
                      "참여 작업자",
                      "시작시간",
                      "종료시간",
                      "총 작업시간",
                      "작업내용 요약",
                      "사용자재 건수",
                      "작업 전 사진 수",
                      "작업 후 사진 수",
                      "상태",
                      "관리",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((w) => !filter || w.status === filter)
                    .map((w) => (
                      <tr key={w.id}>
                        <td>{w.workDate}</td>
                        <td>{w.siteName}</td>
                        <td>{w.managerDisplayName}</td>
                        <td className="description-cell">
                          {w.participants
                            .map((p) => p.displayName)
                            .join(", ") || "없음"}
                        </td>
                        <td>{w.startTime || "—"}</td>
                        <td>{w.endTime || "—"}</td>
                        <td>{duration(w.totalMinutes)}</td>
                        <td className="description-cell" title={w.content}>
                          {w.content.length > 80
                            ? w.content.slice(0, 80) + "…"
                            : w.content || "미입력"}
                        </td>
                        <td>{w.materialCount}</td>
                        <td>{w.beforePhotoCount}</td>
                        <td>{w.afterPhotoCount}</td>
                        <td>
                          <span className="badge">{w.status}</span>
                        </td>
                        <td>
                          <div className="worker-actions">
                            <button
                              className="text-button"
                              onClick={() => edit(w)}
                            >
                              상세·수정
                            </button>
                            {w.status === "작업예정" && (
                              <button
                                className="secondary-button"
                                disabled={saving || w.workDate !== today()}
                                onClick={() => clock(w, "start")}
                              >
                                작업 시작
                              </button>
                            )}
                            {w.status === "작업중" && (
                              <button
                                className="primary-button"
                                disabled={saving || w.workDate !== today()}
                                onClick={() => clock(w, "finish")}
                              >
                                작업 종료
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!rows.filter((w) => !filter || w.status === filter).length && (
                <p className="empty">일일작업 기록이 없습니다.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
