"use client";
import { useEffect, useState } from "react";
import { authApi, useAuth, LoginScreen, ROLE_LABELS } from "./auth-provider";
export interface PublicCompany {
  name: string;
  displayName: string;
  slug: string;
  logoUrl: string | null;
}
export function CompanyBrand({ company }: { company?: PublicCompany }) {
  return (
    <header className="tenant-brand">
      <img
        referrerPolicy="no-referrer"
        src={company?.logoUrl ?? "/icons/field-helper.svg"}
        alt={company ? `${company.name} 로고` : "현장관리 서비스 로고"}
      />
      <h1>{company?.name ?? "현장관리 서비스"}</h1>
    </header>
  );
}
export function CommonEntry() {
  const [mode, setMode] = useState("home");
  if (mode === "register")
    return <RegistrationForm onBack={() => setMode("home")} />;
  if (mode === "login")
    return (
      <>
        <button className="tenant-home" onClick={() => setMode("home")}>
          ← 공통 홈
        </button>
        <LoginScreen />
      </>
    );
  return (
    <main className="tenant-start tenant-start-compact">
      <section className="tenant-home-card">
        <CompanyBrand />
        <p className="tenant-home-copy">
          회사 계정으로 로그인하거나
          <br />새 업체를 등록해 시작하세요.
        </p>
        <div className="tenant-home-actions">
          <button className="primary" onClick={() => setMode("login")}>
            로그인
          </button>
          <button onClick={() => setMode("register")}>새 업체 등록</button>
        </div>
        <p className="tenant-home-note">
          사내직원·작업진행자는 회사에서 받은 초대 링크로 가입해 주세요.
        </p>
      </section>
    </main>
  );
}
export function RegistrationForm({
  inviteToken,
  company,
  role,
  onBack,
}: {
  inviteToken?: string;
  company?: PublicCompany;
  role?: string;
  onBack: () => void;
}) {
  const { account, refresh } = useAuth();
  const [values, setValues] = useState<Record<string, string>>({
    companyName: "",
    name: "",
    email: "",
    password: "",
    phone: "",
    registrationNumber: "",
    representative: "",
    companyPhone: "",
    address: "",
    logoUrl: "",
  });
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [loginExisting, setLoginExisting] = useState(false);
  const fields = inviteToken
    ? ["name", "phone", "email", "password"]
    : [
        "companyName",
        "name",
        "email",
        "password",
        "phone",
        "registrationNumber",
        "representative",
        "companyPhone",
        "address",
      ];
  const labels: Record<string, string> = {
    companyName: "회사명 또는 업체명",
    name: "이름",
    email: "이메일",
    password: "비밀번호",
    phone: "휴대폰번호",
    registrationNumber: "사업자등록번호",
    representative: "대표자명",
    companyPhone: "회사 전화번호",
    address: "주소",
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = inviteToken
        ? {
            kind: "invite",
            inviteToken,
            ...Object.fromEntries(
              ["name", "phone", "email", "password"].map((k) => [k, values[k]]),
            ),
          }
        : { kind: "company", ...values };
      const result = await authApi<{ message: string; companySlug?: string }>(
        "/tenant/register",
        { method: "POST", body: JSON.stringify(body) },
      );
      setNotice(result.message);
      setValues({ ...values, password: "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (inviteToken && loginExisting && !account)
    return (
      <>
        <button className="tenant-home" onClick={() => setLoginExisting(false)}>
          초대 가입 화면으로
        </button>
        <LoginScreen companyBrand={company} inviteToken={inviteToken} />
      </>
    );
  return (
    <main className="login-page">
      <section className="login-card tenant-registration">
        <CompanyBrand company={company} />
        <h2>
          {inviteToken
            ? `${role === "worker" ? "작업진행자" : "사내직원"} 가입 신청`
            : "새 업체 등록"}
        </h2>
        {account && inviteToken ? (
          <>
            <p>{account.email} 계정으로 이 업체에 가입 신청합니다.</p>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await authApi("/tenant/invites/" + inviteToken + "/apply", {
                    method: "POST",
                  });
                  setNotice(
                    "가입 신청이 완료되었습니다. 관리자 승인 대기 중입니다.",
                  );
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              현재 계정으로 가입 신청
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            {fields.map((k) => (
              <label key={k}>
                {labels[k]}
                {![
                  "companyName",
                  "name",
                  "email",
                  "password",
                  "phone",
                ].includes(k) && " (선택)"}
                <input
                  required={[
                    "companyName",
                    "name",
                    "email",
                    "password",
                    "phone",
                  ].includes(k)}
                  type={
                    k === "password"
                      ? "password"
                      : k === "email"
                        ? "email"
                        : k === "phone" || k === "companyPhone"
                          ? "tel"
                          : "text"
                  }
                  autoComplete={k === "password" ? "new-password" : undefined}
                  minLength={k === "password" ? 8 : undefined}
                  maxLength={k === "password" ? 200 : 300}
                  value={values[k]}
                  onChange={(e) =>
                    setValues({ ...values, [k]: e.target.value })
                  }
                />
              </label>
            ))}
            {!inviteToken && (
              <label>
                회사 로고 (선택 · PNG/JPG 300KB 이하)
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (
                      !["image/png", "image/jpeg"].includes(file.type) ||
                      file.size > 300_000
                    ) {
                      setError("PNG/JPG 300KB 이하 파일을 선택하세요.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () =>
                      setValues((v) => ({
                        ...v,
                        logoUrl: String(reader.result),
                      }));
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "처리 중…"
                : inviteToken
                  ? "가입 신청"
                  : "업체 및 관리자 등록"}
            </button>
          </form>
        )}
        {inviteToken && !account && (
          <button type="button" onClick={() => setLoginExisting(true)}>
            기존 계정으로 로그인
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <button onClick={onBack}>돌아가기</button>
        {notice && <a href="/">로그인 화면으로</a>}
        <p>
          {inviteToken
            ? "관리자 승인 후 업무를 시작할 수 있습니다."
            : "이메일 인증을 완료하면 최초 관리자로 로그인할 수 있습니다."}
        </p>
      </section>
    </main>
  );
}
export function TenantEntry({
  slug,
  inviteToken,
}: {
  slug?: string;
  inviteToken?: string;
}) {
  const [company, setCompany] = useState<PublicCompany>(),
    [role, setRole] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setCompany(undefined);
    setError("");
    authApi<any>(
      inviteToken
        ? "/tenant/invites/" + encodeURIComponent(inviteToken)
        : "/tenant/companies/" + encodeURIComponent(slug ?? ""),
    )
      .then((v) => {
        if (alive) {
          setCompany(inviteToken ? v.company : v);
          setRole(v.role ?? "");
        }
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [slug, inviteToken]);
  if (error)
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>{error}</h1>
          <a href="/">공통 홈으로 돌아가기</a>
        </section>
      </main>
    );
  if (!company)
    return (
      <main className="login-page">
        <p role="status">업체 정보를 확인하고 있습니다…</p>
      </main>
    );
  if (inviteToken)
    return (
      <RegistrationForm
        inviteToken={inviteToken}
        company={company}
        role={role}
        onBack={() => window.location.assign("/")}
      />
    );
  return <LoginScreen companyBrand={company} />;
}
export interface CompanyChoice {
  companyId: string;
  role: string | null;
  status: string;
  active: boolean;
  company: PublicCompany;
}
export function CompanyPicker({
  choices,
  onClose,
}: {
  choices: CompanyChoice[];
  onClose?: () => void;
}) {
  const { refresh, logout } = useAuth();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>접속할 업체를 선택해 주세요.</h1>
        {choices
          .filter((c) => c.active && c.status === "approved")
          .map((c) => (
            <button
              className="tenant-choice"
              key={c.companyId}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await authApi("/tenant/company-selection", {
                    method: "POST",
                    body: JSON.stringify({ companyId: c.companyId }),
                  });
                  if (window.location.pathname.startsWith("/c/")) {
                    window.location.assign("/c/" + c.company.slug);
                    return;
                  }
                  await refresh();
                  onClose?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <strong>{c.company.name}</strong>
              <span>
                역할:{" "}
                {ROLE_LABELS[c.role as keyof typeof ROLE_LABELS] ?? "확인 필요"}
              </span>
            </button>
          ))}
        {error && <p role="alert">{error}</p>}
        {onClose && <button onClick={onClose}>취소</button>}
        <button onClick={() => void logout().catch((e) => setError(e.message))}>
          로그아웃
        </button>
      </section>
    </main>
  );
}

/** A company URL never silently displays a different company's authenticated workspace. */
export function CompanyRouteGate({
  slug,
  children,
}: {
  slug?: string;
  children: React.ReactNode;
}) {
  const { user, companies, refresh, logout } = useAuth();
  const gateKey = slug + ":" + user?.companyId;
  const [readyKey, setReadyKey] = useState("");
  const [status, setStatus] = useState("loading"),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    if (!slug || !user) {
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    authApi<PublicCompany>("/tenant/companies/" + encodeURIComponent(slug))
      .then(async () => {
        const target = companies.find(
          (c) => c.company.slug === slug && c.active && c.status === "approved",
        );
        if (!target) throw Error("이 업체에 소속된 계정으로 로그인하세요.");
        if (target.companyId !== user.companyId) {
          await authApi("/tenant/company-selection", {
            method: "POST",
            body: JSON.stringify({ companyId: target.companyId }),
          });
          if (alive) await refresh();
        } else if (alive) {
          setReadyKey(gateKey);
          setStatus("ready");
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setStatus("error");
        }
      });
    return () => {
      alive = false;
    };
    // Membership changes are revalidated by the server on each operation; avoid refresh-driven effect loops.
  }, [slug, user?.id, user?.companyId]);
  if (!slug || !user) return children;
  if (status === "error")
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>{error}</h1>
          <a href="/">공통 홈</a>
          <button
            onClick={() => void logout().catch((e) => setError(e.message))}
          >
            다른 계정으로 로그인
          </button>
        </section>
      </main>
    );
  if (status !== "ready" || readyKey !== gateKey)
    return (
      <main className="login-page">
        <p role="status">업체를 확인하고 있습니다…</p>
      </main>
    );
  return children;
}
