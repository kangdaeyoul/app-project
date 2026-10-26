"use client";
import { useEffect, useState } from "react";
import { authApi } from "./auth-provider";
export function TenantAdminTools() {
  const [enabled, setEnabled] = useState(false),
    [slug, setSlug] = useState(""),
    [invites, setInvites] = useState<any[]>([]),
    [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [branding, rows] = await Promise.all([
      authApi<any>("/tenant/branding"),
      authApi<any[]>("/tenant/invitations"),
    ]);
    setSlug(branding.slug);
    setInvites(rows);
  }
  useEffect(() => {
    let active = true;
    authApi<any>("/auth/config")
      .then((c) => {
        if (active && c.companyOnboardingEnabled) {
          setEnabled(true);
          load().catch((e) => setError(e.message));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!enabled) return null;
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="tenant-admin-tools"
      aria-label="회사 전용 주소와 초대 링크"
    >
      <h3>회사 전용 주소</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await authApi("/tenant/branding", {
              method: "PUT",
              body: JSON.stringify({ slug }),
            });
            setNotice("회사 전용 주소를 저장했습니다.");
          });
        }}
      >
        <label>
          회사 전용 주소
          <input
            required
            pattern="[a-z0-9][a-z0-9-]{1,62}"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <a href={"/c/" + slug}>/c/{slug}</a>
        <button disabled={busy}>주소 저장</button>
      </form>
      <h3>초대 링크</h3>
      <p>초대 링크는 7일간 유효하며 가입 후 관리자 승인이 필요합니다.</p>
      {(["staff", "worker"] as const).map((role) => (
        <button
          key={role}
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const result = await authApi<{ path: string }>(
                "/tenant/invitations",
                { method: "POST", body: JSON.stringify({ role }) },
              );
              setLink(window.location.origin + result.path);
            })
          }
        >
          {role === "staff" ? "사내직원" : "작업진행자"} 초대 링크 생성
        </button>
      ))}
      {link && (
        <div>
          <label>
            생성된 초대 링크 · 이 화면에서 복사해 보관하세요
            <input readOnly value={link} />
          </label>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setNotice("초대 링크를 복사했습니다."))
                .catch(() => setError("링크를 선택하여 직접 복사해 주세요."))
            }
          >
            초대 링크 복사
          </button>
        </div>
      )}
      {invites.map((i) => (
        <article key={i.id}>
          <strong>
            {i.role === "worker" ? "작업진행자" : "사내직원"} 초대
          </strong>
          <p>
            만료:{" "}
            {new Date(i.expires_at).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}{" "}
            · {i.is_active ? "활성" : "비활성"}
          </p>
          <button
            disabled={busy || !i.is_active}
            onClick={() =>
              void action(() =>
                authApi("/tenant/invitations/" + i.id + "/revoke", {
                  method: "PUT",
                }),
              )
            }
          >
            초대 링크 비활성화
          </button>
        </article>
      ))}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
