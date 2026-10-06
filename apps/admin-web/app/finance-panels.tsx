"use client";
import InvoicesPanel, { SalesInvoiceSummary } from "./invoices-panel";
import { useEffect, useState } from "react";
import {
  PaymentReceived,
  PaymentReceivedInput,
  RECEIPT_METHODS,
  SettlementList,
  SettlementSummary,
  Site,
  SiteFinance,
} from "@jongno/shared";
const money = (n: number) => n.toLocaleString("ko-KR") + "원";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, init);
  const body = await r.json();
  if (!r.ok) throw Error(body.message || "금액 조회 실패");
  return body;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function Cards({ entries }: { entries: [string, number][] }) {
  return (
    <div className="detail-totals expense-totals">
      {entries.map(([label, value]) => (
        <div key={label}>
          {label}
          <strong className={value < 0 ? "orange" : ""}>{money(value)}</strong>
        </div>
      ))}
    </div>
  );
}
export function SiteFinancePanel({ siteId }: { siteId: string }) {
  const [data, setData] = useState<SiteFinance | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    api<SiteFinance>(`sites/${siteId}/finance`, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, revision]);
  return error ? (
    <div className="error" role="alert">
      {error}{" "}
      <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
    </div>
  ) : data ? (
    <>
      <Cards
        entries={[
          ["계약금액", data.contractAmount],
          ["입금액", data.collectedAmount],
          ["미수금", data.receivables],
          ["총 현장지출", data.totalExpenses],
          ["현장차익", data.siteProfit],
          ["작업진행자 미지급액", data.unpaidWorkerAmount],
        ]}
      />
      <p>
        현장차익은 계약금액에서 등록된 현장지출을 뺀 금액입니다. 회사 전체
        세금·보험·고정비가 반영되지 않았습니다.
      </p>
      <dl className="info-grid">
        {[
          ["회사 직접 자재비", data.directMaterials],
          ["작업진행자 자재대납", data.materialAdvances],
          ["작업비", data.labor],
          ["기타경비", data.other],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{money(Number(value))}</dd>
          </div>
        ))}
      </dl>
    </>
  ) : (
    <p role="status">현장손익을 불러오는 중입니다…</p>
  );
}
export function ReceiptsPanel({
  siteId,
  onChanged,
}: {
  siteId: string;
  onChanged?: () => void;
}) {
  const [siteName, setSiteName] = useState(siteId);
  const [rows, setRows] = useState<PaymentReceived[]>([]);
  const [summary, setSummary] = useState<SiteFinance | null>(null);
  const [form, setForm] = useState<PaymentReceivedInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setSummary(null);
    Promise.all([
      api<Site>(`sites/${siteId}`, { signal: c.signal }),
      api<PaymentReceived[]>(`payments-received?siteId=${siteId}`, {
        signal: c.signal,
      }),
      api<SiteFinance>(`sites/${siteId}/finance`, { signal: c.signal }),
    ])
      .then(([site, r, s]) => {
        setSiteName(site.name);
        setRows(r);
        setSummary(s);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, revision]);
  function edit(row?: PaymentReceived) {
    setEditing(row?.id ?? null);
    setForm(
      row
        ? { ...row }
        : {
            siteId,
            receivedDate: today(),
            amount: 0,
            method: "계좌이체",
            payer: "",
            notes: "",
          },
    );
    setError("");
    setNotice("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(
        `payments-received${editing ? `/${editing}` : ""}`,
        json(editing ? "PUT" : "POST", form),
      );
      setForm(null);
      setRevision((v) => v + 1);
      setNotice("수금내역을 저장했습니다.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (
      !window.confirm(
        "이 수금내역을 삭제하시겠습니까? 입금 합계와 미수금이 다시 계산됩니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await api(`payments-received/${id}`, { method: "DELETE" });
      setRevision((v) => v + 1);
      setNotice("수금내역을 삭제했습니다.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel site-list">
      <div className="panel-title">
        <div>
          <h2>수금·미수 관리</h2>
          <p>현장별 실제 등록 원장 · 은행·카드사와 연결하지 않습니다.</p>
        </div>
        <button
          className="primary-button"
          disabled={saving}
          onClick={() => edit()}
        >
          ＋ 수금 등록
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
        </div>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      {summary && (
        <Cards
          entries={[
            ["총 계약금액", summary.contractAmount],
            ["총 입금액", summary.collectedAmount],
            ["미수금", summary.receivables],
          ]}
        />
      )}
      <SalesInvoiceSummary siteId={siteId} onChanged={onChanged} />
      {summary && summary.receivables < 0 && (
        <p>
          계약금액을 초과한 입금액입니다. 미수금은 계산 결과를 음수로
          표시합니다.
        </p>
      )}
      {form && (
        <form className="receipt-form" onSubmit={save}>
          <fieldset disabled={saving}>
            <h3>{editing ? "수금내역 수정" : "수금 등록"}</h3>
            <div className="form-grid">
              <label>
                입금일자 *
                <input
                  aria-label="입금일자"
                  type="date"
                  required
                  value={form.receivedDate}
                  onChange={(e) =>
                    setForm({ ...form, receivedDate: e.target.value })
                  }
                />
              </label>
              <label>
                현장
                <input aria-label="수금 현장" readOnly value={siteName} />
              </label>
              <label>
                금액 *
                <input
                  aria-label="수금 금액"
                  type="number"
                  required
                  min={1}
                  step={1}
                  max={Number.MAX_SAFE_INTEGER}
                  value={form.amount}
                  onChange={(e) =>
                    setForm({ ...form, amount: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                결제방법
                <select
                  aria-label="수금 결제방법"
                  value={form.method}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      method: e.target.value as PaymentReceivedInput["method"],
                    })
                  }
                >
                  {RECEIPT_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                입금자명 또는 거래처 *
                <input
                  aria-label="입금자명 또는 거래처"
                  required
                  maxLength={300}
                  value={form.payer}
                  onChange={(e) => setForm({ ...form, payer: e.target.value })}
                />
              </label>
              <label className="full-width">
                비고
                <textarea
                  aria-label="수금 비고"
                  rows={2}
                  maxLength={5000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setForm(null)}
              >
                수금 입력 취소
              </button>
              <button className="primary-button">수금 저장</button>
            </div>
          </fieldset>
        </form>
      )}
      {summary ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "입금일자",
                    "현장",
                    "금액",
                    "결제방법",
                    "입금자명 또는 거래처",
                    "비고",
                    "관리",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.receivedDate}</td>
                    <td>{siteName}</td>
                    <td>{money(r.amount)}</td>
                    <td>{r.method}</td>
                    <td>{r.payer}</td>
                    <td>{r.notes || "—"}</td>
                    <td>
                      <div className="worker-actions">
                        <button
                          className="text-button"
                          disabled={saving}
                          onClick={() => edit(r)}
                        >
                          수정
                        </button>
                        <button
                          className="text-button"
                          disabled={saving}
                          onClick={() => remove(r.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p className="empty">등록된 수금내역이 없습니다.</p>}
        </>
      ) : (
        !error && <p role="status">수금내역을 불러오는 중입니다…</p>
      )}
    </section>
  );
}
export function SettlementsPanel({
  siteId,
  workerId,
  onChanged,
}: {
  siteId?: string;
  workerId?: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<SettlementList | null>(null);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<SettlementSummary | null>(null);
  const [full, setFull] = useState(false);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    const q = new URLSearchParams({ month });
    if (siteId) q.set("siteId", siteId);
    if (workerId) q.set("workerId", workerId);
    api<SettlementList>(`settlements?${q}`, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, workerId, month, revision]);
  function pay(row: SettlementSummary, all: boolean) {
    setSelected(row);
    setFull(all);
    setAmount(row.unpaidAmount);
    setDate(today());
    setNotes("");
    setError("");
    setNotice("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      await api(
        "worker-payments",
        json("POST", {
          siteId: selected.siteId,
          workerId: selected.workerId,
          paymentDate: date,
          amount,
          fullPayment: full,
          notes,
        }),
      );
      setSelected(null);
      setRevision((v) => v + 1);
      setNotice("지급내역을 기록했습니다. 실제 송금은 실행하지 않았습니다.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지급 기록 실패");
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (
      !window.confirm(
        "지급 기록을 취소하시겠습니까? 실제 송금 취소가 아니며 미지급액이 복원됩니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await api(`worker-payments/${id}`, { method: "DELETE" });
      setRevision((v) => v + 1);
      setNotice("지급 기록을 취소했습니다.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "취소 실패");
    } finally {
      setSaving(false);
    }
  }
  const workerRows = new Map<
    string,
    { name: string; total: number; paid: number; unpaid: number }
  >();
  data?.workers.forEach((w) =>
    workerRows.set(w.workerId, {
      name: w.workerDisplayName + (w.deletedAt ? " (삭제됨)" : ""),
      total: w.totalPayable,
      paid: w.paidAmount,
      unpaid: w.unpaidAmount,
    }),
  );
  return (
    <section className="panel site-list">
      <div className="panel-title">
        <div>
          <h2>작업진행자 지급관리</h2>
          <p>현장별 지급의무와 지급 원장 · 일부 지급 지원</p>
        </div>
        <label>
          조회 월
          <input
            aria-label="정산 조회 월"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
        </div>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      {data && (
        <>
          <h3>전체 기간 합계</h3>
          <Cards
            entries={[
              ["지급예정액", data.totals.totalPayable],
              ["지급완료액", data.totals.paidAmount],
              ["미지급액", data.totals.unpaidAmount],
            ]}
          />
          <h3>{month} 월 합계</h3>
          <Cards
            entries={[
              ["월 발생 지급예정액", data.monthly.totalPayable],
              ["월 지급액", data.monthly.paidAmount],
              ["해당 월 발생분 잔액", data.monthly.unpaidAmount],
            ]}
          />
          <p>
            월 지급액은 지급일 기준, 월 지급예정액과 잔액은 지출일 기준입니다.
            아래 현장별 원장은 전체 기간입니다.
          </p>
        </>
      )}
      {selected && (
        <form className="receipt-form" onSubmit={save}>
          <fieldset disabled={saving}>
            <h3>
              {full ? "지급완료 처리" : "일부 지급 기록"} ·{" "}
              {selected.workerDisplayName}
            </h3>
            <p>
              {selected.siteName} · 미지급 {money(selected.unpaidAmount)}
            </p>
            <div className="form-grid">
              <label>
                지급일 *
                <input
                  aria-label="지급일"
                  required
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                지급금액 *
                <input
                  aria-label="지급금액"
                  required
                  type="number"
                  min={1}
                  max={selected.unpaidAmount}
                  step={1}
                  readOnly={full}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
                <small>
                  {full
                    ? "저장 시 서버의 최신 미지급 잔액 전액을 기록합니다."
                    : "미지급 잔액 이내에서 입력하세요."}
                </small>
              </label>
              <label className="full-width">
                지급 비고
                <textarea
                  aria-label="지급 비고"
                  rows={2}
                  maxLength={5000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelected(null)}
              >
                지급 입력 취소
              </button>
              <button className="primary-button">지급 기록 저장</button>
            </div>
          </fieldset>
        </form>
      )}
      {data ? (
        <>
          {!workerId && (
            <>
              <h3>작업진행자별 지급 요약</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>작업진행자</th>
                      <th>지급예정액</th>
                      <th>지급완료액</th>
                      <th>미지급액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...workerRows].map(([id, w]) => (
                      <tr key={id}>
                        <td>
                          {w.name}
                          <small>{id}</small>
                        </td>
                        <td>{money(w.total)}</td>
                        <td>{money(w.paid)}</td>
                        <td>{money(w.unpaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <h3>현장별 정산내역</h3>
          <div className="site-filters">
            <label>
              지급상태 필터
              <select
                aria-label="지급상태 필터"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">전체 상태</option>
                {["미지급", "일부지급", "지급완료"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "작업진행자",
                    "관련 현장",
                    "작업비",
                    "자재대납",
                    "기타정산",
                    "총 지급예정액",
                    "지급완료액",
                    "미지급액",
                    "지급상태",
                    "계산서 상태",
                    "지급일",
                    "관리",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows
                  .filter((r) => !status || r.status === status)
                  .map((r) => (
                    <tr key={r.siteId + "|" + r.workerId}>
                      <td>
                        {r.workerDisplayName}
                        <small>{r.workerId}</small>
                      </td>
                      <td>{r.siteName}</td>
                      <td>{money(r.labor)}</td>
                      <td>{money(r.materialAdvances)}</td>
                      <td>{money(r.other)}</td>
                      <td>{money(r.totalPayable)}</td>
                      <td>{money(r.paidAmount)}</td>
                      <td>{money(r.unpaidAmount)}</td>
                      <td>
                        <span
                          className={`badge ${r.status === "지급완료" ? "success" : "warning"}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td>{r.invoiceStatus}</td>
                      <td>{r.lastPaymentDate ?? "—"}</td>
                      <td>
                        <div className="worker-actions">
                          <button
                            className="text-button"
                            disabled={saving || r.unpaidAmount <= 0}
                            onClick={() => pay(r, true)}
                          >
                            지급완료 처리
                          </button>
                          <button
                            className="text-button"
                            disabled={saving || r.unpaidAmount <= 0}
                            onClick={() => pay(r, false)}
                          >
                            일부 지급
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && (
            <p className="empty">지급대상 정산내역이 없습니다.</p>
          )}
          <h3>지급 기록 (전체 기간)</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "지급일",
                    "작업진행자",
                    "현장",
                    "지급액",
                    "비고",
                    "관리",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paymentDate}</td>
                    <td>
                      {data.rows.find((r) => r.workerId === p.workerId)
                        ?.workerDisplayName ?? p.workerId}
                    </td>
                    <td>
                      {data.rows.find((r) => r.siteId === p.siteId)?.siteName ??
                        p.siteId}
                    </td>
                    <td>{money(p.amount)}</td>
                    <td>{p.notes || "—"}</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={saving}
                        onClick={() => remove(p.id)}
                      >
                        지급 기록 취소
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        !error && <p role="status">지급내역을 불러오는 중입니다…</p>
      )}
      <InvoicesPanel
        siteId={siteId}
        workerId={workerId}
        initialTab="작업진행자 계산서"
        onChanged={() => {
          setRevision((v) => v + 1);
          onChanged?.();
        }}
      />
    </section>
  );
}
export default function FinancePanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState("작업진행자 지급");
  const [sites, setSites] = useState<Site[]>([]);
  const [site, setSite] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    api<Site[]>("sites", { signal: c.signal })
      .then((rows) => {
        setSites(rows);
        setSite((old) => old || rows[0]?.id || "");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [revision]);
  return (
    <div>
      <div
        className="tab-list finance-nav"
        role="tablist"
        aria-label="정산 업무"
      >
        {["작업진행자 지급", "수금·미수", "현장손익", "세금계산서·증빙"].map(
          (t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ),
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
        </div>
      )}
      {tab === "세금계산서·증빙" ? (
        <InvoicesPanel onChanged={onChanged} />
      ) : tab === "작업진행자 지급" ? (
        <SettlementsPanel onChanged={onChanged} />
      ) : (
        <>
          <div className="site-filters">
            <label>
              조회 현장
              <select
                aria-label="조회 현장"
                value={site}
                onChange={(e) => setSite(e.target.value)}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {site &&
            (tab === "수금·미수" ? (
              <ReceiptsPanel key={site} siteId={site} onChanged={onChanged} />
            ) : (
              <section className="panel site-list">
                <h2>현장손익 · {sites.find((s) => s.id === site)?.name}</h2>
                <SiteFinancePanel siteId={site} />
              </section>
            ))}
        </>
      )}
    </div>
  );
}
