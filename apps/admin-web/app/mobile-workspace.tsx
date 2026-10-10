"use client";
import { useEffect, useState } from "react";
import {
  DailyWork,
  Site,
  WorkerSchedule,
  SCHEDULE_COLORS,
} from "@jongno/shared";
import { authApi, useAuth, SessionHeader } from "./auth-provider";
import InstructionsPanel from "./instructions-panel";
import AfterServicePanel from "./after-service-panel";
import QuotesPanel from "./quotes-panel";
import CompletionReportPanel from "./completion-report-panel";
import PhotosPanel from "./photos-panel";
import MaterialRows from "./material-rows";
import SchedulePanel from "./schedule-panel";
import { OwnSettlements, StaffQuotes } from "./operational-workspace";
import FieldHelper from "./field-helper";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
const clock = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
export default function MobileWorkspace() {
  const { user, company } = useAuth();
  const admin = user?.role === "admin",
    worker = user?.role === "worker";
  const menus = worker
    ? ["오늘 일정", "내 현장", "A/S", "작업지시", "더보기"]
    : admin
      ? ["홈", "일정", "현장", "견적", "더보기"]
      : ["홈", "일정", "내 현장", "작업", "더보기"];
  const [menu, setMenu] = useState(menus[0]),
    [sites, setSites] = useState<Site[]>([]),
    [works, setWorks] = useState<DailyWork[]>([]),
    [events, setEvents] = useState<any[]>([]),
    [asRows, setAsRows] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [work, setWork] = useState<DailyWork | null>(null),
    [asId, setAsId] = useState<string>(),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false);
  const reload = () => setRevision((v) => v + 1);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [menu, selected, work?.id]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([
        authApi<Site[]>("/operational/sites"),
        authApi<DailyWork[]>("/operational/daily-work"),
        authApi<any[]>("/work-instructions/notifications"),
        authApi<any[]>("/after-service"),
      ])
        .then(([s, w, e, a]) => {
          if (alive) {
            setSites(s);
            setWorks(w);
            setEvents(e);
            setAsRows(a);
            setError("");
          }
        })
        .catch((e) => alive && setError(e.message));
    load();
    const timer = setInterval(load, 15000);
    window.addEventListener("instructions-changed", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("instructions-changed", load);
    };
  }, [revision]);
  useEffect(() => {
    const annotate = () =>
      document.querySelectorAll(".mobile-app table").forEach((table) => {
        const heads = Array.from(table.querySelectorAll("thead th")).map(
          (h) => h.textContent ?? "",
        );
        table
          .querySelectorAll("tbody tr")
          .forEach((row) =>
            Array.from(row.children).forEach((cell, i) =>
              cell.setAttribute("data-label", heads[i] ?? ""),
            ),
          );
      });
    const observer = new MutationObserver(annotate);
    observer.observe(document.body, { childList: true, subtree: true });
    annotate();
    return () => observer.disconnect();
  }, []);
  const navigate = (m: string) => {
    if (m === "홈 화면 설치 안내") {
      window.dispatchEvent(new Event("show-pwa-install-guide"));
      return;
    }
    if (dirty && !confirm("저장하지 않은 내용을 닫을까요?")) return;
    setDirty(false);
    setMenu(m);
    setSelected("");
    setWork(null);
    setAsId(undefined);
  };
  const openSite = (id: string) => {
    setSelected(id);
    setWork(null);
    setMenu(admin ? "현장" : "내 현장");
  };
  const openWork = (w: DailyWork) => {
    setWork(w);
    setMenu("작업");
  };
  const site = sites.find((s) => s.id === selected),
    siteWorks = works.filter((w) => w.siteId === selected),
    unread = events.filter((e) => !e.readAt).length;
  const todayWorks = works.filter((w) => w.workDate === today()),
    todayAs = asRows.filter(
      (a) =>
        a.plannedDate === today() && !["종결", "처리완료"].includes(a.status),
    );
  const renderWork = (w: DailyWork) => (
    <article className="mobile-card" key={w.id}>
      <span className="badge">{w.status}</span>
      <h3>{w.siteName}</h3>
      <p>
        {w.workDate} · {w.startTime || w.plannedStartTime || "시간 미정"} ~{" "}
        {w.endTime || w.plannedEndTime || "미정"}
      </p>
      <p>{w.content}</p>
      <button className="primary" onClick={() => openWork(w)}>
        작업시작 · 사진등록 · 완료요청
      </button>
    </article>
  );
  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div>
          {company.logoUrl && (
            <img src={company.logoUrl} alt="회사 로고" width="28" height="28" />
          )}
          <strong>{company.displayName}</strong>
        </div>
        <button
          aria-label={`알림센터 미확인 ${unread}건`}
          onClick={() => navigate("작업지시")}
        >
          알림 <b>{unread}</b>
        </button>
      </header>
      <main className="mobile-main">
        <div className="mobile-title">
          <h1>{work ? "현장 작업" : site ? site.name : menu}</h1>
          <SessionHeader />
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {work ? (
          <MobileWork
            key={work.id}
            onDirty={setDirty}
            work={work}
            onChanged={reload}
            onBack={() => {
              setWork(null);
              setDirty(false);
              reload();
            }}
          />
        ) : menu === "홈" || (worker && menu === "오늘 일정") ? (
          <>
            <FieldHelper title={`${user?.displayName}님, 오늘도 안전하게.`} />
            <div className="mobile-stats">
              <button onClick={() => navigate("일정")}>
                오늘 현장 <strong>{todayWorks.length}</strong>
              </button>
              <button onClick={() => navigate("A/S")}>
                오늘 A/S <strong>{todayAs.length}</strong>
              </button>
              <button onClick={() => navigate("작업지시")}>
                미확인 작업지시 <strong>{unread}</strong>
              </button>
              <button onClick={() => navigate("A/S")}>
                긴급 A/S{" "}
                <strong>
                  {
                    asRows.filter(
                      (a) =>
                        a.urgent && !["종결", "처리완료"].includes(a.status),
                    ).length
                  }
                </strong>
              </button>
            </div>
            {admin && (
              <>
                <button className="primary" onClick={() => navigate("견적")}>
                  빠른 견적 작성
                </button>
                <button onClick={() => navigate("배정관리")}>
                  미배정 일정 확인 · 배정
                </button>
                <MobileReview sites={sites} />
              </>
            )}
            <h2>오늘 일정</h2>
            {todayWorks.length ? (
              todayWorks.map(renderWork)
            ) : (
              <p className="mobile-card">오늘 배정된 작업이 없습니다.</p>
            )}
            <h2>다음 현장</h2>
            {works
              .filter((w) => w.workDate > today())
              .sort((a, b) => a.workDate.localeCompare(b.workDate))
              .slice(0, 2)
              .map(renderWork)}
          </>
        ) : menu === "일정" || menu === "오늘 일정" ? (
          <MobileSchedule
            onSite={openSite}
            onWork={(id) => {
              const w = works.find((w) => w.id === id);
              if (w) openWork(w);
            }}
          />
        ) : menu === "배정관리" && admin ? (
          <SchedulePanel
            onOpenSite={openSite}
            onOpenWorker={() => {}}
            onChanged={reload}
          />
        ) : menu === "작업지시" ? (
          <InstructionsPanel
            onOpen={(s, a) => {
              if (a) {
                setAsId(a);
                setMenu("A/S");
              } else openSite(s);
            }}
          />
        ) : menu === "A/S" ? (
          <AfterServicePanel
            initialAsId={asId}
            onChanged={reload}
            onOpenQuote={() => navigate("견적")}
          />
        ) : menu === "견적" && admin ? (
          <QuotesPanel onChanged={reload} onOpenSite={openSite} />
        ) : menu === "견적" && user?.permissions.includes("writeQuotes") ? (
          <StaffQuotes />
        ) : menu === "내 정산" && worker ? (
          <OwnSettlements />
        ) : menu === "작업" ? (
          <>{works.map(renderWork)}</>
        ) : menu === "더보기" ? (
          <div className="mobile-actions">
            {[
              "홈 화면 설치 안내",
              "작업지시",
              "일정",
              "작업",
              "A/S",
              ...(worker ? ["내 정산"] : []),
              ...(admin
                ? ["배정관리", "견적"]
                : user?.permissions.includes("writeQuotes")
                  ? ["견적"]
                  : []),
            ].map((m) => (
              <button key={m} onClick={() => navigate(m)}>
                {m}
              </button>
            ))}
          </div>
        ) : menu.includes("현장") ? (
          <>
            {site ? (
              <>
                <button onClick={() => setSelected("")}>← 현장 목록</button>
                <details open className="mobile-card">
                  <summary>현장정보</summary>
                  <p>{site.address}</p>
                  <p>{site.description}</p>
                  <p>
                    {site.contactName} ·{" "}
                    <a href={"tel:" + site.phone}>{site.phone}</a>
                  </p>
                  <p>
                    {site.startDate} ~ {site.endDate} · {site.status}
                  </p>
                </details>
                <details className="mobile-card">
                  <summary>일정</summary>
                  {siteWorks.map(renderWork)}
                </details>
                <details className="mobile-card">
                  <summary>작업지시</summary>
                  <InstructionsPanel siteId={site.id} />
                </details>
                <details className="mobile-card">
                  <summary>일일작업</summary>
                  {siteWorks.map(renderWork)}
                </details>
                <details className="mobile-card">
                  <summary>사진</summary>
                  {siteWorks.map((w) => (
                    <details key={w.id}>
                      <summary>
                        {w.workDate} · {w.content}
                      </summary>
                      <PhotosPanel dailyWorkId={w.id} />
                    </details>
                  ))}
                </details>
                <details className="mobile-card">
                  <summary>사용자재</summary>
                  {siteWorks.map((w) => (
                    <section key={w.id}>
                      <h3>{w.workDate}</h3>
                      {w.materials.map((m, i) => (
                        <p key={i}>
                          {m.name} {m.specification} · {m.quantity}
                          {m.unit}
                        </p>
                      ))}
                    </section>
                  ))}
                </details>
                {!worker && (
                  <details className="mobile-card">
                    <summary>완료보고서</summary>
                    <CompletionReportPanel siteId={site.id} />
                  </details>
                )}
                <details className="mobile-card">
                  <summary>A/S</summary>
                  <AfterServicePanel siteId={site.id} onChanged={reload} />
                </details>
                {admin && (
                  <details className="mobile-card">
                    <summary>수금 · 비용 · 현장손익</summary>
                    <MobileFinance siteId={site.id} />
                    <button onClick={() => navigate("견적")}>견적 관리</button>
                  </details>
                )}
              </>
            ) : (
              sites.map((s) => (
                <button
                  className="mobile-card site-link"
                  key={s.id}
                  onClick={() => openSite(s.id)}
                >
                  <span className="badge">{s.status}</span>
                  <h2>{s.name}</h2>
                  <p>{s.address}</p>
                  <p>{s.description}</p>
                </button>
              ))
            )}
          </>
        ) : null}
      </main>
      <nav className="mobile-bottom" aria-label="모바일 주 메뉴">
        {menus.map((m, i) => (
          <button
            key={m}
            aria-current={menu === m ? "page" : undefined}
            onClick={() => navigate(m)}
          >
            <span aria-hidden="true">{["⌂", "▦", "▤", "✓", "•••"][i]}</span>
            {m}
          </button>
        ))}
      </nav>
    </div>
  );
}
function MobileSchedule({
  onSite,
  onWork,
}: {
  onSite: (id: string) => void;
  onWork: (id: string) => void;
}) {
  const [mode, setMode] = useState("오늘"),
    [date, setDate] = useState(today),
    [data, setData] = useState<WorkerSchedule | null>(null),
    [error, setError] = useState("");
  const to = new Date(Date.parse(date) + 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  useEffect(() => {
    authApi<WorkerSchedule>(
      `/worker-schedule?from=${date}&to=${mode === "오늘" ? date : to}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  }, [date, mode, to]);
  const card = (e: WorkerSchedule["events"][number]) => (
    <article
      className="mobile-card schedule-mobile-card"
      key={e.id}
      style={{ borderLeftColor: SCHEDULE_COLORS[e.status] }}
    >
      <span className="badge">{e.status}</span>
      {e.asId && <span className="badge">A/S</span>}
      {e.urgent && <span className="error">긴급</span>}
      <h3>
        <button className="text-button" onClick={() => onSite(e.siteId)}>
          {e.siteName}
        </button>
      </h3>
      <p>
        {e.date} · {e.start || "시간 미정"} ~ {e.end || "미정"}
      </p>
      <p>{e.content}</p>
      <div>
        {e.workerIds.map((id) => {
          const w = data?.workers.find((w) => w.id === id);
          return (
            <span
              className="worker-chip"
              key={id}
              style={{ borderColor: w?.color }}
            >
              {w?.displayName}
              {e.managerId === id ? " · 대표" : ""}
            </span>
          );
        })}
      </div>
      {e.dailyWorkId && (
        <button onClick={() => onWork(e.dailyWorkId!)}>작업 화면 열기</button>
      )}
    </article>
  );
  return (
    <>
      <div className="mobile-segments">
        {["오늘", "이번주", "작업진행자별"].map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              if (m === "오늘") setDate(today());
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <label>
        기준 날짜
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {data &&
        (mode === "작업진행자별"
          ? data.workers.map((w) => (
              <section key={w.id}>
                <h2
                  style={{
                    borderLeft: `5px solid ${w.color}`,
                    paddingLeft: 10,
                  }}
                >
                  {w.displayName}
                </h2>
                {data.events
                  .filter((e) => e.workerIds.includes(w.id))
                  .map(card)}
              </section>
            ))
          : data.events.map(card))}
      {data && !data.events.length && <p>배정된 일정이 없습니다.</p>}
    </>
  );
}
function MobileWork({
  work,
  onChanged,
  onBack,
  onDirty,
}: {
  onDirty: (dirty: boolean) => void;
  work: DailyWork;
  onChanged: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState(work),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false);
  const labels = [
    "현장 확인",
    "작업지시 확인",
    "작업 시작",
    "작업 전 사진",
    "작업내용 / 사용자재",
    "작업 후 사진",
    "시험 / 확인",
    "작업완료 요청",
  ];
  const edit = (value: Partial<DailyWork>) => {
    setForm({ ...form, ...value });
    setDirty(true);
  };
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  async function save(action: "start" | "save" | "complete") {
    setError("");
    if (!navigator.onLine) {
      setError("연결 후 다시 저장해 주세요.");
      return;
    }
    if (
      action === "complete" &&
      (!form.operationConfirmed || !form.verificationNotes?.trim())
    ) {
      setError("시험/확인 내용과 정상작동 확인을 입력해 주세요.");
      setStep(6);
      return;
    }
    setBusy(true);
    try {
      let saved: DailyWork;
      if (action === "start")
        saved = await authApi(`/operational/daily-work/${work.id}/start`, {
          method: "POST",
        });
      else
        saved = await authApi(`/operational/daily-work/${work.id}`, {
          method: "PUT",
          body: JSON.stringify({
            ...form,
            ...(action === "complete"
              ? { status: "작업완료", endTime: form.endTime || clock() }
              : {}),
          }),
        });
      setForm(saved);
      setDirty(false);
      setNotice(
        action === "complete"
          ? "작업완료를 요청했습니다. 관리자 확인을 기다립니다."
          : "저장했습니다.",
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button
        onClick={() => {
          if (!dirty || confirm("저장하지 않은 내용을 닫을까요?")) onBack();
        }}
      >
        ← 작업 목록
      </button>
      <div className="mobile-step-list">
        {labels.map((l, i) => (
          <button
            key={l}
            aria-current={step === i ? "step" : undefined}
            onClick={() => setStep(i)}
          >
            {i + 1}. {l}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      <section className="mobile-card">
        <h2>{labels[step]}</h2>
        {step === 0 ? (
          <>
            <h3>{work.siteName}</h3>
            <p>
              {work.workDate} · {work.managerDisplayName}
            </p>
            <p>{work.content}</p>
          </>
        ) : step === 1 ? (
          <InstructionsPanel siteId={work.siteId} />
        ) : step === 2 ? (
          <>
            <p>
              {form.status} · 시작 {form.startTime || "미시작"}
            </p>
            <button
              className="primary"
              disabled={busy || form.status !== "작업예정"}
              onClick={() => save("start")}
            >
              현재 시각으로 작업 시작
            </button>
          </>
        ) : step === 3 || step === 5 ? (
          <>
            <p>
              {step === 3 ? "작업 전" : "작업 후"}을 선택하여 같은 위치에서
              촬영해 주세요.
            </p>
            <PhotosPanel
              key={step}
              dailyWorkId={work.id}
              fixedType={step === 3 ? "작업 전" : "작업 후"}
              onChanged={onChanged}
            />
          </>
        ) : step === 4 ? (
          <>
            <label>
              작업내용
              <textarea
                value={form.content}
                onChange={(e) => edit({ content: e.target.value })}
              />
            </label>
            <label>
              특이사항
              <textarea
                value={form.notes}
                onChange={(e) => edit({ notes: e.target.value })}
              />
            </label>
            <MaterialRows
              rows={form.materials}
              onChange={(materials) =>
                edit({ materials: materials as DailyWork["materials"] })
              }
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() => save("save")}
            >
              작업내용 저장
            </button>
          </>
        ) : step === 6 ? (
          <>
            <label>
              시험 / 확인 내용
              <textarea
                value={form.verificationNotes ?? ""}
                onChange={(e) => edit({ verificationNotes: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.operationConfirmed ?? false}
                onChange={(e) => edit({ operationConfirmed: e.target.checked })}
              />
              정상작동 확인
            </label>
            <button disabled={busy} onClick={() => save("save")}>
              확인내용 저장
            </button>
          </>
        ) : (
          <>
            <p>작업완료 요청 후 관리자가 최종 확인합니다.</p>
            <label>
              종료시간
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => edit({ endTime: e.target.value })}
              />
            </label>
            <button
              className="primary"
              disabled={busy || form.status !== "작업중"}
              onClick={() => save("complete")}
            >
              작업완료 요청
            </button>
          </>
        )}
      </section>
      <div className="mobile-step-actions">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>
          이전 단계
        </button>
        <button
          className="primary"
          disabled={step === 7}
          onClick={() => setStep(step + 1)}
        >
          다음 단계
        </button>
      </div>
    </section>
  );
}
function MobileFinance({ siteId }: { siteId: string }) {
  const [data, setData] = useState<Record<string, number>>({}),
    [error, setError] = useState("");
  useEffect(() => {
    authApi<Record<string, number>>("/operational/site-finance/" + siteId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [siteId]);
  const labels: Record<string, string> = {
    contractAmount: "계약금액",
    collectedAmount: "입금액",
    receivables: "미수금",
    totalExpenses: "총 현장지출",
    siteProfit: "현장차익",
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {Object.entries(data)
        .filter(([k]) => labels[k])
        .map(([k, v]) => (
          <p key={k}>
            {labels[k]} <strong>{v.toLocaleString("ko-KR")}원</strong>
          </p>
        ))}
    </>
  );
}
function MobileReview({ sites }: { sites: Site[] }) {
  return (
    <section className="mobile-card">
      <h2>미수 / 확인 필요</h2>
      <p>
        미수금 합계{" "}
        {sites
          .reduce(
            (sum, s) =>
              sum +
              Math.max(0, (s.contractAmount ?? 0) - (s.collectedAmount ?? 0)),
            0,
          )
          .toLocaleString("ko-KR")}
        원
      </p>
      <p>현장별 수금 및 확인 상태는 현장 상세에서 확인하세요.</p>
    </section>
  );
}
