"use client";
import {
  CompanyPicker,
  CompanyBrand,
  type PublicCompany,
  type CompanyChoice,
} from "./tenant-entry";
import PersonalProfile, { SignupForm } from "./account-forms";
import { createContext, useContext, useEffect, useState, useRef } from "react";
import { APP_BRAND, Company, DEFAULT_COMPANY } from "@jongro/shared";
import { CurrentUser, UserRole } from "@jongro/shared";
export type { CurrentUser, UserRole } from "@jongro/shared";
interface AuthAccount {
  id: string;
  email: string;
  providers: string[];
  approvalStatus: string;
}
interface AuthState {
  companies: CompanyChoice[];
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
  if (
    options?.method &&
    !["GET", "HEAD"].includes(options.method.toUpperCase()) &&
    !/tutorial|auth|quote-assets|initial-setup/.test(url)
  )
    window.dispatchEvent(new Event("app-saved"));
  return body;
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState("signed_out"),
    [account, setAccount] = useState<AuthAccount | null>(null),
    [authMode, setAuthMode] = useState("demo");
  const [user, setUser] = useState<CurrentUser | null>(null),
    [company, setCompany] = useState(DEFAULT_COMPANY),
    [loading, setLoading] = useState(true),
    [brand, setBrand] = useState<string>(APP_BRAND.name);
  const [companies, setCompanies] = useState<CompanyChoice[]>([]);
  const refreshVersion = useRef(0);
  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const r = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (version !== refreshVersion.current) return;
      if (r.status === 401) {
        setUser(null);
        setAccount(null);
        setAccess("signed_out");
        return;
      }
      if (!r.ok) {
        setUser(null);
        setAccess("unavailable");
        return;
      }
      const v = await r.json();
      if (version !== refreshVersion.current) return;
      setCompanies(v.companies ?? []);
      setAccess(v.access ?? "approved");
      setAccount(v.account ?? null);
      setAuthMode(v.authMode ?? "demo");
      setUser(v.user);
      if (v.company) setCompany(v.company);
      setBrand(v.appBrand.name);
    } catch {
      if (version === refreshVersion.current) {
        setUser(null);
        setAccess("unavailable");
      }
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }
  async function logout() {
    await authApi("/auth/logout", { method: "POST" });
    ++refreshVersion.current;
    setCompanies([]);
    setUser(null);
    setAccount(null);
    setAccess("signed_out");
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
      value={{
        companies,
        user,
        company,
        brand,
        loading,
        refresh,
        logout,
        access,
        account,
        authMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function LoginScreen({
  companyBrand,
  inviteToken,
}: {
  companyBrand?: PublicCompany;
  roleLabel?: string;
  inviteToken?: string;
} = {}) {
  const { refresh } = useAuth();
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false),
    [emailEnabled, setEmailEnabled] = useState(false),
    [googleEnabled, setGoogleEnabled] = useState(false);
  const [onboarding, setOnboarding] = useState(false),
    [signup, setSignup] = useState(false),
    [configError, setConfigError] = useState("");
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/auth/config", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!r.ok) throw Error();
        const v = await r.json();
        if (!alive) return;
        setEmailEnabled(v.loginProviders?.emailEnabled === true);
        setGoogleEnabled(v.loginProviders?.googleEnabled === true);
        setOnboarding(v.companyOnboardingEnabled === true);
        setConfigError("");
        setReady(true);
      } catch {
        if (alive) {
          setReady(false);
          setConfigError(
            "로그인 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
      }
    }
    if (new URLSearchParams(window.location.search).has("auth_error"))
      setError("로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !emailEnabled) return;
    setBusy(true);
    setError("");
    try {
      await authApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          login,
          password,
          ...(companyBrand ? { companySlug: companyBrand.slug } : {}),
        }),
      });
      setPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function register() {
    if (!companyBrand && !onboarding) {
      setSignup(true);
      return;
    }
    setNotice(
      "회사 관리자로부터 초대 링크를 받아 가입해 주세요. 최초 업체 관리자는 공통 홈의 새 업체 등록을 이용하세요.",
    );
  }
  return (
    <main className="login-page login-page-compact">
      <section className="login-card login-card-compact" aria-label="로그인">
        <CompanyBrand company={companyBrand} />
        {signup ? (
          <SignupForm onBack={() => setSignup(false)} />
        ) : (
          <>
            {ready && emailEnabled && (
              <form onSubmit={submit}>
                <label>
                  이메일 또는 아이디
                  <input
                    autoComplete="username"
                    enterKeyHint="next"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    type="password"
                    autoComplete="current-password"
                    enterKeyHint="go"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button className="primary login-submit" disabled={busy}>
                  {busy ? "로그인 중…" : "로그인"}
                </button>
              </form>
            )}
            {ready && (emailEnabled || googleEnabled) && (
              <nav className="login-support" aria-label="로그인 도움말">
                <button
                  className="login-text-link"
                  type="button"
                  onClick={() =>
                    setNotice(
                      "비밀번호를 잊으셨다면 회사 관리자에게 비밀번호 재설정을 요청해 주세요.",
                    )
                  }
                >
                  비밀번호 찾기
                </button>
                <span aria-hidden="true">·</span>
                {inviteToken ? (
                  <a
                    className="login-text-link"
                    href={"/join/" + encodeURIComponent(inviteToken)}
                  >
                    회원가입
                  </a>
                ) : (
                  <button
                    className="login-text-link"
                    type="button"
                    onClick={register}
                  >
                    회원가입
                  </button>
                )}
              </nav>
            )}
            {notice && (
              <p className="login-help-message" role="status">
                {notice}
                {notice.includes("새 업체 등록") && (
                  <>
                    {" "}
                    <a href="/">공통 홈</a>
                  </>
                )}
              </p>
            )}
            {ready && googleEnabled && (
              <div className="login-social">
                <a className="google-login" href="/api/auth/google">
                  Google로 로그인
                </a>
              </div>
            )}
            {ready && !emailEnabled && !googleEnabled && (
              <p role="status">
                현재 로그인 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해
                주세요.
              </p>
            )}
            {!ready && !configError && (
              <p role="status">로그인 방법을 확인하고 있습니다…</p>
            )}
            {configError && <p role="alert">{configError}</p>}
          </>
        )}
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
  const { user, logout, authMode, account, companies } = useAuth();
  const [choosing, setChoosing] = useState(false);
  const [signoutError, setSignoutError] = useState("");
  const [profile, setProfile] = useState(false);
  return (
    <div className="session-controls">
      {companies.filter((c) => c.active && c.status === "approved").length >
        1 && <button onClick={() => setChoosing(true)}>업체 전환</button>}
      {choosing && (
        <div
          className="account-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="업체 선택"
        >
          <CompanyPicker
            choices={companies}
            onClose={() => setChoosing(false)}
          />
        </div>
      )}
      {user?.isDemo && <span className="tutorial-sample-badge">체험판</span>}
      <span>
        {user?.displayName} · {user && ROLE_LABELS[user.role]}
      </span>
      {authMode !== "trial" && (
        <button onClick={() => setProfile(true)}>내 정보</button>
      )}
      {authMode === "trial" && <TrialControls />}
      <button
        onClick={() =>
          void logout().catch(() =>
            setSignoutError("로그아웃에 실패했습니다. 다시 시도하세요."),
          )
        }
      >
        로그아웃
      </button>
      {signoutError && <span role="alert">{signoutError}</span>}
      {authMode === "supabase" && (
        <GoogleAccountLink providers={account?.providers ?? []} />
      )}
      {profile && (
        <div
          className="account-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="내 정보"
        >
          <button onClick={() => setProfile(false)}>닫기</button>
          <PersonalProfile />
        </div>
      )}
    </div>
  );
}

export function AuthAccessNotice() {
  const { access, account, refresh, logout, companies } = useAuth();
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  if (access === "choose_company" || picking)
    return (
      <CompanyPicker
        choices={companies}
        onClose={picking ? () => setPicking(false) : undefined}
      />
    );
  return (
    <main className="login-page">
      <section className="login-card auth-access-notice">
        <h1>
          {access === "pending"
            ? "관리자 승인 대기 중입니다."
            : access === "customer"
              ? "고객 계정"
              : access === "unavailable"
                ? "로그인 상태 확인 필요"
                : "업무 접근이 제한되었습니다"}
        </h1>
        {account && <p>{account.email}</p>}
        <p>
          {access === "pending"
            ? "로그인은 완료되었습니다. 관리자가 소속 회사와 역할(관리자·사내직원·작업진행자·고객)을 지정하고 승인할 때까지 회사 자료에 접근할 수 없습니다."
            : access === "customer"
              ? "고객 역할로 승인되었습니다. 고객 전용 업무 화면은 준비 중이며 사내 업무 자료에는 접근할 수 없습니다."
              : "승인·활성 상태와 서버 연결을 확인해 주세요. 다른 회사 자료를 대신 표시하지 않습니다."}
        </p>
        <button onClick={() => void refresh()}>승인 상태 다시 확인</button>
        {companies.some((c) => c.active && c.status === "approved") && (
          <button onClick={() => setPicking(true)}>다른 업체 선택</button>
        )}
        {account && <GoogleAccountLink providers={account.providers} />}
        <button
          onClick={() =>
            void logout().catch(() =>
              setError("로그아웃을 완료하지 못했습니다. 다시 시도하세요."),
            )
          }
        >
          로그아웃
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}

function TrialControls() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function reset(seed: boolean) {
    if (
      !confirm(
        seed
          ? "체험 중 입력한 내용을 지우고 예시 데이터를 다시 생성할까요?"
          : "체험 공간의 모든 자료를 삭제하고 빈 공간으로 시작할까요?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await authApi("/trial/reset", {
        method: "POST",
        body: JSON.stringify({ seed }),
      });
      sessionStorage.setItem("demo-entry", "home");
      window.location.assign("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="trial-controls" aria-label="체험 관리">
      <small>체험 전용 · 2시간 후 종료 · 실제 자료를 입력하지 마세요.</small>
      <button disabled={busy} onClick={() => void reset(false)}>
        예시 데이터 초기화
      </button>
      <button disabled={busy} onClick={() => void reset(true)}>
        예시 데이터 다시 생성
      </button>
      <button
        disabled={busy}
        onClick={() => {
          sessionStorage.setItem("demo-entry", "tutorial");
          window.location.assign("/");
        }}
      >
        튜토리얼 다시보기
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function GoogleAccountLink({ providers }: { providers: string[] }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    authApi<{ loginProviders?: { googleEnabled: boolean } }>("/auth/config")
      .then((v) => {
        if (alive) setEnabled(v.loginProviders?.googleEnabled === true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function link() {
    setBusy(true);
    setError("");
    try {
      const { url } = await authApi<{ url: string }>(
        "/auth/link/google?response=json",
        { method: "POST" },
      );
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (!enabled) return null;
  return (
    <div className="google-account-link">
      <button type="button" disabled={busy} onClick={() => void link()}>
        {busy ? "연결 준비 중…" : "Google 계정 연결"}
      </button>
      <small>연결된 제공자: {providers.join(" · ") || "확인 중"}</small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
