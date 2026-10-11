"use client";
import { useEffect, useState } from "react";
import {
  AvailabilityStatus,
  ScheduleEvent,
  SCHEDULE_COLORS,
  WorkerAvailability,
  WorkerSchedule,
} from "@jongro/shared";
import { authApi } from "./auth-provider";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
const shift = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
export default function WorkerMobileSchedule({
  onSite,
  onWork,
  onAs,
  onChanged,
  compact = false,
}: {
  onSite: (id: string) => void;
  onWork: (id: string) => void;
  onAs: (id: string) => void;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [selected, setSelected] = useState(today()),
    [mode, setMode] = useState("월간"),
    [data, setData] = useState<WorkerSchedule | null>(null),
    [availability, setAvailability] = useState<WorkerAvailability[]>([]),
    [defaultStatus, setDefaultStatus] =
      useState<AvailabilityStatus>("근무가능"),
    [status, setStatus] = useState<AvailabilityStatus>("근무가능"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const first = month + "-01",
    last = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10),
    gridStart = shift(first, -new Date(first).getUTCDay()),
    gridEnd = shift(last, 6 - new Date(last).getUTCDay());
  const weekStart = shift(today(), -((new Date(today()).getUTCDay() + 6) % 7)),
    weekEnd = shift(weekStart, 6);
  const from = month === today().slice(0,7) && gridStart > weekStart ? weekStart : gridStart,
    to = month === today().slice(0,7) && gridEnd < weekEnd ? weekEnd : gridEnd;
  useEffect(() => {
    let alive = true;
    setError("");
    Promise.all([
      authApi<WorkerSchedule>(`/worker-schedule?from=${from}&to=${to}`),
      authApi<{
        worker: { defaultAvailability: AvailabilityStatus };
        availability: WorkerAvailability[];
      }>("/operational/availability"),
    ])
      .then(([s, a]) => {
        if (alive) {
          setData(s);
          setAvailability(a.availability);
          setDefaultStatus(a.worker.defaultAvailability);
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [from, to, revision]);
  const statusOn = (date: string) =>
    availability.find((a) => a.date === date)?.status ?? defaultStatus;
  useEffect(() => {
    setStatus(
      availability.find((a) => a.date === selected)?.status ?? defaultStatus,
    );
  }, [availability, selected, defaultStatus]);
  async function save(remove = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const put = async (confirmConflict = false) =>
        fetch(`/api/operational/availability/${selected}`, {
          method: remove ? "DELETE" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: remove
            ? undefined
            : JSON.stringify({ status, confirmConflict }),
        });
      let r = await put();
      let body = await r.json();
      if (r.status === 409 && confirm(body.message)) {
        r = await put(true);
        body = await r.json();
      } else if (r.status === 409) {
        return;
      }
      if (!r.ok) throw Error(body.message || "휴무 설정에 실패했습니다.");
      setNotice(
        remove
          ? "날짜별 설정을 삭제하고 기본 근무상태로 복원했습니다."
          : "근무가능 상태를 저장했습니다.",
      );
      setRevision((v) => v + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const days = Array.from(
    {
      length:
        Math.round((Date.parse(gridEnd) - Date.parse(gridStart)) / 86400000) +
        1,
    },
    (_, i) => shift(gridStart, i),
  );
  const events = data?.events ?? [],
    shown =
      mode === "이번주"
        ? events.filter((e) => e.date >= weekStart && e.date <= weekEnd)
        : events.filter((e) => e.date === selected);
  const card = (e: ScheduleEvent) => (
    <article
      key={e.id}
      className="mobile-card schedule-mobile-card"
      style={{ borderLeftColor: SCHEDULE_COLORS[e.status] }}
    >
      <div className="worker-day-tags">
        <span className="badge">{e.status}</span>
        {e.asId && <span className="badge">A/S</span>}
        {e.urgent && <span className="urgent-tag">긴급</span>}
      </div>
      <h3>
        <button
          className="text-button"
          onClick={() => (e.asId ? onAs(e.asId) : onSite(e.siteId))}
        >
          {e.siteName}
        </button>
      </h3>
      <p>
        {e.date} · {e.start || "시간 미정"} ~ {e.end || "미정"}
      </p>
      <p>{e.content}</p>
      {e.dailyWorkId && (
        <button className="primary" onClick={() => onWork(e.dailyWorkId!)}>
          작업 시작 · 작업 화면
        </button>
      )}
    </article>
  );
  function move(offset: number) {
    const next = new Date(
      Date.UTC(
        Number(month.slice(0, 4)),
        Number(month.slice(5)) - 1 + offset,
        1,
      ),
    )
      .toISOString()
      .slice(0, 7);
    setMonth(next);
    setSelected(next + "-01");
    setNotice("");
  }
  return (
    <section className="worker-personal-calendar">
      <div className="worker-schedule-summary">
        <span>
          월간 일정{" "}
          <strong>
            {events.filter((e) => e.date.startsWith(month)).length}건
          </strong>
        </span>
        <span>
          이번주 일정{" "}
          <strong>
            {
              events.filter((e) => e.date >= weekStart && e.date <= weekEnd)
                .length
            }
            건
          </strong>
        </span>
        <span>
          휴무·반일{" "}
          <strong>
            {
              availability.filter(
                (a) => a.date.startsWith(month) && a.status !== "근무가능",
              ).length
            }
            일
          </strong>
        </span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="save-message">
          {notice}
        </p>
      )}
      <details open={!compact} className="worker-calendar-content">
        <summary hidden={!compact}>월간·주간 일정 확인 · 휴무일 지정</summary>
        <div className="mobile-segments" role="group" aria-label="내 일정 보기">
          <button
            aria-pressed={mode === "월간"}
            onClick={() => setMode("월간")}
          >
            월간
          </button>
          <button
            aria-pressed={mode === "이번주"}
            onClick={() => {setMode("이번주");setMonth(today().slice(0,7));setSelected(today())}}
          >
            이번주
          </button>
          <button
            onClick={() => {
              setMonth(today().slice(0, 7));
              setSelected(today());
              setMode("월간");
            }}
          >
            오늘
          </button>
        </div>
        {mode === "월간" && (
          <>
            <div className="worker-calendar-heading">
              <button aria-label="이전 달" onClick={() => move(-1)}>
                ‹
              </button>
              <h2>{month.replace("-", "년 ")}월</h2>
              <button aria-label="다음 달" onClick={() => move(1)}>
                ›
              </button>
            </div>
            <div
              className="worker-month-calendar"
              role="group"
              aria-label="내 월간 달력"
            >
              {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                <span className="weekday" key={d}>
                  {d}
                </span>
              ))}
              {days.map((date) => {
                const rows = events.filter((e) => e.date === date),
                  avail = statusOn(date);
                return (
                  <button
                    key={date}
                    aria-label={`${date}${date === today() ? " 오늘" : ""} ${rows.length}건 ${avail}`}
                    aria-pressed={selected === date}
                    className={`${date === today() ? "is-today" : ""} ${!date.startsWith(month) ? "outside-month" : ""} ${avail === "휴무" ? "day-off" : ""}`}
                    onClick={() => {
                      setSelected(date);
                      setNotice("");
                    }}
                  >
                    <strong>{Number(date.slice(-2))}</strong>
                    {date === today() && <small>오늘</small>}
                    {avail !== "근무가능" && (
                      <span className="calendar-availability">{avail}</span>
                    )}
                    <span className="calendar-event-tags">
                      {rows.slice(0, 2).map((e) => (
                        <i
                          key={e.id}
                          style={{ background: SCHEDULE_COLORS[e.status] }}
                        >
                          {e.asId ? "A/S" : e.status}
                          {e.urgent ? " !" : ""}
                        </i>
                      ))}
                      {rows.length > 2 && <small>+{rows.length - 2}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="worker-calendar-hint">
              날짜를 누르면 일정과 휴무를 함께 확인할 수 있습니다.
            </p>
          </>
        )}
        {mode === "월간" && (
          <details
            className="mobile-card worker-availability-editor"
            open={!compact}
          >
            <summary>{selected} · 휴무/근무가능 설정</summary>
            <label>
              근무 상태
              <select
                aria-label="내 근무 상태"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as AvailabilityStatus)
                }
              >
                {(["근무가능", "휴무", "오전불가", "오후불가"] as const).map(
                  (s) => (
                    <option key={s} value={s}>
                      {s === "근무가능" ? "가능" : s}
                    </option>
                  ),
                )}
              </select>
            </label>
            {events.some((e) => e.date === selected) && (
              <p className="availability-warning">
                이미 배정된 일정이 있습니다. 휴무 변경 시 확인이 필요합니다.
              </p>
            )}
            <div className="mobile-step-actions">
              <button
                disabled={busy}
                className="primary"
                onClick={() => void save()}
              >
                근무 상태 저장
              </button>
              <button
                disabled={
                  busy || !availability.some((a) => a.date === selected)
                }
                onClick={() => void save(true)}
              >
                날짜 설정 삭제
              </button>
            </div>
          </details>
        )}
        <h2>{mode === "이번주" ? "이번주 계획" : `${selected} 일정`}</h2>
        {shown.length ? (
          shown.map(card)
        ) : (
          <p className="mobile-card">배정된 일정이 없습니다.</p>
        )}
        {mode === "이번주" &&
          availability
            .filter(
              (a) =>
                a.date >= weekStart &&
                a.date <= weekEnd &&
                a.status !== "근무가능",
            )
            .map((a) => (
              <p key={a.date} className="mobile-card">
                {a.date} · {a.status}
              </p>
            ))}
      </details>
    </section>
  );
}
