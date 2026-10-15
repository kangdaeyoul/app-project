"use client";
import { useEffect, useState, useRef } from "react";
import {
  Company,
  quoteCompanyDefaults,
  QuoteCompanySnapshot,
} from "@jongro/shared";
import { authApi, useAuth } from "./auth-provider";
import QuoteCompanyEditor from "./quote-company-editor";
export default function QuoteCompanySettings() {
  const [editing, setEditing] = useState(false);
  const original = useRef({
    base: undefined as Company | undefined,
    profile: undefined as QuoteCompanySnapshot | undefined,
  });
  const { company, refresh, user } = useAuth();
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
        original.current = {
          base: structuredClone(v.company),
          profile: quoteCompanyDefaults(v.company),
        };
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
        이 정보는 견적서, 완료보고서 등 회사 출력물에 사용됩니다. 설정 →
        회사정보 → 수정에서 언제든 변경할 수 있습니다. 새 견적에 적용됩니다.
        이미 저장한 견적의 회사정보·로고·직인은 변경하지 않습니다.
      </p>
      {user?.isDemo && (
        <p className="tutorial-examples">
          체험판입니다. 별도 예시에서 회사정보를 수정하거나 초기 상태로 되돌릴
          수 있습니다. 실제 회사 설정은 아래 수정 버튼으로 변경합니다.{" "}
          <button
            onClick={() =>
              window.dispatchEvent(new Event("open-tutorial-help"))
            }
          >
            예시 데이터 보기 · 직접 수정해보기
          </button>
        </p>
      )}
      {!loaded && (
        <p role="status">
          회사정보를 불러오는 중입니다.{" "}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            다시 불러오기
          </button>
        </p>
      )}
      {!editing && (
        <button className="primary-button" onClick={() => setEditing(true)}>
          회사정보 수정
        </button>
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
            original.current = {
              base: structuredClone(base),
              profile: structuredClone(profile),
            };
            setEditing(false);
            window.dispatchEvent(new Event("app-saved"));
            await refresh();
            setNotice(
              "회사정보가 저장되었습니다. 새로 작성하는 문서부터 변경된 정보가 적용됩니다. 과거 견적의 회사정보 스냅샷은 유지됩니다.",
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
            disabled={busy || !loaded || !editing}
            value={base.displayName}
            onChange={(e) => setBase({ ...base, displayName: e.target.value })}
          />
        </label>
        <QuoteCompanyEditor
          value={profile}
          onChange={setProfile}
          disabled={busy || !loaded || !editing}
        />
        {editing && (
          <button
            type="button"
            onClick={() => {
              if (original.current.base && original.current.profile) {
                setBase(structuredClone(original.current.base));
                setProfile(structuredClone(original.current.profile));
              }
              setEditing(false);
              setNotice("");
              window.dispatchEvent(new Event("app-saved"));
            }}
          >
            취소
          </button>
        )}
        {editing && (
          <button
            type="submit"
            disabled={busy || !loaded || !editing}
            className="primary-button"
          >
            회사 설정 저장
          </button>
        )}
        <p role="status">{notice}</p>
      </form>
    </section>
  );
}
