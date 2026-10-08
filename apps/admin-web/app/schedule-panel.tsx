"use client";
import FieldHelper from "./field-helper";
import { useEffect, useState } from "react";
import { SCHEDULE_COLORS, ScheduleEvent, WorkerSchedule } from "@jongno/shared";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const add = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
export default function SchedulePanel({
  onOpenSite,
  onOpenWorker,
  onChanged,
}: {
  onChanged?: () => void;
  onOpenSite: (id: string) => void;
  onOpenWorker: (id: string) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileView, setMobileView] = useState("카드");
  const [date, setDate] = useState(today),
    [view, setView] = useState("작업진행자별"),
    [data, setData] = useState<WorkerSchedule | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [worker, setWorker] = useState(""),
    [status, setStatus] = useState(""),
    [trade, setTrade] = useState(""),
    [site, setSite] = useState(""),
    [urgent, setUrgent] = useState(false),
    [unassigned, setUnassigned] = useState(false),
    [day, setDay] = useState(""),
    [exactDay, setExactDay] = useState(""),
    [assignment, setAssignment] = useState("");
  const [editing, setEditing] = useState<ScheduleEvent | null>(null),
    [manager, setManager] = useState(""),
    [participants, setParticipants] = useState<string[]>([]),
    [workDate, setWorkDate] = useState(""),
    [start, setStart] = useState("09:00"),
    [end, setEnd] = useState("17:00"),
    [kind, setKind] = useState("작업"),
    [isUrgent, setIsUrgent] = useState(false),
    [review, setReview] = useState(false),
    [warnings, setWarnings] = useState<string[]>([]),
    [force, setForce] = useState(false),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState("");
  const first = date.slice(0, 7) + "-01",
    last = new Date(
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
  const weekStart = add(date, -new Date(date + "T00:00:00Z").getUTCDay());
  const from = view === "월간" ? first : weekStart,
    to = view === "월간" ? last : add(weekStart, 6);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    fetch(`/api/worker-schedule?from=${from}&to=${to}`, { signal: c.signal })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.message);
        return b;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [from, to, revision]);
  const days = Array.from(
    { length: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 },
    (_, i) => add(from, i),
  );
  const events = (data?.events ?? []).filter(
    (e) =>
      (!worker || e.workerIds.includes(worker)) &&
      (!status ||
        e.status === status ||
        (status === "배정완료" && e.workStatus === "작업예정") ||
        (status === "작업중" && e.workStatus === "작업중") ||
        (status === "완료" &&
          ["작업완료", "관리자확인완료", "완료"].includes(
            e.workStatus ?? "",
          ))) &&
      (!trade || e.trades.includes(trade)) &&
      (!site || e.siteId === site) &&
      (!urgent || e.urgent) &&
      (!unassigned || !e.workerIds.length) &&
      (!exactDay || e.date === exactDay) &&
      (!assignment ||
        (assignment === "배정완료"
          ? e.workerIds.length > 0
          : e.workerIds.length === 0)),
  );
  function edit(e: ScheduleEvent) {
    setEditing(e);
    setManager(e.managerId ?? "");
    setParticipants(e.workerIds.filter((id) => id !== e.managerId));
    setWorkDate(e.date);
    setStart(e.start || "09:00");
    setEnd(e.end || "17:00");
    setKind(e.kind === "현장 예정" ? "작업" : e.kind);
    setIsUrgent(e.urgent);
    setReview(e.status === "확인필요");
    setWarnings([]);
    setForce(false);
    setError("");
  }
  async function save() {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/worker-schedule/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: editing.siteId,
          dailyWorkId: editing.dailyWorkId,
          date: workDate,
          managerId: manager,
          participantIds: participants,
          start,
          end,
          kind,
          urgent: isUrgent,
          reviewRequired: review,
          force,
        }),
      });
      const b = await r.json();
      if (!r.ok) {
        setWarnings(b.warnings ?? []);
        throw Error(b.message ?? "배정 실패");
      }
      setEditing(null);
      onChanged?.();
      setRevision((v) => v + 1);
      setNotice("일정이 저장되었습니다. 기존 일일작업과 연결되어 있습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function conflicts(e: ScheduleEvent) {
    return e.workerIds.some((id) => {
      const w = data?.workers.find((w) => w.id === id);
      const a =
        w?.availability.find((a) => a.date === e.date)?.status ??
        w?.defaultAvailability;
      return (
        a === "휴무" ||
        (a === "오전불가" && (!e.start || e.start < "12:00")) ||
        (a === "오후불가" && (!e.end || e.end > "12:00")) ||
        (data?.events ?? []).some(
          (other) =>
            other.id !== e.id &&
            other.date === e.date &&
            other.workerIds.includes(id) &&
            other.start &&
            other.end &&
            e.start &&
            e.end &&
            e.start < other.end &&
            e.end > other.start,
        )
      );
    });
  }
  function card(e: ScheduleEvent) {
    return (
      <article
        className="schedule-card"
        key={e.id}
        style={{
          borderLeftColor: SCHEDULE_COLORS[e.status],
          backgroundColor: SCHEDULE_COLORS[e.status] + "10",
        }}
      >
        {conflicts(e) && (
          <div className="schedule-conflict">⚠ 가용상태 / 시간 충돌</div>
        )}
        <span
          className="schedule-status"
          style={{ color: SCHEDULE_COLORS[e.status] }}
        >
          {e.urgent ? "! " : ""}
          {e.status}
          {e.workStatus &&
          ["긴급", "확인필요", "견적방문·현장확인"].includes(e.status)
            ? ` · ${e.workStatus}`
            : ""}
        </span>
        <button
          className="text-button schedule-site"
          onClick={() => onOpenSite(e.siteId)}
        >
          {e.siteName}
        </button>
        <div>
          {e.start
            ? `${e.start}–${e.end || "종료 미정"}`
            : "시간 미정 · 공사기간 기준"}
        </div>
        {e.trades.length > 0 && <small>{e.trades.join(" / ")}</small>}
        <div className="worker-tags">
          {e.workerIds.map((id) => {
            const w = data?.workers.find((w) => w.id === id);
            return (
              w && (
                <button key={id} onClick={() => onOpenWorker(id)}>
                  <i style={{ background: w.color }} />
                  {w.displayName}
                  {id === e.managerId ? " · 대표" : ""}
                </button>
              )
            );
          })}
        </div>
        {data?.canEdit && (
          <button className="schedule-edit" onClick={() => edit(e)}>
            {e.dailyWorkId ? "배정 변경" : "일정 배정"}
          </button>
        )}
      </article>
    );
  }
  const availability = (id: string, d: string) => {
    const w = data!.workers.find((w) => w.id === id)!;
    return (
      w.availability.find((a) => a.date === d)?.status ?? w.defaultAvailability
    );
  };
  return (
    <section className="panel schedule-panel">
      <div className="panel-title">
        <div>
          <h2>작업진행자 스케줄</h2>
          <p>누가, 언제, 어느 현장에서 일하는지 확인하고 배정하세요.</p>
        </div>
      </div>
      <div className="schedule-toolbar">
        <div className="tabs">
          {["월간", "주간", "작업진행자별"].map((v) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {v} 보기
            </button>
          ))}
        </div>
        <label>
          기준 날짜{" "}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        <button
          onClick={() =>
            setDate(
              view === "월간"
                ? new Date(
                    Date.UTC(
                      Number(date.slice(0, 4)),
                      Number(date.slice(5, 7)) - 2,
                      1,
                    ),
                  )
                    .toISOString()
                    .slice(0, 10)
                : add(date, -7),
            )
          }
        >
          이전
        </button>
        <button onClick={() => setDate(today())}>오늘</button>
        <button
          onClick={() =>
            setDate(
              view === "월간"
                ? new Date(
                    Date.UTC(
                      Number(date.slice(0, 4)),
                      Number(date.slice(5, 7)),
                      1,
                    ),
                  )
                    .toISOString()
                    .slice(0, 10)
                : add(date, 7),
            )
          }
        >
          다음
        </button>
      </div>
      <button
        className="mobile-filter-toggle"
        aria-controls="schedule-filters"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((v) => !v)}
      >
        {filtersOpen ? "필터 숨기기" : "필터 보기"} ·{" "}
        {
          [
            worker,
            status,
            trade,
            site,
            exactDay,
            assignment,
            urgent,
            unassigned,
          ].filter(Boolean).length
        }
        개 적용
      </button>
      <div
        id="schedule-filters"
        className={`schedule-filters ${filtersOpen ? "mobile-expanded" : ""}`}
      >
        <label>
          작업일자
          <input
            type="date"
            value={exactDay}
            onChange={(e) => setExactDay(e.target.value)}
          />
        </label>
        <label>
          배정 여부
          <select
            value={assignment}
            onChange={(e) => setAssignment(e.target.value)}
          >
            <option value="">전체</option>
            <option>배정완료</option>
            <option>미배정</option>
          </select>
        </label>
        <label>
          작업진행자
          <select value={worker} onChange={(e) => setWorker(e.target.value)}>
            <option value="">전체</option>
            {data?.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          상태
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">전체</option>
            {Object.keys(SCHEDULE_COLORS).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          공종
          <select value={trade} onChange={(e) => setTrade(e.target.value)}>
            <option value="">전체</option>
            <option>기계</option>
            <option>전기</option>
          </select>
        </label>
        <label>
          현장
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">전체</option>
            {Array.from(
              new Map(
                data?.events.map((e) => [e.siteId, e.siteName]),
              ).entries(),
            ).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
          />{" "}
          긴급만
        </label>
        <label>
          <input
            type="checkbox"
            checked={unassigned}
            onChange={(e) => setUnassigned(e.target.checked)}
          />{" "}
          미배정만
        </label>
        <button
          onClick={() => {
            setWorker("");
            setStatus("");
            setTrade("");
            setSite("");
            setUrgent(false);
            setUnassigned(false);
            setExactDay("");
            setAssignment("");
          }}
        >
          필터 초기화
        </button>
      </div>
      <div className="schedule-legend">
        {Object.entries(SCHEDULE_COLORS).map(([s, c]) => (
          <span key={s}>
            <i style={{ background: c }} />
            {s}
          </span>
        ))}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && <p>일정을 불러오는 중입니다…</p>}
      {data && (
        <>
          <p className="muted-text">
            {from} ~ {to} · {events.length}건 · 휴무/불가시간은 배경과 텍스트로
            표시합니다. 시간 미정 일정은 배정 시 확인이 필요합니다.
          </p>
          {view === "작업진행자별" ? (
            <>
              <div className="mobile-roster-toggle">
                <button
                  className={mobileView === "카드" ? "active" : ""}
                  onClick={() => setMobileView("카드")}
                >
                  카드로 보기
                </button>
                <button
                  className={mobileView === "표" ? "active" : ""}
                  onClick={() => setMobileView("표")}
                >
                  표로 보기
                </button>
              </div>
              <div
                className={`mobile-roster ${mobileView === "표" ? "hidden" : ""}`}
              >
                {data.workers
                  .filter((w) => !worker || w.id === worker)
                  .map((w) => (
                    <article className="mobile-worker" key={w.id}>
                      <h3>
                        <i
                          className="color-dot"
                          style={{ background: w.color }}
                        />
                        <button
                          className="text-button"
                          onClick={() => onOpenWorker(w.id)}
                        >
                          {w.displayName}
                        </button>
                        {w.inactive && " · 비활성"}
                      </h3>
                      {days
                        .filter(
                          (d) =>
                            d === (exactDay || date) ||
                            events.some(
                              (e) => e.date === d && e.workerIds.includes(w.id),
                            ),
                        )
                        .map((d) => (
                          <section key={d}>
                            <h4>
                              {d}{" "}
                              <span>
                                {availability(w.id, d) === "근무가능"
                                  ? "가능"
                                  : availability(w.id, d)}
                              </span>
                            </h4>
                            {events
                              .filter(
                                (e) =>
                                  e.date === d && e.workerIds.includes(w.id),
                              )
                              .map(card)}
                            {!events.some(
                              (e) => e.date === d && e.workerIds.includes(w.id),
                            ) && <p>배정 일정 없음</p>}
                          </section>
                        ))}
                    </article>
                  ))}
              </div>
              <div
                className={`roster-scroll ${mobileView === "카드" ? "mobile-hidden" : ""}`}
                tabIndex={0}
                aria-label="작업진행자별 일정표, 가로 스크롤 가능"
              >
                <table className="schedule-roster">
                  <thead>
                    <tr>
                      <th>작업진행자</th>
                      {days.map((d) => (
                        <th key={d}>
                          {d.slice(5)}
                          <small>
                            {
                              ["일", "월", "화", "수", "목", "금", "토"][
                                new Date(d).getUTCDay()
                              ]
                            }
                          </small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.workers
                      .filter((w) => !worker || w.id === worker)
                      .map((w) => (
                        <tr key={w.id}>
                          <th>
                            <button
                              className="text-button"
                              onClick={() => onOpenWorker(w.id)}
                            >
                              <i
                                className="color-dot"
                                style={{ background: w.color }}
                              />
                              {w.displayName}
                            </button>
                            {w.inactive && <small>비활성</small>}
                            {data.canForce && (
                              <label className="color-editor">
                                고유색
                                <input
                                  aria-label={`${w.displayName} 색상`}
                                  type="color"
                                  value={w.color}
                                  onChange={async (e) => {
                                    const r = await fetch(
                                      `/api/worker-schedule/workers/${w.id}/color`,
                                      {
                                        method: "PUT",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          color: e.target.value,
                                        }),
                                      },
                                    );
                                    if (r.ok) setRevision((v) => v + 1);
                                    else setError("색상 변경 실패");
                                  }}
                                />
                              </label>
                            )}
                          </th>
                          {days.map((d) => {
                            const a = availability(w.id, d);
                            return (
                              <td key={d} className={`availability-${a}`}>
                                <span className="availability-label">
                                  {a === "근무가능" ? "가능" : a}
                                </span>
                                {events
                                  .filter(
                                    (e) =>
                                      e.date === d &&
                                      e.workerIds.includes(w.id),
                                  )
                                  .map(card)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div
              className={`schedule-calendar ${view === "주간" ? "weekly" : ""}`}
            >
              {view === "월간" &&
                Array.from({ length: new Date(first).getUTCDay() }, (_, i) => (
                  <div className="schedule-day blank" key={`b${i}`} />
                ))}
              {days.map((d) => {
                const list = events.filter((e) => e.date === d);
                return (
                  <div className="schedule-day" key={d}>
                    <strong>
                      {d.slice(5)}{" "}
                      {
                        ["일", "월", "화", "수", "목", "금", "토"][
                          new Date(d).getUTCDay()
                        ]
                      }
                    </strong>
                    {list.slice(0, 3).map(card)}
                    {list.length > 3 && (
                      <button onClick={() => setDay(d)}>
                        +{list.length - 3} 더보기
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!events.length && (
            <FieldHelper
              title="선택한 조건의 일정이 없습니다."
              description="날짜와 필터를 확인하거나 새 일정을 배정하세요."
            />
          )}
          {data.canEdit && (
            <section className="unassigned-panel">
              <h3>미배정 현장</h3>
              <p>
                현재 조회기간과 필터에 해당하는 현장을 클릭하여 배정할 수
                있습니다.
              </p>
              {Array.from(
                new Map(
                  events
                    .filter((e) => !e.workerIds.length)
                    .map((e) => [e.siteId, e]),
                ).values(),
              ).map((e) => (
                <div key={e.siteId}>
                  <strong>{e.siteName}</strong>
                  <span>
                    {e.date} · {e.trades.join("/") || "공종 미지정"} · {e.urgent?"긴급":"일반"} ·{" "}
                    {e.content}
                  </span>
                  <button onClick={() => edit(e)}>배정하기</button>
                </div>
              ))}
              {!events.some((e) => !e.workerIds.length) && (
                <p>미배정 현장이 없습니다.</p>
              )}
            </section>
          )}
        </>
      )}
      {day && (
        <div
          className="schedule-modal"
          role="dialog"
          aria-modal="true"
          aria-label="날짜 전체 일정"
        >
          <section className="panel">
            <button onClick={() => setDay("")}>닫기</button>
            <h2>{day} 전체 일정</h2>
            {events.filter((e) => e.date === day).map(card)}
          </section>
        </div>
      )}
      {editing && (
        <div
          className="schedule-modal"
          role="dialog"
          aria-modal="true"
          aria-label="일정 배정"
        >
          <section className="panel">
            <div className="panel-title">
              <h2>{editing.siteName} · 일정 배정</h2>
              <button
                onClick={() => {
                  setEditing(null);
                  setError("");
                }}
              >
                닫기
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="schedule-form">
                <label>
                  작업일자
                  <input
                    required
                    type="date"
                    value={workDate}
                    onChange={(e) => {
                      setWorkDate(e.target.value);
                      setForce(false);
                    }}
                  />
                </label>
                <label>
                  대표 작업진행자
                  <select
                    required
                    aria-label="대표 작업진행자"
                    value={manager}
                    onChange={(e) => {
                      setManager(e.target.value);
                      setWarnings([]);
                      setForce(false);
                    }}
                  >
                    <option value="">선택</option>
                    {data?.workers
                      .filter((w) => !w.inactive)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  예정 시작
                  <input
                    required
                    type="time"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setForce(false);
                    }}
                  />
                </label>
                <label>
                  예정 종료
                  <input
                    required
                    type="time"
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      setForce(false);
                    }}
                  />
                </label>
                <label>
                  일정 종류
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option>작업</option>
                    <option>견적방문</option>
                    <option>현장확인</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={isUrgent}
                    onChange={(e) => setIsUrgent(e.target.checked)}
                  />{" "}
                  긴급
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={review}
                    onChange={(e) => setReview(e.target.checked)}
                  />{" "}
                  확인필요
                </label>
              </div>
              <fieldset>
                <legend>참여 작업진행자</legend>
                {data?.workers
                  .filter((w) => !w.inactive && w.id !== manager)
                  .map((w) => (
                    <label className="participant-choice" key={w.id}>
                      <input
                        type="checkbox"
                        checked={participants.includes(w.id)}
                        onChange={(e) => {
                          setParticipants((v) =>
                            e.target.checked
                              ? [...v, w.id]
                              : v.filter((id) => id !== w.id),
                          );
                          setForce(false);
                        }}
                      />
                      {w.displayName}
                    </label>
                  ))}
              </fieldset>
              {warnings.length > 0 && (
                <div className="schedule-warning" role="alert">
                  {warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                  {data?.canForce && (
                    <label>
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                      />{" "}
                      충돌을 확인했습니다. 관리자 권한으로 강제 저장
                    </label>
                  )}
                </div>
              )}
              {error && <p className="error">{error}</p>}
              <p>
                예정시간을 저장합니다. 실제 작업시간과 사진·자재 기록은
                유지됩니다.
              </p>
              <button className="primary-button" disabled={saving}>
                {saving ? "저장 중…" : "배정 저장"}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
