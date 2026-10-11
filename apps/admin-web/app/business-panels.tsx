"use client";
import { useEffect, useState } from "react";
import { authApi } from "./auth-provider";
import { ReceiptsPanel, SiteFinancePanel } from "./finance-panels";
const monthNow = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .slice(0, 7);
const money = (n: number | null) =>
  n === null ? "미입력" : n.toLocaleString() + "원";
export function CollectionsReport({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState(""),
    [site, setSite] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    authApi<any[]>("/business-reports/collections")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [revision]);
  return (
    <section className="panel">
      <h2>수금·미수</h2>
      {error && <p role="alert">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "현장",
                "상태",
                "계약금액",
                "공급가액",
                "VAT",
                "입금액",
                "미수금",
                "초과입금",
                "최종입금일",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.siteId}>
                <td>
                  <button onClick={() => setSite(r.siteId)}>
                    {r.siteName}
                  </button>
                </td>
                <td>{r.collectionStatus}</td>
                {[
                  r.contractAmount,
                  r.supplyAmount,
                  r.vat,
                  r.collectedAmount,
                  r.outstanding,
                  r.overpayment,
                ].map((n, i) => (
                  <td key={i}>{money(n)}</td>
                ))}
                <td>{r.lastReceivedDate ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {site && (
        <ReceiptsPanel
          key={site}
          siteId={site}
          onChanged={() => {
            setRevision((v) => v + 1);
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
export function MonthlySettlementReport() {
  const [month, setMonth] = useState(monthNow),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [site, setSite] = useState("");
  useEffect(() => {
    setError("");
    authApi(`/business-reports/monthly?month=${month}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [month]);
  return (
    <section className="panel">
      <h2>월간 정산</h2>
      <label>
        정산월
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>{data.criteria}</p>
          <div className="detail-totals">
            {Object.entries({
              contractAmount: "계약금액",
              received: "실제수금",
              outstanding: "현재 미수",
              expenses: "월 현장지출",
              workerPaid: "월 작업진행자 지급액",
              workerUnpaid: "현재 미지급",
              salesInvoices: "월 매출세금계산서",
              purchaseInvoices: "월 매입세금계산서",
              siteProfit: "누적 현장차익",
            }).map(([key, label]) => (
              <div key={key}>
                {label}
                <strong>{money(data[key])}</strong>
              </div>
            ))}
          </div>
          <p>{data.profitCriteria}</p>
          {data.sites.map((s: any) => (
            <button
              key={s.siteId}
              className="mobile-card"
              onClick={() => setSite(s.siteId)}
            >
              {s.siteName} · 현장차익 {money(s.siteProfit)}
            </button>
          ))}
          {site && (
            <>
              <SiteFinancePanel siteId={site} />
              <ReceiptsPanel siteId={site} />
            </>
          )}
        </>
      )}
    </section>
  );
}
export default function PerformancePanel({
  onOpenSite,
}: {
  onOpenSite: (id: string) => void;
}) {
  const [year, setYear] = useState(Number(monthNow().slice(0, 4))),
    [include, setInclude] = useState(true),
    [data, setData] = useState<any>(null),
    [form, setForm] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setError("");
    authApi(
      `/business-reports/performance?year=${year}&includeOutstanding=${include}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  }, [year, include, revision]);
  const download = async (format: string) => {
    try {
      const r = await fetch(
        `/api/business-reports/performance/export?year=${year}&format=${format}&includeOutstanding=${include}`,
      );
      if (!r.ok) throw Error("내보내기 실패");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `${year}_소방공사실적.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="panel performance-panel">
      <h2>실적관리</h2>
      <p>
        완료 현장을 연결한 내부 실적표입니다. 협회 공식 신고양식과 금액 기준은
        제출 전에 검토하세요.
      </p>
      <div className="site-filters">
        <label>
          실적연도
          <input
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={include}
            onChange={(e) => setInclude(e.target.checked)}
          />
          미수 현장 포함
        </label>
        <button onClick={() => download("xlsx")}>Excel 내보내기</button>
        <button onClick={() => download("csv")}>CSV 내보내기</button>
        <button onClick={() => window.print()}>연도별 실적표 출력</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="detail-totals">
            {Object.entries({
              completedSites: "완료 현장",
              targetSites: "신고 대상",
              reviewSites: "검토필요",
              totalContract: "신고 대상 계약금액",
              mechanical: "기계 실적",
              electrical: "전기 실적",
            }).map(([k, v]) => (
              <div key={k}>
                {v}
                <strong>
                  {k.endsWith("Sites")
                    ? data.summary[k] + "건"
                    : money(data.summary[k])}
                </strong>
              </div>
            ))}
          </div>
          {data.summary.missingAmounts > 0 && (
            <p>구분금액 미입력 {data.summary.missingAmounts}건</p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "현장 / 발주처",
                    "공사명 / 주소",
                    "계약·착공·준공일",
                    "계약금액",
                    "기계금액",
                    "전기금액",
                    "계산서 / 수금",
                    "구분 / 신고상태",
                    "관리",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.siteId}>
                    <td>
                      <button onClick={() => onOpenSite(r.siteId)}>
                        {r.siteName}
                      </button>
                      <small>{r.client}</small>
                    </td>
                    <td>
                      {r.workName}
                      <small>{r.address}</small>
                    </td>
                    <td>
                      {r.contractDate || "미입력"}
                      <br />
                      {r.startDate}
                      <br />
                      {r.completedDate || "미입력"}
                    </td>
                    <td>{money(r.contractAmount)}</td>
                    <td>{money(r.mechanical)}</td>
                    <td>{money(r.electrical)}</td>
                    <td>
                      {money(r.invoiceAmount)} / {money(r.received)}
                    </td>
                    <td>
                      {r.workType || "미입력"} · {r.status}
                    </td>
                    <td>
                      <button onClick={() => setForm({ ...r })}>
                        실적 검토
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && <p>이 연도의 완료 현장이 없습니다.</p>}
        </>
      )}
      {form && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await authApi(`/business-reports/performance/${form.siteId}`, {
                method: "PUT",
                body: JSON.stringify(form),
              });
              setForm(null);
              setRevision((v) => v + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{form.siteName} · 실적 검토</h3>
          <p>{form.sourceNotice}</p>
          <div className="form-grid">
            {(
              [
                "contractDate",
                "completedDate",
                "constructionType",
                "workType",
                "notes",
              ] as const
            ).map((k, i) => (
              <label key={k}>
                {
                  ["계약일", "준공일", "공사종류", "신설/증설/개보수", "비고"][
                    i
                  ]
                }
                <input
                  type={k.endsWith("Date") ? "date" : "text"}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            {["mechanical", "electrical"].map((k, i) => (
              <label key={k}>
                {["기계공사금액", "전기공사금액"][i]}
                <input
                  type="number"
                  min="0"
                  placeholder="미입력"
                  value={form[k] ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [k]:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            <label>
              실적신고 상태
              <select
                aria-label="실적신고 상태"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {["검토필요", "실적신고 대상", "제외"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary" disabled={busy}>
            실적 검토 저장
          </button>
          <button type="button" onClick={() => setForm(null)}>
            닫기
          </button>
        </form>
      )}
    </section>
  );
}
