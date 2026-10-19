"use client";
import DemoWelcome from "./demo-welcome";
import PersonalProfile,{SignupForm} from "./account-forms";
import { createContext, useContext, useEffect, useState } from "react";
import { APP_BRAND, Company, DEFAULT_COMPANY } from "@jongro/shared";
import FieldHelper from "./field-helper";
import { CurrentUser, UserRole } from "@jongro/shared";
export type { CurrentUser, UserRole } from "@jongro/shared";
interface AuthAccount { id:string; email:string; providers:string[]; approvalStatus:string; }
interface AuthState {
  access: string;
  account: AuthAccount | null;
  authMode: string;
  user: CurrentUser | null;
  company: Company;
  brand: string;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw Error("AuthProvider is required");
  return context;
}
export async function authApi<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const r = await fetch("/api" + url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await r.json();
  if (!r.ok)
    throw Error(
      Array.isArray(body.message)
        ? body.message.join(", ")
        : (body.message ?? "요청에 실패했습니다."),
    );
  if(options?.method&&!["GET","HEAD"].includes(options.method.toUpperCase())&&!/tutorial|auth|quote-assets|initial-setup/.test(url))window.dispatchEvent(new Event("app-saved"));
  return body;
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState("signed_out"), [account, setAccount] = useState<AuthAccount | null>(null), [authMode, setAuthMode] = useState("demo");
  const [user, setUser] = useState<CurrentUser | null>(null),
    [company, setCompany] = useState(DEFAULT_COMPANY),
    [loading, setLoading] = useState(true),
    [brand, setBrand] = useState<string>(APP_BRAND.name);
  async function refresh() {
    try {
      const r = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (r.status === 401) {
        setUser(null); setAccount(null); setAccess("signed_out");
        return;
      }
      if (!r.ok) { setUser(null); setAccess("unavailable"); return; }
      const v = await r.json();
      setAccess(v.access ?? "approved"); setAccount(v.account ?? null); setAuthMode(v.authMode ?? "demo");
      setUser(v.user);
      if(v.company)setCompany(v.company);
      setBrand(v.appBrand.name);
    } catch {
      setUser(null); setAccess("unavailable");
    } finally {
      setLoading(false);
    }
  }
  async function logout() {
    await authApi("/auth/logout", { method: "POST" });
    setUser(null); setAccount(null); setAccess("signed_out");
  }
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    window.addEventListener("auth-changed", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("auth-changed", refresh);
    };
  }, []);
  return (
    <AuthContext.Provider
      value={{ user, company, brand, loading, refresh, logout, access, account, authMode }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function LoginScreen() {
  const { brand, refresh } = useAuth();
  const [demoAccount,setDemoAccount]=useState<string|null>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [realLogin, setRealLogin] = useState(false), [realReady, setRealReady] = useState(false);
  const [configError, setConfigError] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [signup,setSignup]=useState(false);
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    if(new URLSearchParams(window.location.search).has("auth_error"))setError("Google/이메일 인증을 완료하지 못했습니다. 다시 로그인해 주세요.");
    const load = async () => {
      try {
        const r = await fetch("/api/auth/config", { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) throw Error(`설정 조회 실패 (${r.status})`);
        const v = await r.json();
        if (typeof v.demoEnabled !== "boolean") throw Error("로그인 설정 응답 오류");
        if (!active) return;
        setDemoEnabled(v.demoEnabled); setRealLogin(v.authMode === "supabase"); setRealReady(v.supabaseConfigured === true);
        setApiVersion(v.buildVersion ?? v.loginRevision ?? "unknown");
        setConfigError("");
      } catch (e) {
        if (active) setConfigError("로그인 설정을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.");
        console.warn("[login-config]", (e as Error).message);
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    window.addEventListener("pageshow", load);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("focus", load); window.removeEventListener("online", load); window.removeEventListener("pageshow", load); document.removeEventListener("visibilitychange", visible); };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await authApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password, remember }),
      });
      setPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="eyebrow">FIELD WORKSPACE</div>
        <h1>{brand}</h1>
        <p>
          현장에서 일하는 모두의
          <br />
          디지털 작업수첩
        </p>
        <FieldHelper
          pose="greeting"
          title="오늘도 안전한 현장을 함께 만듭니다."
          description="일정, 작업기록, 사진과 업무지시를 한곳에서."
        />
        <small>임시 앱 이름 · 회사별 업무 공간</small>
      </section>
      <section className="login-card">
        <div className="eyebrow">환영합니다</div>
        <h2>{brand} 로그인</h2>
        <p>회사 계정으로 로그인해 업무를 시작하세요.</p>
        {signup ? <SignupForm onBack={()=>setSignup(false)}/> : <form onSubmit={submit}>
          <label>
            이메일 또는 아이디
            <input
              autoComplete="username"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="이메일 또는 아이디"
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="login-options">
            {!realLogin && <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{" "}
              로그인 상태 유지
            </label>}
            {realLogin && <small>이 기기에서 로그인 세션을 유지합니다.</small>}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setNotice(
                  realLogin ? "비밀번호 재설정은 Supabase 인증 운영자에게 요청해 주세요." : "현재 테스트 환경입니다. 비밀번호 재설정은 회사 관리자에게 요청해 주세요.",
                )
              }
            >
              비밀번호 찾기
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <button className="primary login-submit" disabled={busy}>
            {busy ? "로그인 중…" : realLogin ? "이메일 로그인" : "로그인"}
          </button>
        </form>}
        {realLogin && <div className="real-auth-actions">
          {realReady ? <a className="google-login" href="/api/auth/google">Google로 계속하기</a> : <><button type="button" className="google-login" disabled>Google로 계속하기</button><p role="status">실제 로그인 연결 준비 중입니다. 운영자가 Render 서비스에 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 설정해야 합니다.</p></>}
          <p>신규 계정은 승인대기로 생성됩니다. 관리자가 회사와 역할을 지정한 뒤 업무 화면을 사용할 수 있습니다.</p>
        </div>}
        {!signup&&<button type="button" onClick={()=>setSignup(true)}>가입 신청</button>}
        {demoEnabled && (
          <section className="demo-login">
            <h3>모바일 검증용 데모 로그인</h3>

            <p>역할별 화면을 바로 확인하세요. 초기 테스트 비밀번호: <strong>README의 테스트 계정 안내 참고</strong></p>
            <div>
              {[
                ["admin", "관리자"],
                ["staff", "사내직원"],
                ["worker1", "작업진행자 1"],
                ["worker2", "작업진행자 2"],
              ].map(([account, label]) => (
                <button
                  type="button"
                  key={account}
                  disabled={busy}
                  onClick={() => setDemoAccount(account)}
                >
                  {label}로 체험
                </button>
              ))}
            </div>
          </section>
        )}
        {demoAccount && <DemoWelcome account={demoAccount} busy={busy} onCancel={()=>setDemoAccount(null)} onStart={async tutorial=>{setBusy(true);setError("");try {await authApi("/auth/demo",{method:"POST",body:JSON.stringify({account:demoAccount,remember})});sessionStorage.setItem("demo-entry",tutorial?"tutorial":"home");await refresh();}catch(e){setError((e as Error).message);setDemoAccount(null)}finally{setBusy(false)}}}/>}
        {configError && <p role="alert">{configError}</p>}
        <small className="login-note" data-testid="login-build-version">웹 버전: {process.env.NEXT_PUBLIC_BUILD_VERSION ?? "local"} · API 버전: {apiVersion || "확인 중"}</small>
        <p className="login-note">
          테스트 계정 안내는 README를 확인하세요.
          <br />
          현재는 메모리 인증 환경입니다.
        </p>
      </section>
    </main>
  );
}
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "관리자",
  staff: "사내직원",
  worker: "작업진행자",
  customer: "고객 (준비중)",
};
export function SessionHeader() {
  const { user, logout, authMode, account } = useAuth();
  const [signoutError, setSignoutError] = useState("");
  const [profile,setProfile]=useState(false);
  return (
    <div className="session-controls">
      {user?.isDemo && <span className="tutorial-sample-badge">체험판</span>}
      <span>
        {user?.displayName} · {user && ROLE_LABELS[user.role]}
      </span>
      <button onClick={()=>setProfile(true)}>내 정보</button>
      <button onClick={() => void logout().catch(() => setSignoutError("로그아웃에 실패했습니다. 다시 시도하세요."))}>로그아웃</button>
      {signoutError && <span role="alert">{signoutError}</span>}
      {authMode === "supabase" && <form method="post" action="/api/auth/link/google"><button type="submit">Google 계정 연결</button><small>{account?.providers.join(" · ")}</small></form>}
      {profile&&<div className="account-profile-dialog" role="dialog" aria-modal="true" aria-label="내 정보"><button onClick={()=>setProfile(false)}>닫기</button><PersonalProfile/></div>}
    </div>
  );
}

export function AuthAccessNotice() {
  const {access,account,refresh,logout}=useAuth();
  const [error,setError]=useState("");
  return <main className="login-page"><section className="login-card auth-access-notice">
    <h1>{access === "pending" ? "가입 승인대기" : access === "customer" ? "고객 계정" : access === "unavailable" ? "로그인 상태 확인 필요" : "업무 접근이 제한되었습니다"}</h1>
    {account && <p>{account.email}</p>}
    <p>{access === "pending" ? "로그인은 완료되었습니다. 관리자가 소속 회사와 역할(관리자·사내직원·작업진행자·고객)을 지정하고 승인할 때까지 회사 자료에 접근할 수 없습니다." : access === "customer" ? "고객 역할로 승인되었습니다. 고객 전용 업무 화면은 준비 중이며 사내 업무 자료에는 접근할 수 없습니다." : "승인·활성 상태와 서버 연결을 확인해 주세요. 다른 회사 자료를 대신 표시하지 않습니다."}</p>
    <button onClick={()=>void refresh()}>승인 상태 다시 확인</button>
    {account && <form method="post" action="/api/auth/link/google"><button type="submit">Google 계정 연결</button><p>연결된 제공자: {account.providers.join(" · ") || "확인 중"}</p></form>}
    <button onClick={()=>void logout().catch(()=>setError("로그아웃을 완료하지 못했습니다. 다시 시도하세요."))}>로그아웃</button>
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
