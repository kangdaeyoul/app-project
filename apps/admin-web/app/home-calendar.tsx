"use client";
import { useEffect, useState } from "react";
import { WorkerSchedule, SCHEDULE_COLORS } from "@jongro/shared";
import { authApi } from "./auth-provider";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
export default function HomeCalendar({
  onSite,
  onAs,
  onAll,
}: {
  onSite: (id: string) => void;
  onAs: (id: string) => void;
  onAll: () => void;
}) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [selected, setSelected] = useState(today()),
    [data, setData] = useState<WorkerSchedule | null>(null),
    [error, setError] = useState("");
  const [year, m] = month.split("-").map(Number),
    days = new Date(Date.UTC(year, m, 0)).getUTCDate(),
    offset = new Date(month + "-01").getUTCDay();
  useEffect(() => {
    let alive = true;
    setData(null);
    authApi<WorkerSchedule>(
      `/worker-schedule?from=${month}-01&to=${month}-${days}`,
    )
      .then((v) => {
        if (alive) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [month, days]);
  const change = (n: number) => {
    const v = new Date(Date.UTC(year, m - 1 + n, 1)).toISOString().slice(0, 7);
    setMonth(v);
    setSelected(v + "-01");
  };
  return (
    <section
      className="home-calendar"
      aria-label="홈 월간 캘린더"
      data-swipe-ignore
    >
      <div className="home-calendar-title">
        <button aria-label="이전 달" onClick={() => change(-1)}>
          ‹
        </button>
        <h2>
          {year}년 {m}월
        </h2>
        <button aria-label="다음 달" onClick={() => change(1)}>
          ›
        </button>
        <button onClick={onAll}>일정 전체보기</button>
      </div>
      <div className="home-month-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((x) => (
          <span key={x} className="weekday">
            {x}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={"blank" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = month + "-" + String(i + 1).padStart(2, "0"),
            events = data?.events.filter((e) => e.date === date) ?? [],
            isToday = date === today();
          const tags = [
            events.some((e) => !e.asId) && "현장",
            events.some((e) => e.asId) && "A/S",
            events.some((e) => e.status === "완료") && "완료",
            events.some((e) => e.urgent) && "긴급",
            events.some((e) => !e.workerIds.length) && "미배정",
          ].filter(Boolean) as string[];
          return (
            <button
              key={date}
              className={
                (isToday ? "is-today " : "") +
                (date === selected ? "is-selected" : "")
              }
              aria-current={isToday ? "date" : undefined}
              aria-pressed={date === selected}
              aria-label={`${date}${isToday ? " 오늘" : ""} 일정 ${events.length}건 배정 ${events.filter(e=>e.workerIds.length>0).length}건 ${tags.join(" ")}`}
              onClick={() => setSelected(date)}
            >
              <strong>{i + 1}</strong>
              <span className="calendar-signals">
                {[...tags].sort((a,b)=>(a==="긴급"?-1:b==="긴급"?1:0)).slice(0, 3).map((t) => (
                  <i key={t} data-kind={t} aria-hidden="true">
                    {t === "A/S"
                      ? "A"
                      : t === "완료"
                        ? "✓"
                        : t === "긴급"
                          ? "!"
                          : t === "미배정"
                            ? "?"
                            : "●"}
                  </i>
                ))}
                {events.length > 0 && <small>{events.length}{events.some(e=>e.workerIds.length>0)?"人":""}</small>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="calendar-legend">
        <span>● 현장</span>
        <span>A A/S</span>
        <span>✓ 완료</span>
        <span>! 긴급</span>
        <span>? 미배정</span><span>人 배정</span>
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="home-day-list" aria-live="polite">
        <h3>{selected} 일정</h3>
        {data
          ? data.events
              .filter((e) => e.date === selected)
              .map((e) => (
                <button
                  key={e.id}
                  className="home-day-event"
                  style={{ borderLeftColor: SCHEDULE_COLORS[e.status] }}
                  onClick={() => (e.asId ? onAs(e.asId) : onSite(e.siteId))}
                >
                  <strong>{e.siteName}</strong>
                  <span>
                    {e.start || "시간 미정"}
                    {e.end && `–${e.end}`} · {e.asId ? "A/S · " : ""}
                    {e.status}
                    {e.urgent ? " · 긴급" : ""}
                  </span>
                  <small>
                    {e.workerIds
                      .map(
                        (id) =>
                          data.workers.find((w) => w.id === id)?.displayName ??
                          "작업진행자",
                      )
                      .join(", ") || "미배정"}
                  </small>
                </button>
              ))
          : !error && <p>일정을 불러오는 중입니다…</p>}
        {data && !data.events.some((e) => e.date === selected) && (
          <p>이 날짜에 배정된 일정이 없습니다.</p>
        )}
      </div>
    </section>
  );
}
