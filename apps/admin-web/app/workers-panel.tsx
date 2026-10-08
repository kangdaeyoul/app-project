"use client";
import { SettlementsPanel } from "./finance-panels";
import DailyWorkPanel from "./daily-work-panel";
import { useEffect, useState } from "react";
import {
  AVAILABILITY_STATUSES,
  AvailabilityStatus,
  WorkerDetail,
  WorkerInput,
  WorkerSummary,
} from "@jongno/shared";
const tabs = [
  "기본정보",
  "일정",
  "참여현장",
  "작업이력",
  "정산",
  "휴무·불가시간",
] as const;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const money = (n: number) => n.toLocaleString("ko-KR") + "원";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/workers${path}`, init);
  const b = await r.json();
  if (!r.ok) throw Error(b.message || "요청 실패");
  return b;
}
export default function WorkersPanel({onChanged,initialWorkerId}:{onChanged?:()=>void;initialWorkerId?:string}) {
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [form, setForm] = useState<WorkerInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("기본정보");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [date, setDate] = useState(today);
  const [availability, setAvailability] =
    useState<AvailabilityStatus>("근무가능");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(()=>{if(initialWorkerId)api<WorkerDetail>(`/${initialWorkerId}`).then(setDetail).catch(e=>setError(e.message))},[initialWorkerId]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    api<WorkerSummary[]>(`?month=${month}&includeDeleted=${archived}`, {
      signal: c.signal,
    })
      .then(setWorkers)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [month, archived, revision]);
  async function open(id: string) {
    setError("");
    try {
      setDetail(await api<WorkerDetail>(`/${id}?month=${month}`));
      setTab("기본정보");
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    }
  }
  function edit() {
    setEditing(detail?.id ?? null);
    setForm(
      detail
        ? {
            name: detail.name,
            displayName: detail.displayName,
            phone: detail.phone,
            role: detail.role,
            memo: detail.memo,
            defaultAvailability: detail.defaultAvailability,
          }
        : {
            name: "",
            displayName: "",
            phone: "",
            role: "",
            memo: "",
            defaultAvailability: "근무가능",
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
      const w = await api<WorkerSummary>(editing ? `/${editing}` : "", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setDetail(await api<WorkerDetail>(`/${w.id}?month=${month}`));
      setForm(null);
      setTab("기본정보");
      setRevision((v) => v + 1);
      setNotice("작업진행자 정보를 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  async function saveAvailability(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(`/${detail.id}/availability/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: availability }),
      });
      setDetail(await api<WorkerDetail>(`/${detail.id}?month=${month}`));
      setRevision((v) => v + 1);
      setNotice("날짜별 상태를 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    if (
      !detail ||
      !window.confirm(
        "선택 목록에서 삭제하시겠습니까? 기존 현장과 작업 기록은 보존됩니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await api(`/${detail.id}`, { method: "DELETE" });
      setDetail(await api<WorkerDetail>(`/${detail.id}?month=${month}`));
      setRevision((v) => v + 1);
      setNotice("삭제 처리했습니다. 기존 기록은 보존됩니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }
  const rows = workers.filter((w) =>
    `${w.name} ${w.displayName} ${w.phone}`.includes(search),
  );
  return (
    <div className="sites-workspace">
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
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
              <h2>{editing ? "작업진행자 수정" : "새 작업진행자 등록"}</h2>
              <p>
                이름과 표시명만 필수입니다. 역할은 업무 역할이며 로그인 권한과
                별개입니다.
              </p>
            </div>
          </div>
          <form onSubmit={save}>
            <fieldset disabled={saving}>
              <div className="form-grid">
                {(["name", "displayName", "phone", "role"] as const).map(
                  (key, i) => (
                    <label key={key}>
                      {["이름", "표시명", "연락처", "역할"][i]}
                      {i < 2 ? " *" : ""}
                      <input
                        aria-label={["이름", "표시명", "연락처", "역할"][i]}
                        type={key === "phone" ? "tel" : "text"}
                        required={i < 2}
                        maxLength={300}
                        value={form[key]}
                        onChange={(e) =>
                          setForm({ ...form, [key]: e.target.value })
                        }
                      />
                    </label>
                  ),
                )}
                <label className="full-width">
                  메모
                  <textarea
                    maxLength={5000}
                    rows={3}
                    value={form.memo}
                    onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  />
                </label>
                <label>
                  기본 작업 가능 상태
                  <select
                    aria-label="기본 작업 가능 상태"
                    value={form.defaultAvailability}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        defaultAvailability: e.target
                          .value as AvailabilityStatus,
                      })
                    }
                  >
                    {AVAILABILITY_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setForm(null)}
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
      ) : detail ? (
        <>
          <div className="site-toolbar">
            <button
              className="secondary-button"
              onClick={() => {
                setDetail(null);
                setNotice("");
              }}
            >
              ← 작업진행자 목록
            </button>
            <div className="worker-actions">
              {!detail.deletedAt && (
                <>
                  <button
                    className="secondary-button"
                    disabled={saving}
                    onClick={archive}
                  >
                    작업진행자 삭제
                  </button>
                  <button className="primary-button" onClick={edit}>
                    작업진행자 수정
                  </button>
                </>
              )}
            </div>
          </div>
          <section className="panel site-basic">
            <div className="panel-title">
              <div>
                <h2>{detail.displayName}</h2>
                <p>
                  {detail.name} · {detail.role || "역할 미입력"} ·{" "}
                  {detail.phone || "연락처 미입력"}
                </p>
              </div>
              <span className="badge">
                {detail.deletedAt ? "삭제됨 · 기록 보존" : detail.availability}
              </span>
            </div>
          </section>
          <section className="panel site-tabs">
            <div
              className="tab-list"
              role="tablist"
              aria-label="작업진행자 상세"
            >
              {tabs.map((t, i) => (
                <button
                  role="tab"
                  id={`worker-tab-${i}`}
                  aria-controls="worker-panel"
                  aria-selected={tab === t}
                  className={tab === t ? "selected" : ""}
                  key={t}
                  onClick={() => {
                    setTab(t);
                    if (t === "휴무·불가시간")
                      setAvailability(
                        detail.availabilityDates.find((a) => a.date === date)
                          ?.status ?? detail.defaultAvailability,
                      );
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div
              className="tab-content"
              role="tabpanel"
              id="worker-panel"
              aria-labelledby={`worker-tab-${tabs.indexOf(tab)}`}
            >
              <h3>{tab}</h3>
              {tab === "기본정보" ? (
                <dl className="info-grid">
                  {Object.entries({
                    이름: detail.name,
                    표시명: detail.displayName,
                    연락처: detail.phone,
                    역할: detail.role,
                    메모: detail.memo,
                    "기본 작업 가능 상태": detail.defaultAvailability,
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || "미입력"}</dd>
                    </div>
                  ))}
                </dl>
              ) : tab === "일정" || tab === "참여현장" ? (
                <>
                  {detail.sites.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>현장</th>
                            <th>일정</th>
                            <th>상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sites.map((s) => (
                            <tr key={s.id}>
                              <td>{s.name}</td>
                              <td>
                                {s.startDate} ~ {s.endDate || "미정"}
                              </td>
                              <td>{s.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>참여현장이 없습니다.</p>
                  )}
                  {tab === "일정" && (
                    <p>
                      현재 대표 배정 및 작업기록이 있는 현장의 공사기간입니다.
                      날짜별 근무가능 상태는 휴무·불가시간 탭에서 관리합니다.
                    </p>
                  )}
                </>
              ) : tab === "작업이력" ? (
                <DailyWorkPanel workerId={detail.id}/>
              ) : tab === "정산" ? (
                <SettlementsPanel workerId={detail.id} onChanged={()=>{api<WorkerDetail>(`/${detail.id}?month=${month}`).then(setDetail).catch(e=>setError(e.message));setRevision(v=>v+1);onChanged?.();}}/>
              ) : (
                <>
                  <p>
                    날짜별 상태가 기본 상태보다 우선합니다. 같은 날짜를 저장하면
                    기존 상태가 변경됩니다. 현재는 상태 안내만 제공하며 현장
                    배정을 자동 차단하지 않습니다.
                  </p>
                  {!detail.deletedAt && (
                    <form
                      className="availability-form"
                      onSubmit={saveAvailability}
                    >
                      <label>
                        날짜
                        <input
                          type="date"
                          required
                          value={date}
                          onChange={(e) => {
                            setDate(e.target.value);
                            setAvailability(
                              detail.availabilityDates.find(
                                (a) => a.date === e.target.value,
                              )?.status ?? detail.defaultAvailability,
                            );
                          }}
                        />
                      </label>
                      <label>
                        날짜별 상태
                        <select
                          aria-label="날짜별 상태"
                          value={availability}
                          onChange={(e) =>
                            setAvailability(
                              e.target.value as AvailabilityStatus,
                            )
                          }
                        >
                          {AVAILABILITY_STATUSES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <button className="primary-button" disabled={saving}>
                        상태 저장
                      </button>
                    </form>
                  )}
                  {detail.availabilityDates.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>날짜</th>
                          <th>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.availabilityDates.map((a) => (
                          <tr key={a.date}>
                            <td>{a.date}</td>
                            <td>{a.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p>
                      등록된 날짜별 상태가 없습니다. 기본 상태:{" "}
                      {detail.defaultAvailability}
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="panel site-list">
          <div className="panel-title">
            <div>
              <h2>작업진행자 목록</h2>
              <p>
                총 {rows.length}명 · 작업일수는 오늘까지 기록된 샘플 작업일 기준
              </p>
            </div>
            <button className="primary-button" onClick={edit}>
              ＋ 새 작업진행자 등록
            </button>
          </div>
          <div className="site-filters">
            <label>
              작업진행자 검색
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름, 표시명, 연락처"
              />
            </label>
            <label>
              조회 월
              <input
                type="month"
                required
                min="0001-01"
                value={month}
                onChange={(e) => {
                  if (e.target.value) setMonth(e.target.value);
                }}
              />
            </label>
            <label className="archive-filter">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              삭제된 작업진행자 포함
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
                      "이름",
                      "표시명",
                      "연락처",
                      "역할",
                      "작업 가능 여부",
                      "오늘 배정 현장 수",
                      "이번 달 작업일수",
                      "이번 달 지급예정액",
                      "미지급액",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id}>
                      <td>{w.name}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => open(w.id)}
                        >
                          {w.displayName}
                        </button>
                        {w.deletedAt && <small>삭제됨 · 기록 보존</small>}
                      </td>
                      <td>{w.phone || "미입력"}</td>
                      <td>{w.role || "미입력"}</td>
                      <td>{w.deletedAt ? "삭제됨" : w.availability}</td>
                      <td>{w.todaySiteCount}</td>
                      <td>{w.monthlyWorkDays}일</td>
                      <td>{money(w.monthlyPayable)}</td>
                      <td>{money(w.unpaidAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p className="empty">작업진행자가 없습니다.</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
