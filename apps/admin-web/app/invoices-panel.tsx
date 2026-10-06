"use client";
import { useEffect, useState } from "react";
import {
  BusinessParty,
  EVIDENCE_TYPES,
  InvoiceList,
  InvoiceMetadata,
  PaymentReceived,
  PURCHASE_INVOICE_STATUSES,
  PurchaseInvoiceView,
  SALES_INVOICE_STATUSES,
  SalesInvoiceView,
  WORKER_INVOICE_STATUSES,
  WorkerInvoiceView,
} from "@jongno/shared";
const money = (n: number) => n.toLocaleString("ko-KR") + "원";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const emptyParty = (): BusinessParty => ({
  registrationNumber: "",
  name: "",
  representative: "",
  address: "",
  businessType: "",
  businessItem: "",
  email: "",
});
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, init);
  const body = await r.json();
  if (!r.ok) throw Error(body.message || "계산서 조회 실패");
  return body;
}
type EditForm = InvoiceMetadata & {
  kind: "sales" | "purchases" | "workers";
  siteId: string;
  expenseId?: string;
  workerId?: string | null;
  status: string;
  receiptIds: string[];
};
export default function InvoicesPanel({
  siteId,
  workerId,
  initialTab,
  onChanged,
}: {
  siteId?: string;
  workerId?: string | null;
  initialTab?: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<InvoiceList | null>(null);
  const [tab, setTab] = useState(
    initialTab ?? (workerId ? "작업진행자 계산서" : "매출 세금계산서"),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [receipts, setReceipts] = useState<PaymentReceived[]>([]);
  const [status, setStatus] = useState("");
  const [evidence, setEvidence] = useState("");
  const [missing, setMissing] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    const q = new URLSearchParams();
    if (siteId) q.set("siteId", siteId);
    if (workerId) q.set("workerId", workerId);
    api<InvoiceList>(`invoices?${q}`, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, workerId, revision]);
  useEffect(() => {
    const c = new AbortController();
    setReceipts([]);
    if (form?.kind === "sales")
      api<PaymentReceived[]>(`payments-received?siteId=${form.siteId}`, {
        signal: c.signal,
      })
        .then(setReceipts)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    return () => c.abort();
  }, [form?.kind, form?.siteId]);
  function edit(
    kind: EditForm["kind"],
    row: SalesInvoiceView | PurchaseInvoiceView | WorkerInvoiceView,
  ) {
    setError("");
    setNotice("");
    if (kind === "workers") {
      const w = row as WorkerInvoiceView;
      setForm({
        kind,
        siteId: w.siteId,
        workerId: w.workerId,
        status: w.status,
        date: w.date,
        approvalNumber: w.approvalNumber,
        notes: w.notes,
        counterparty: w.workerDisplayName,
        supplyAmount: 0,
        vat: 0,
        supplier: emptyParty(),
        recipient: emptyParty(),
        receiptIds: [],
      });
    } else {
      const invoice = row as SalesInvoiceView | PurchaseInvoiceView;
      setForm({
        ...invoice,
        kind,
        receiptIds: "receiptIds" in invoice ? invoice.receiptIds : [],
      });
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError("");
    try {
      const path =
        form.kind === "sales"
          ? `sales/${form.siteId}`
          : form.kind === "purchases"
            ? `purchases/${form.expenseId}`
            : `workers/${form.siteId}/${form.workerId}`;
      await api(`invoices/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm(null);
      setRevision((v) => v + 1);
      setNotice(
        "계산서 관리 정보를 저장했습니다. 실제 발행·수취 API는 호출하지 않았습니다.",
      );
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  const options =
    form?.kind === "sales"
      ? SALES_INVOICE_STATUSES
      : form?.kind === "purchases"
        ? PURCHASE_INVOICE_STATUSES
        : WORKER_INVOICE_STATUSES;
  const complete = form?.status === "발행완료" || form?.status === "수취완료";
  const matches = (text: string) =>
    text.toLowerCase().includes(search.toLowerCase());
  function partyFields(key: "supplier" | "recipient") {
    return (
      <details className="full-width">
        <summary>
          {key === "supplier" ? "공급자" : "공급받는자"} 사업자정보 (선택)
        </summary>
        <div className="form-grid">
          {Object.entries({
            registrationNumber: "사업자등록번호",
            name: "상호",
            representative: "대표자",
            address: "사업장 주소",
            businessType: "업태",
            businessItem: "종목",
            email: "이메일",
          }).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                aria-label={`${key === "supplier" ? "공급자" : "공급받는자"} ${label}`}
                maxLength={300}
                value={form![key][field as keyof BusinessParty]}
                onChange={(e) =>
                  setForm({
                    ...form!,
                    [key]: { ...form![key], [field]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
    );
  }
  return (
    <section className="panel site-list tax-panel">
      <div className="panel-title">
        <div>
          <h2>세금계산서·증빙 관리</h2>
          <p>
            매출 기본 금액은 계약금액에서 계산한 예시값이며 실제 발행 내역에
            맞게 수정하세요. 홈택스·전자세금계산서 서비스와 연동하지 않습니다.
          </p>
        </div>
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
        <div className="detail-totals expense-totals">
          {[
            ["매출 세금계산서 미발행", data.warnings.salesUnissued],
            ["매입 세금계산서 미수취", data.warnings.purchasesUnreceived],
            ["증빙없는 지출", data.warnings.noEvidence],
            ["작업진행자 정산 계산서 미수취", data.warnings.workerUnreceived],
          ].map(([label, value]) => (
            <div key={label}>
              {label}
              <strong>{value}건</strong>
            </div>
          ))}
        </div>
      )}
      {form ? (
        <form onSubmit={save}>
          <fieldset disabled={saving}>
            <h3>
              {form.kind === "sales"
                ? "매출 세금계산서 수정"
                : form.kind === "purchases"
                  ? "매입 세금계산서 수정"
                  : "작업진행자 계산서 상태 수정"}
            </h3>
            <div className="form-grid">
              <label>
                현장
                <input
                  readOnly
                  value={
                    data?.sales.find((s) => s.siteId === form.siteId)
                      ?.siteName ??
                    data?.workers.find((s) => s.siteId === form.siteId)
                      ?.siteName ??
                    form.siteId
                  }
                />
              </label>
              {form.kind === "purchases" && (
                <label>
                  연결 지출
                  <input
                    readOnly
                    value={
                      data?.purchases.find(
                        (p) => p.expenseId === form.expenseId,
                      )?.expenseDescription ?? form.expenseId
                    }
                  />
                </label>
              )}
              <label>
                {form.kind === "purchases"
                  ? "공급업체"
                  : form.kind === "workers"
                    ? "작업진행자"
                    : "거래처"}
                <input
                  aria-label="계산서 거래처"
                  required={form.kind !== "workers"}
                  readOnly={form.kind === "workers"}
                  maxLength={300}
                  value={form.counterparty}
                  onChange={(e) =>
                    setForm({ ...form, counterparty: e.target.value })
                  }
                />
              </label>
              {form.kind !== "workers" && (
                <>
                  {(["supplyAmount", "vat"] as const).map((key) => (
                    <label key={key}>
                      {key === "supplyAmount" ? "공급가액" : "VAT"}
                      <input
                        aria-label={`계산서 ${key === "supplyAmount" ? "공급가액" : "VAT"}`}
                        type="number"
                        required
                        min={0}
                        step={1}
                        max={Number.MAX_SAFE_INTEGER}
                        readOnly={form.kind === "purchases"}
                        value={form[key]}
                        onChange={(e) =>
                          setForm({ ...form, [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                  <div className="expense-total">
                    합계금액
                    <strong>{money(form.supplyAmount + form.vat)}</strong>
                    {form.kind === "purchases" && (
                      <small>연결 지출 금액 · 변경은 지출 화면에서 처리</small>
                    )}
                  </div>
                </>
              )}
              <label>
                {form.kind === "purchases" ? "수취상태" : "발행상태"}
                <select
                  aria-label="계산서 상태"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value,
                      date: ["발행완료", "수취완료"].includes(e.target.value)
                        ? (form.date ?? today())
                        : form.date,
                    })
                  }
                >
                  {options.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                {form.kind === "purchases" ? "수취일" : "발행일"}
                <input
                  aria-label="계산서 날짜"
                  type="date"
                  required={complete}
                  value={form.date ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, date: e.target.value || null })
                  }
                />
              </label>
              <label>
                승인번호
                <input
                  aria-label="계산서 승인번호"
                  required={complete}
                  maxLength={300}
                  value={form.approvalNumber}
                  onChange={(e) =>
                    setForm({ ...form, approvalNumber: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                비고
                <textarea
                  aria-label="계산서 비고"
                  rows={2}
                  maxLength={5000}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              {form.kind === "sales" && (
                <div className="full-width">
                  <h4>연결 수금 (선택)</h4>
                  {receipts.map((r) => (
                    <label className="archive-filter" key={r.id}>
                      <input
                        type="checkbox"
                        checked={form.receiptIds.includes(r.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            receiptIds: e.target.checked
                              ? [...form.receiptIds, r.id]
                              : form.receiptIds.filter((id) => id !== r.id),
                          })
                        }
                      />
                      {r.receivedDate} · {r.payer} · {money(r.amount)}
                    </label>
                  ))}
                  {!receipts.length && <p>연결할 수금내역이 없습니다.</p>}
                </div>
              )}
              {form.kind !== "workers" && (
                <>
                  {partyFields("supplier")}
                  {partyFields("recipient")}
                </>
              )}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setForm(null)}
              >
                계산서 입력 취소
              </button>
              <button className="primary-button">계산서 저장</button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <div className="tab-list" role="tablist" aria-label="계산서 구분">
            {[
              "매출 세금계산서",
              "매입 세금계산서",
              "지출 증빙",
              "작업진행자 계산서",
            ].map((t) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "selected" : ""}
                key={t}
                onClick={() => {
                  setTab(t);
                  setStatus("");
                  setMissing("");
                  setSearch("");
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="site-filters">
            <label>
              계산서 검색
              <input
                aria-label="계산서 검색"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="현장, 거래처, 품목, 작업진행자"
              />
            </label>
            {tab === "지출 증빙" ? (
              <>
                <label>
                  증빙유형 필터
                  <select
                    aria-label="증빙유형 필터"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                  >
                    <option value="">전체 유형</option>
                    {EVIDENCE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  누락 증빙 필터
                  <select
                    aria-label="누락 증빙 필터"
                    value={missing}
                    onChange={(e) => setMissing(e.target.value)}
                  >
                    <option value="">전체 상태</option>
                    <option value="none">증빙없음</option>
                    <option value="unreceived">세금계산서 미수취</option>
                  </select>
                </label>
              </>
            ) : (
              <label>
                계산서 상태 필터
                <select
                  aria-label="계산서 상태 필터"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">전체 상태</option>
                  {(tab === "매출 세금계산서"
                    ? SALES_INVOICE_STATUSES
                    : tab === "매입 세금계산서"
                      ? PURCHASE_INVOICE_STATUSES
                      : WORKER_INVOICE_STATUSES
                  ).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {data ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(tab === "지출 증빙"
                      ? [
                          "현장",
                          "품목/내용",
                          "금액",
                          "증빙유형",
                          "매입 수취상태",
                          "작업진행자",
                          "관리",
                        ]
                      : tab === "작업진행자 계산서"
                        ? [
                            "현장",
                            "작업진행자",
                            "지급예정액",
                            "발행상태",
                            "발행일",
                            "승인번호",
                            "비고",
                            "관리",
                          ]
                        : [
                            "현장",
                            tab === "매출 세금계산서" ? "거래처" : "공급업체",
                            ...(tab === "매입 세금계산서" ? ["연결 지출"] : []),
                            "공급가액",
                            "VAT",
                            "합계금액",
                            tab === "매출 세금계산서" ? "발행상태" : "수취상태",
                            tab === "매출 세금계산서" ? "발행일" : "수취일",
                            "승인번호",
                            "비고",
                            ...(tab === "매출 세금계산서"
                              ? ["입금액 / 연결 수금"]
                              : []),
                            "관리",
                          ]
                    ).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tab === "매출 세금계산서" &&
                    data.sales
                      .filter(
                        (s) =>
                          (!status || s.status === status) &&
                          matches(s.siteName + s.counterparty),
                      )
                      .map((s) => (
                        <tr key={s.siteId}>
                          <td>{s.siteName}</td>
                          <td>{s.counterparty || "거래처 미입력"}</td>
                          <td>{money(s.supplyAmount)}</td>
                          <td>{money(s.vat)}</td>
                          <td>{money(s.totalAmount)}</td>
                          <td>
                            <span
                              className={`badge ${s.status === "미발행" ? "warning" : "success"}`}
                            >
                              {s.status}
                            </span>
                          </td>
                          <td>{s.date ?? "—"}</td>
                          <td>{s.approvalNumber || "—"}</td>
                          <td>{s.notes || "—"}</td>
                          <td>
                            {money(s.collectedAmount)}
                            <small>수금 {s.receiptIds.length}건 연결</small>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => edit("sales", s)}
                            >
                              계산서 수정
                            </button>
                          </td>
                        </tr>
                      ))}
                  {tab === "매입 세금계산서" &&
                    data.purchases
                      .filter(
                        (p) =>
                          (!status || p.status === status) &&
                          matches(
                            p.siteName + p.counterparty + p.expenseDescription,
                          ),
                      )
                      .map((p) => (
                        <tr key={p.expenseId}>
                          <td>{p.siteName}</td>
                          <td>{p.counterparty || "공급업체 미입력"}</td>
                          <td>
                            {p.expenseDescription}
                            <small>{p.expenseId}</small>
                          </td>
                          <td>{money(p.supplyAmount)}</td>
                          <td>{money(p.vat)}</td>
                          <td>{money(p.totalAmount)}</td>
                          <td>
                            <span
                              className={`badge ${p.status === "미수취" ? "warning" : "success"}`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td>{p.date ?? "—"}</td>
                          <td>{p.approvalNumber || "—"}</td>
                          <td>{p.notes || "—"}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => edit("purchases", p)}
                            >
                              계산서 수정
                            </button>
                          </td>
                        </tr>
                      ))}
                  {tab === "지출 증빙" &&
                    data.expenses
                      .filter(
                        (e) =>
                          (!evidence || e.evidenceType === evidence) &&
                          (!missing ||
                            (missing === "none" &&
                              e.evidenceType === "증빙없음") ||
                            (missing === "unreceived" &&
                              e.evidenceType === "세금계산서" &&
                              e.receiptStatus === "미수취")) &&
                          matches(e.siteName + e.description),
                      )
                      .map((e) => (
                        <tr key={e.id}>
                          <td>{e.siteName}</td>
                          <td>{e.description}</td>
                          <td>{money(e.totalAmount)}</td>
                          <td>{e.evidenceType}</td>
                          <td>{e.receiptStatus}</td>
                          <td>{e.workerId ?? "—"}</td>
                          <td>
                            {e.evidenceType === "세금계산서" ? (
                              <button
                                className="text-button"
                                onClick={() =>
                                  edit(
                                    "purchases",
                                    data.purchases.find(
                                      (p) => p.expenseId === e.id,
                                    )!,
                                  )
                                }
                              >
                                계산서 수정
                              </button>
                            ) : (
                              <small>증빙유형은 지출 화면에서 수정</small>
                            )}
                          </td>
                        </tr>
                      ))}
                  {tab === "작업진행자 계산서" &&
                    data.workers
                      .filter(
                        (w) =>
                          (!status || w.status === status) &&
                          matches(w.siteName + w.workerDisplayName),
                      )
                      .map((w) => (
                        <tr key={w.siteId + "|" + w.workerId}>
                          <td>{w.siteName}</td>
                          <td>{w.workerDisplayName}</td>
                          <td>{money(w.totalPayable)}</td>
                          <td>
                            <span
                              className={`badge ${w.status === "미발행" ? "warning" : "success"}`}
                            >
                              {w.status}
                            </span>
                          </td>
                          <td>{w.date ?? "—"}</td>
                          <td>{w.approvalNumber || "—"}</td>
                          <td>{w.notes || "—"}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => edit("workers", w)}
                            >
                              계산서 수정
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
              <p>
                표에 표시된 행이 없으면 조건에 맞는 내역이 없습니다. 위 경고
                건수는 필터 전 조회 범위의 합계입니다.
              </p>
            </div>
          ) : (
            !error && <p role="status">계산서·증빙을 불러오는 중입니다…</p>
          )}
        </>
      )}
    </section>
  );
}
export function SalesInvoiceSummary({
  siteId,
  onChanged,
}: {
  siteId: string;
  onChanged?: () => void;
}) {
  const [sale, setSale] = useState<SalesInvoiceView | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    api<SalesInvoiceView>(`invoices/sales/${siteId}`, { signal: c.signal })
      .then(setSale)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, revision]);
  return (
    <div className="tax-summary">
      {error ? (
        <div className="error" role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>다시 시도</button>
        </div>
      ) : sale ? (
        <>
          <h3>매출 세금계산서</h3>
          <p>
            발행상태: <strong>{sale.status}</strong> · 합계{" "}
            {money(sale.totalAmount)}
            {sale.date ? ` · 발행일 ${sale.date}` : ""}
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "계산서 관리 닫기" : "계산서 관리 열기"}
          </button>
        </>
      ) : (
        <p role="status">매출 계산서 상태를 불러오는 중입니다…</p>
      )}
      {open && (
        <InvoicesPanel
          siteId={siteId}
          initialTab="매출 세금계산서"
          onChanged={() => {
            setRevision((v) => v + 1);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
