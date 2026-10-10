"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { APP_BRAND, Company, DEFAULT_COMPANY } from "@jongno/shared";
import FieldHelper from "./field-helper";
import { CurrentUser, UserRole } from "@jongno/shared";
export type { CurrentUser, UserRole } from "@jongno/shared";
interface AuthState {
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
  return body;
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
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
        setUser(null);
        return;
      }
      if (!r.ok) throw Error();
      const v = await r.json();
      setUser(v.user);
      setCompany(v.company);
      setBrand(v.appBrand.name);
    } catch {
    } finally {
      setLoading(false);
    }
  }
  async function logout() {
    try {
      await authApi("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
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
      value={{ user, company, brand, loading, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function LoginScreen() {
  const { brand, refresh } = useAuth();
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [company, setCompany] = useState(DEFAULT_COMPANY.displayName),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((v) => {
        setCompany(v.company.displayName);
        setDemoEnabled(v.demoEnabled === true);
      })
      .catch(() => {});
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
          현장을 아는 소방 실무자의
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
        <h2>{company}</h2>
        <p>회사 계정으로 로그인해 업무를 시작하세요.</p>
        <form onSubmit={submit}>
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
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{" "}
              로그인 상태 유지
            </label>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setNotice(
                  "현재 테스트 환경입니다. 비밀번호 재설정은 회사 관리자에게 요청해 주세요.",
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
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>
        {demoEnabled && (
          <section className="demo-login">
            <h3>모바일 검증용 데모 로그인</h3>
            <p>역할별 화면을 바로 확인하세요.</p>
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
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await authApi("/auth/demo", {
                        method: "POST",
                        body: JSON.stringify({ account, remember }),
                      });
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {label}로 체험
                </button>
              ))}
            </div>
          </section>
        )}
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
  const { user, logout } = useAuth();
  return (
    <div className="session-controls">
      <span>
        {user?.displayName} · {user && ROLE_LABELS[user.role]}
      </span>
      <button onClick={logout}>로그아웃</button>
    </div>
  );
}
