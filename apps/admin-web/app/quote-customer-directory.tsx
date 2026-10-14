"use client";
import { useEffect, useState } from "react";
import { Customer, QuoteView, Site } from "@jongro/shared";
import { authApi, useAuth } from "./auth-provider";
type CustomerRow = Customer & { recentQuoteDate: string; quoteCount: number };
export default function QuoteCustomerDirectory({
  onQuote,
  onSite,
}: {
  onQuote: (q: QuoteView) => void;
  onSite: (id: string) => void;
}) {
  const { user } = useAuth(),
    admin = user?.role === "admin";
  const [rows, setRows] = useState<CustomerRow[]>([]),
    [search, setSearch] = useState(""),
    [detail, setDetail] = useState<
      (Customer & { quotes: QuoteView[]; sites: Site[] }) | null
    >(null),
    [edit, setEdit] = useState(false),
    [draft, setDraft] = useState<Customer | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    authApi<CustomerRow[]>("/customers")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [revision]);
  const needle = search.replace(/[\s-]/g, "").toLowerCase();
  return (
    <section className="panel">
      <h2>거래처 관리</h2>
      {error && <p role="alert">{error}</p>}
      {!detail ? (
        <>
          <label>
            거래처 검색
            <input
              aria-label="거래처 관리 검색"
              value={search}
              placeholder="거래처명 · 사업자번호 · 담당자 · 전화번호"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "거래처명",
                    "사업자등록번호",
                    "담당자",
                    "연락처",
                    "주소",
                    "최근 견적일",
                    "견적 건수",
                  ].map((l) => (
                    <th key={l}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((c) =>
                    [c.name, c.registrationNumber, c.contactName, c.phone]
                      .filter(Boolean)
                      .join(" ")
                      .replace(/[\s-]/g, "")
                      .toLowerCase()
                      .includes(needle),
                  )
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          onClick={() => {
                            authApi<
                              Customer & { quotes: QuoteView[]; sites: Site[] }
                            >(`/customers/${c.id}`)
                              .then((d) => {
                                setDetail(d);
                                setDraft(d);
                                setEdit(false);
                              })
                              .catch((e) => setError(e.message));
                          }}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td data-label="사업자등록번호">
                        {c.registrationNumber}
                      </td>
                      <td data-label="담당자">{c.contactName}</td>
                      <td data-label="연락처">{c.phone}</td>
                      <td data-label="주소">{c.address}</td>
                      <td data-label="최근 견적일">
                        {c.recentQuoteDate || "—"}
                      </td>
                      <td data-label="견적 건수">{c.quoteCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="panel-title">
            <h3>{detail.name}</h3>
            <button onClick={() => setDetail(null)}>거래처 목록</button>
          </div>
          <h4>기본정보</h4>
          {edit && draft ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const value = await authApi<Customer>(
                    `/customers/${detail.id}`,
                    { method: "PUT", body: JSON.stringify(draft) },
                  );
                  setDetail({ ...detail, ...value });
                  setEdit(false);
                  setRevision((v) => v + 1);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <div className="form-grid">
                {(
                  [
                    "name",
                    "registrationNumber",
                    "contactName",
                    "phone",
                    "address",
                  ] as const
                ).map((k, i) => (
                  <label key={k}>
                    {
                      [
                        "거래처명",
                        "사업자등록번호",
                        "담당자",
                        "연락처",
                        "주소",
                      ][i]
                    }
                    <input
                      aria-label={`관리 ${["거래처명", "사업자등록번호", "담당자", "연락처", "주소"][i]}`}
                      value={draft[k] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <button type="submit">거래처 정보 저장</button>
              <button type="button" onClick={() => setEdit(false)}>
                취소
              </button>
            </form>
          ) : (
            <>
              <dl className="info-grid">
                {[
                  ["사업자등록번호", detail.registrationNumber],
                  ["담당자", detail.contactName],
                  ["연락처", detail.phone],
                  ["주소", detail.address],
                ]
                  .filter(([, v]) => v)
                  .map(([l, v]) => (
                    <div key={l}>
                      <dt>{l}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
              {admin && (
                <>
                  <button
                    onClick={() => {
                      setDraft(detail);
                      setEdit(true);
                    }}
                  >
                    거래처 수정
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        !confirm(
                          "거래처를 삭제하시겠습니까? 기존 견적·현장 기록과 스냅샷은 유지됩니다.",
                        )
                      )
                        return;
                      try {
                        await authApi(`/customers/${detail.id}`, {
                          method: "DELETE",
                        });
                        setDetail(null);
                        setRevision((v) => v + 1);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    거래처 삭제
                  </button>
                </>
              )}
            </>
          )}
          <h4>과거 견적</h4>
          {detail.quotes.map((q) => (
            <button
              className="quote-customer-history"
              key={q.id}
              onClick={() => onQuote(q)}
            >
              {q.quoteDate} · {q.siteName} ·{" "}
              {q.totals.totalAmount.toLocaleString("ko-KR")}원
            </button>
          ))}
          {!detail.quotes.length && <p>연결된 견적이 없습니다.</p>}
          <h4>연결 현장</h4>
          {detail.sites.map((s) => (
            <button
              className="quote-customer-history"
              key={s.id}
              onClick={() => onSite(s.id)}
            >
              {s.name}
            </button>
          ))}
          {!detail.sites.length && <p>연결된 현장이 없습니다.</p>}
        </>
      )}
    </section>
  );
}
