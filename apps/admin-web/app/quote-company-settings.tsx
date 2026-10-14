"use client";
import { useEffect, useState } from "react";
import {
  Company,
  quoteCompanyDefaults,
  QuoteCompanySnapshot,
} from "@jongro/shared";
import { authApi, useAuth } from "./auth-provider";
import QuoteCompanyEditor from "./quote-company-editor";
export default function QuoteCompanySettings() {
  const { company, refresh } = useAuth();
  const [base, setBase] = useState(company),
    [profile, setProfile] = useState(quoteCompanyDefaults(company)),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setLoaded(false);
    authApi<{ company: Company }>("/company/current")
      .then((v) => {
        setBase(v.company);
        setProfile(quoteCompanyDefaults(v.company));
        setLoaded(true);
      })
      .catch((e) => setNotice(e.message));
  }, [retry]);
  return (
    <section className="panel">
      <h2>회사 설정 · 견적 기본정보</h2>
      <p>
        새 견적에 적용됩니다. 이미 저장한 견적의 회사정보·로고·직인은 변경하지
        않습니다.
      </p>
      {!loaded && (
        <p role="status">
          회사정보를 불러오는 중입니다.{" "}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            다시 불러오기
          </button>
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await authApi("/company/settings", {
              method: "PUT",
              body: JSON.stringify({
                ...base,
                name: profile.name,
                address: profile.address,
                phone: profile.phone,
                email: profile.email,
                quoteProfile: profile,
              }),
            });
            await refresh();
            setNotice(
              "회사 기본정보를 저장했습니다. 과거 견적의 정보는 유지됩니다.",
            );
          } catch (e) {
            setNotice((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          앱에서 표시할 회사명
          <input
            aria-label="화면 회사명"
            required
            disabled={busy || !loaded}
            value={base.displayName}
            onChange={(e) => setBase({ ...base, displayName: e.target.value })}
          />
        </label>
        <QuoteCompanyEditor
          value={profile}
          onChange={setProfile}
          disabled={busy || !loaded}
        />
        <button
          type="submit"
          disabled={busy || !loaded}
          className="primary-button"
        >
          회사 설정 저장
        </button>
        <p role="status">{notice}</p>
      </form>
    </section>
  );
}
