"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  canonicalScreen,
  SCREEN_HELP,
  TUTORIAL_VERSION,
  tutorialCacheKey,
  tutorialSteps,
  TutorialRole,
  TutorialScreen,
  TutorialProgress,
  TutorialBundle,
  TutorialSample,
} from "@jongro/shared";
import { authApi, useAuth } from "./auth-provider";
import InputGuides from "./input-guides";
import GuidedNumberInput from "./quote-number-input";
interface GuideContext {
  register: (
    screen: TutorialScreen,
    go: (screen: TutorialScreen) => void,
  ) => void;
  help: () => void;
}
const Guide = createContext<GuideContext | null>(null);
export function useTutorialWorkspace(
  menu: string,
  navigate: (screen: TutorialScreen) => void,
) {
  const ctx = useContext(Guide);
  const latest = useRef(navigate);
  latest.current = navigate;
  const screen = canonicalScreen(menu);
  useEffect(() => {
    ctx?.register(screen, (s) => latest.current(s));
  }, [ctx?.register, screen]);
  return screen;
}
export function ScreenHelpButton() {
  const ctx = useContext(Guide);
  return (
    <button
      className="screen-help"
      type="button"
      onClick={() => ctx?.help()}
      aria-label="도움말"
    >
      <b aria-hidden="true">?</b> 도움말
    </button>
  );
}
function cached(
  key: string,
): (TutorialProgress & { pending?: boolean }) | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    return p &&
      p.version === TUTORIAL_VERSION &&
      ["new", "in_progress", "completed", "skipped"].includes(p.status) &&
      Number.isInteger(p.step)
      ? p
      : null;
  } catch {
    return null;
  }
}
export default function OnboardingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  const role = user?.role as TutorialRole;
  const key = user ? tutorialCacheKey(user.companyId, user.id, user.role) : "";
  const steps = useMemo(
    () =>
      tutorialSteps(
        ["admin", "staff", "worker"].includes(role) ? role : "worker",
        user?.role === "admin" || user?.permissions.includes("writeQuotes"),
      ),
    [role, user?.permissions.join(",")],
  );
  const [progress, setProgress] = useState<TutorialProgress | null>(null),
    [bundle, setBundle] = useState<TutorialBundle | null>(null),
    [tour, setTour] = useState(false),
    [finish, setFinish] = useState(false),
    [help, setHelp] = useState(false),
    [screen, setScreen] = useState<TutorialScreen>("home"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [rect, setRect] = useState<DOMRect | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const intent = useRef(0);
  const navigator = useRef<(screen: TutorialScreen) => void>(() => {}),
    scope = useRef(key);
  scope.current = key;
  const register = useCallback(
    (s: TutorialScreen, go: (screen: TutorialScreen) => void) => {
      navigator.current = go;
      setScreen(s);
    },
    [],
  );
  const openHelp = useCallback(() => setHelp(true), []);
  useEffect(()=>{window.addEventListener("open-tutorial-help",openHelp);return()=>window.removeEventListener("open-tutorial-help",openHelp)},[openHelp]);
  const remember = (p: TutorialProgress) => {
    setProgress(p);
    try {
      localStorage.setItem(key, JSON.stringify({ ...p, pending: true }));
    } catch {}
  };
  async function save(
    status: TutorialProgress["status"],
    step = progress?.step ?? 0,
  ) {
    if (!progress) return;
    const captured = key;
    const sequence = ++intent.current;
    const p = {
      ...progress,
      status,
      step,
      updatedAt: new Date().toISOString(),
    };
    remember(p);
    const operation = writes.current.then(async () => {
      if (scope.current !== captured) return;
      try {
        const saved = await authApi<TutorialProgress>("/tutorial/progress", {
          method: "PUT",
          body: JSON.stringify({ status, step, version: TUTORIAL_VERSION }),
        });
        if (scope.current === captured && intent.current === sequence) {
          try {
            localStorage.setItem(
              captured,
              JSON.stringify({ ...saved, pending: false }),
            );
          } catch {}
        }
      } catch {
        if (scope.current === captured)
          setError(
            "진행상태는 이 브라우저에 저장했습니다. 서버 연결 후 다시 동기화하세요.",
          );
      }
    });
    writes.current = operation.catch(() => {});
    await operation;
  }
  async function createSamples() {
    const captured = key;
    setBusy(true);
    try {
      const value = await authApi<TutorialBundle>("/tutorial/samples", {
        method: "POST",
      });
      if (scope.current === captured) {
        setBundle(value);
        setError("");
      }
    } catch (e) {
      if (scope.current === captured) setError((e as Error).message);
    } finally {
      if (scope.current === captured) setBusy(false);
    }
  }
  async function deleteSamples() {
    if (
      !confirm(
        "튜토리얼용 예시 데이터만 삭제합니다. 실제로 입력한 데이터는 삭제되지 않습니다.",
      )
    )
      return false;
    const captured = key;
    setBusy(true);
    try {
      await authApi("/tutorial/samples", { method: "DELETE" });
      if (scope.current === captured) {
        setBundle(null);
        setError("");
      }
      return true;
    } catch (e) {
      if (scope.current === captured) setError((e as Error).message);
      return false;
    } finally {
      if (scope.current === captured) setBusy(false);
    }
  }
  useEffect(() => {
    setProgress(null);
    setBundle(null);
    setTour(false);
    setFinish(false);
    setHelp(false);
    setError("");
    if (!user || !["admin", "staff", "worker"].includes(role)) return;
    let alive = true;
    Promise.all([
      authApi<TutorialProgress>("/tutorial/progress"),
      authApi<{ bundle: TutorialBundle | null }>("/tutorial/samples"),
    ])
      .then(async ([remote, result]) => {
        if (!alive) return;
        const samples = result.bundle;
        const local = cached(key);
        const p =
          local &&
          (local.pending ||
            Date.parse(local.updatedAt ?? "") >
              (Date.parse(remote.updatedAt ?? "") || 0))
            ? { ...local, samplesPresent: remote.samplesPresent }
            : remote;
        p.step = Math.min(p.step, steps.length - 1);
        setProgress(p);
        setBundle(samples);
        if (local && p !== remote)
          await authApi<TutorialProgress>("/tutorial/progress", {
            method: "PUT",
            body: JSON.stringify({
              status: p.status,
              step: p.step,
              version: TUTORIAL_VERSION,
            }),
          })
            .then((saved) => {
              if (alive)
                try {
                  localStorage.setItem(
                    key,
                    JSON.stringify({ ...saved, pending: false }),
                  );
                } catch {}
            })
            .catch(() => {});
        if (!alive) return;
        const entry=sessionStorage.getItem("demo-entry");
        sessionStorage.removeItem("demo-entry");
        if(entry==="home") { setTour(false); const saved=await authApi<TutorialProgress>("/tutorial/progress",{method:"PUT",body:JSON.stringify({status:"skipped",step:0,version:TUTORIAL_VERSION})});localStorage.setItem(key,JSON.stringify({...saved,pending:false}));setProgress(saved);if(!samples) {const value=await authApi<TutorialBundle>("/tutorial/samples",{method:"POST"});if(alive)setBundle(value)} return; }
        if (entry==="tutorial") {p.status="in_progress";p.step=0;const saved=await authApi<TutorialProgress>("/tutorial/progress",{method:"PUT",body:JSON.stringify({status:"in_progress",step:0,version:TUTORIAL_VERSION})});Object.assign(p,saved);localStorage.setItem(key,JSON.stringify({...saved,pending:false}));setProgress({...p});}
        if (p.status === "new" || p.status === "in_progress") {
          setTour(true);
          if ((p.status === "new" || entry==="tutorial") && !samples) {
            const value = await authApi<TutorialBundle>("/tutorial/samples", {
              method: "POST",
            });
            if (alive) setBundle(value);
          }
        }
      })
      .catch(() => {
        if (!alive) return;
        const local = cached(key);
        if (local) {
          setProgress(local);
          setTour(local.status === "in_progress");
        }
        setError(
          "튜토리얼 정보를 불러오지 못했습니다. 도움말에서 다시 시도하세요.",
        );
      });
    return () => {
      alive = false;
    };
  }, [key, steps, retry]);
  const step = steps[Math.min(progress?.step ?? 0, steps.length - 1)];
  useEffect(() => {
    if (!tour || finish || !step) return;
    navigator.current(step.screen);
  }, [tour, progress?.step, finish, step?.id]);
  useEffect(() => {
    if (!tour || finish) return;
    let target: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      const root = document.querySelector<HTMLElement>(
        "[data-onboarding-screen]",
      );
      if (!root) return;
      const matches = step.target
        ? Array.from(root.querySelectorAll<HTMLElement>("button")).filter(
            (n) =>
              n.textContent?.includes(step.target!) &&
              n.getBoundingClientRect().width > 0,
          )
        : [];
      target = matches[0] ?? root.querySelector("h1");
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        setRect(target.getBoundingClientRect());
      }
    };
    timer = setTimeout(find, 180);
    const update = () => target && setRect(target.getBoundingClientRect());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer = new MutationObserver(() => {
      if (!target || !target.isConnected) find();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      setRect(null);
    };
  }, [tour, finish, progress?.step, screen]);
  async function restart() {
    if (
      !confirm(
        "튜토리얼 화면으로 이동합니다. 작성 중인 내용을 먼저 저장해 주세요. 계속할까요?",
      )
    )
      return;
    setHelp(false);
    setFinish(false);
    await save("in_progress", 0);
    setTour(true);
  }
  async function complete(remove: boolean) {
    if (remove && !(await deleteSamples())) return;
    await save("completed", steps.length - 1);
    setTour(false);
    setFinish(false);
    navigator.current("home");
  }
  const context = useMemo(
    () => ({ register, help: openHelp }),
    [register, openHelp],
  );
  return (
    <Guide.Provider value={context}>
      {children}
      {user && <InputGuides />}
      {user && ["admin", "staff", "worker"].includes(role) && (
        <>
          {tour && !finish && rect && (
            <div
              className="tutorial-focus"
              aria-hidden="true"
              style={{
                top: rect.top - 5,
                left: rect.left - 5,
                width: rect.width + 10,
                height: rect.height + 10,
              }}
            />
          )}
          {tour && progress && (
            <section
              className="tutorial-coach"
              role="region"
              aria-label="역할별 튜토리얼"
            >
              <div className="tutorial-coach-heading">
                <strong>
                  {role === "admin"
                    ? "관리자"
                    : role === "staff"
                      ? "사내직원"
                      : "작업진행자"}{" "}
                  업무 가이드
                </strong>
                <span>
                  {finish ? "완료" : `${progress.step + 1} / ${steps.length}`}
                </span>
              </div>
              {finish ? (
                <>
                  <h2>이제 실제 업무를 시작해 보세요.</h2>
                  <p>체험용 예시는 실제 업무 데이터와 분리되어 있습니다.</p>
                  <button disabled={busy} onClick={() => complete(true)}>
                    예시 데이터 삭제하고 시작
                  </button>
                  <button disabled={busy} onClick={() => complete(false)}>
                    예시 데이터 유지
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setFinish(false);
                      save("in_progress", 0);
                    }}
                  >
                    튜토리얼 다시보기
                  </button>
                </>
              ) : (
                <>
                  <h2>{step.title}</h2>
                  <p>{step.text}</p>
                  {screen !== step.screen && (
                    <button onClick={() => navigator.current(step.screen)}>
                      안내 화면 열기
                    </button>
                  )}
                  <details className="tutorial-sample-details">
                    <summary>예시로 체험하기 · 실제 데이터와 분리</summary>
                    <TutorialExamples
                      bundle={bundle}
                      kind={step.sample}
                      onChange={setBundle}
                      onCreate={createSamples}
                      busy={busy}
                    />
                  </details>
                  <div className="tutorial-actions">
                    <button
                      disabled={busy || progress.step === 0}
                      onClick={() => save("in_progress", progress.step - 1)}
                    >
                      이전
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        save("skipped");
                        setTour(false);
                      }}
                    >
                      건너뛰기
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        progress.step === steps.length - 1
                          ? setFinish(true)
                          : save("in_progress", progress.step + 1)
                      }
                    >
                      {progress.step === steps.length - 1 ? "마침" : "다음"}
                    </button>
                  </div>
                </>
              )}
              {error && <p role="status">{error}</p>}
            </section>
          )}
          {help && (
            <div
              className="tutorial-help-backdrop"
              onKeyDown={(e) => {
                if (e.key === "Escape") setHelp(false);
                if (e.key === "Tab") {
                  const nodes = Array.from(
                    e.currentTarget.querySelectorAll<HTMLElement>(
                      "button,input,summary",
                    ),
                  );
                  const first = nodes[0],
                    last = nodes[nodes.length - 1];
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <section
                className="tutorial-help"
                role="dialog"
                aria-modal="true"
                aria-label="화면 도움말"
              >
                <button autoFocus type="button" onClick={() => setHelp(false)}>
                  도움말 닫기
                </button>
                <h2>이 화면은 이렇게 사용하세요</h2>
                <p>{SCREEN_HELP[screen]}</p>
                <p>
                  역할별 진행:{" "}
                  {progress?.status === "completed"
                    ? "완료"
                    : progress?.status === "skipped"
                      ? "건너뜀"
                      : progress?.status === "in_progress"
                        ? "진행 중"
                        : "처음 사용"}
                </p>
                <div className="tutorial-help-actions">
                  <button disabled={busy || !progress} onClick={restart}>
                    튜토리얼 다시보기
                  </button>
                  <button disabled={busy} onClick={createSamples}>
                    예시 데이터 생성
                  </button>
                  <button disabled={busy || !bundle} onClick={deleteSamples}>
                    예시 데이터 삭제
                  </button>
                  <button
                    disabled={busy || !progress}
                    onClick={async () => {
                      if (
                        confirm(
                          "튜토리얼 진행상태만 초기화합니다. 실제 업무 데이터와 예시 데이터는 삭제하지 않습니다.",
                        )
                      ) {
                        await save("new", 0);
                        setTour(false);
                        setFinish(false);
                      }
                    }}
                  >
                    튜토리얼 진행상태 초기화
                  </button>
                </div>
                {[['quotes','견적 튜토리얼'],['sites','현장관리 튜토리얼'],...(role==='admin'?[['finance','정산 튜토리얼']]:[])].filter(([s])=>steps.some(v=>v.screen===s)).map(([s,label])=><button key={s} onClick={async()=>{setHelp(false);setFinish(false);await save("in_progress",steps.findIndex(v=>v.screen===s));setTour(true)}}>{label}</button>)}
                <p>예시 데이터 설명: 체험용 자료는 회사·사용자별 별도 공간에 저장합니다. 아래 삭제·다시 생성은 튜토리얼 자료만 대상으로 하며 기존 공용 샘플과 실제 입력 자료는 유지합니다.</p>
                <TutorialExamples
                  key={screen}
                  kind={screen==="company"?"company":undefined}
                  bundle={bundle}
                  onChange={setBundle}
                  onCreate={createSamples}
                  busy={busy}
                />
                {error && (
                  <>
                    <p role="alert">{error}</p>
                    <button onClick={() => setRetry((v) => v + 1)}>
                      튜토리얼 정보 다시 불러오기
                    </button>
                  </>
                )}
                <small>
                  튜토리얼 예시와 기존 업무 샘플은 서로 다릅니다. 이 버튼은
                  튜토리얼 예시만 삭제합니다.
                </small>
              </section>
            </div>
          )}
        </>
      )}
    </Guide.Provider>
  );
}
function TutorialExamples({
  bundle,
  kind,
  onChange,
  onCreate,
  busy,
}: {
  bundle: TutorialBundle | null;
  kind?: string;
  onChange: (b: TutorialBundle) => void;
  onCreate: () => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(kind ?? "sites"),
    [draft, setDraft] = useState<TutorialSample | null>(null),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [preview, setPreview] = useState("");
  const record = bundle?.records.find((r) => r.kind === (kind ?? selected));
  useEffect(() => {
    setDraft(record ? structuredClone(record) : null);
  }, [record, bundle]);
  useEffect(()=>{setMessage("");setPreview("");},[record?.id,kind]);
  if (!bundle)
    return (
      <div className="tutorial-examples">
        <p>표시할 튜토리얼 예시가 없습니다.</p>
        <button disabled={busy} onClick={onCreate}>
          예시 다시 불러오기
        </button>
      </div>
    );
  const update = (key: string, value: string | number) =>
    setDraft(
      draft ? { ...draft, fields: { ...draft.fields, [key]: value } } : null,
    );
  async function save(fields = draft?.fields) {
    if (!draft || !fields) return;
    setSaving(true);
    try {
      const saved = await authApi<TutorialSample>(
        "/tutorial/samples/" + encodeURIComponent(draft.id),
        {
          method: "PUT",
          body: JSON.stringify({
            fields: Object.fromEntries(
              Object.entries(fields).filter(([key]) => !["작업전", "작업후"].includes(key)),
            ),
          }),
        },
      );
      onChange({
        ...bundle!,
        records: bundle!.records.map((r) => (r.id === saved.id ? saved : r)),
      });
      setMessage(
        "예시에만 저장했습니다. 실제 업무 데이터는 변경되지 않았습니다.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="tutorial-examples" aria-label="튜토리얼 예시 체험">
      <strong className="tutorial-sample-badge">
        체험용 · 실제 데이터 아님
      </strong>
      {!kind && (
        <label>
          예시 선택
          <select
            aria-label="예시 선택"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {bundle.records.map((r) => (
              <option key={r.id} value={r.kind}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft ? (
        <>
          <h3>{draft.title}</h3><button disabled={saving} onClick={async()=>{if(!confirm("선택한 튜토리얼 예시만 초기 상태로 되돌립니다. 실제 자료는 변경하지 않습니다."))return;setSaving(true);try{const reset=await authApi<TutorialSample>("/tutorial/samples/"+encodeURIComponent(draft.id)+"/reset",{method:"POST"});onChange({...bundle,records:bundle.records.map(r=>r.id===reset.id?reset:r)});setMessage("선택한 예시를 되돌렸습니다.")}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}}}>선택한 예시 초기 상태로 되돌리기</button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="tutorial-example-fields">
              {Object.entries(draft.fields)
                .filter(([k]) => !["작업전", "작업후"].includes(k))
                .map(([k, v]) => (
                  <label key={k}>
                    {k}
                    {typeof v === "number" ? (
                      <GuidedNumberInput
                        aria-label={`예시 ${k}`}
                        value={v}
                        onValue={(n) => update(k, n)}
                        min={0}
                      />
                    ) : (
                      <input
                        aria-label={`예시 ${k}`}
                        value={v}
                        maxLength={1000}
                        onChange={(e) => update(k, e.target.value)}
                      />
                    )}
                  </label>
                ))}
            </div>
            {draft.kind === "quotes" && (
              <p>
                예시 금액:{" "}
                {(
                  Number(draft.fields.수량) * Number(draft.fields.단가)
                ).toLocaleString("ko-KR")}
                원 · 등록 단가와 무관한 체험값
              </p>
            )}
            {draft.kind === "photos" && (
              <>
                <div className="tutorial-example-photos">
                  <figure>
                    <img
                      src={preview || String(draft.fields.작업전)}
                      alt="튜토리얼 작업 전 예시"
                    />
                    <figcaption>작업 전 · 체험용</figcaption>
                  </figure>
                  <figure>
                    <img
                      src={String(draft.fields.작업후)}
                      alt="튜토리얼 작업 후 예시"
                    />
                    <figcaption>작업 후 · 체험용</figcaption>
                  </figure>
                </div>
                <label>
                  예시 사진 선택 (실제 업로드 없음)
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    capture="environment"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (
                        f.size > 1024 * 1024 ||
                        !["image/png", "image/jpeg"].includes(f.type)
                      ) {
                        setMessage("1MB 이하 PNG/JPG를 선택하세요.");
                        return;
                      }
                      const r = new FileReader();
                      r.onload = () => {
                        setPreview(String(r.result));
                        update(
                          "추가사진수",
                          Number(draft.fields.추가사진수) + 1,
                        );
                        setMessage(
                          "이 화면에서만 미리봅니다. 실제 사진 저장소에 업로드하지 않습니다.",
                        );
                      };
                      r.readAsDataURL(f);
                    }}
                  />
                </label>
              </>
            )}
            {draft.kind === "work" && (
              <div className="tutorial-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ ...draft.fields, 상태: "작업중",시작시간:new Date().toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul",hour12:false}) })}
                >
                  예시 작업 시작
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ ...draft.fields, 상태: "완료요청",종료시간:new Date().toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul",hour12:false}) })}
                >
                  예시 완료 요청
                </button>
              </div>
            )}
            <button type="submit" disabled={saving || busy}>
              예시에만 저장
            </button>
          </form>
        </>
      ) : (
        <p>이 역할에서 체험할 수 있는 예시가 없습니다.</p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function tutorialMenu(
  screen: TutorialScreen,
  role: string,
  mobile = false,
): string {
  if (mobile)
    return {
      home: "홈",
      sites: role === "admin" ? "현장" : "내 현장",
      quotes: "견적",
      schedule: role === "admin" ? "배정관리" : "일정",
      workers: "작업진행자",
      work: "작업",
      photos: "사진",
      materials: "자재단가",
      finance: role === "worker" ? "내 정산" : "정산",
      reports: "완료보고서",
      notifications: "알림",
      as: "A/S",
      company: "회사 설정",
      users: "사용자 관리",
      other: "홈",
    }[screen];
  if (role === "admin")
    return {
      home: "홈",
      sites: "현장",
      quotes: "견적",
      schedule: "작업진행자 스케줄",
      workers: "작업진행자",
      work: "일일작업",
      photos: "현장",
      materials: "자재·경비",
      finance: "정산",
      reports: "현장",
      notifications: "알림센터",
      as: "A/S 관리",
      company: "회사 설정",
      users: "사용자 관리",
      other: "홈",
    }[screen];
  return {
    home: role === "worker" ? "오늘 일정" : "일정",
    sites: role === "worker" ? "내 현장" : "허용된 현장",
    quotes: "견적",
    schedule: role === "worker" ? "오늘 일정" : "일정",
    workers: "허용된 현장",
    work: role === "worker" ? "작업완료" : "일일작업",
    photos: "사진",
    materials: "일일작업",
    finance: role === "worker" ? "내 정산" : "현장 재무",
    reports: "완료보고서",
    notifications: "작업지시",
    as: "A/S",
    company: "일정",
    users: "일정",
    other: "일정",
  }[screen];
}
