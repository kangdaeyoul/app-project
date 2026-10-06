"use client";
import { useEffect, useState } from "react";
import {
  DailyWork,
  EVIDENCE_TYPES,
  EXPENSE_TYPES,
  Expense,
  ExpenseInput,
  ExpenseList,
  PAYMENT_METHODS,
  Site,
  WorkerSummary,
} from "@jongno/shared";
import SiteMaterialsPanel from "./site-materials-panel";
const money = (value: number) => value.toLocaleString("ko-KR") + "원";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const empty = (siteId?: string): ExpenseInput => ({
  expenseDate: today(),
  siteId: siteId ?? "",
  dailyWorkId: null,
  type: "회사 직접 자재구매",
  description: "",
  vendor: "",
  quantity: 1,
  unit: "건",
  supplyAmount: 0,
  vat: 0,
  paymentMethod: "법인카드",
  evidenceType: "증빙없음",
  purchaser: "회사",
  workerId: null,
  isWorkerAdvance: false,
  settled: false,
  settlementDate: null,
  notes: "",
  receiptFileKey: null,
});
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init);
  const body = await response.json();
  if (!response.ok) throw Error(body.message || "지출 요청 실패");
  return body;
}
export default function ExpensesPanel({
  siteId,
  workerId,
  onChanged,
}: {
  siteId?: string;
  workerId?: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<ExpenseList | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [daily, setDaily] = useState<DailyWork[]>([]);
  const [form, setForm] = useState<ExpenseInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filterSite, setFilterSite] = useState(siteId ?? "");
  const [filterType, setFilterType] = useState("");
  const [filterSettled, setFilterSettled] = useState("");
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("구매자재");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setData(null);
    const q = new URLSearchParams();
    if (filterSite) q.set("siteId", filterSite);
    if (workerId) q.set("workerId", workerId);
    Promise.all([
      api<ExpenseList>(`expenses?${q}`, { signal: c.signal }),
      api<Site[]>("sites", { signal: c.signal }),
      api<WorkerSummary[]>("workers?includeDeleted=true", { signal: c.signal }),
      api<DailyWork[]>("daily-work", { signal: c.signal }),
    ])
      .then(([result, s, w, d]) => {
        setData(result);
        setSites(s);
        setWorkers(w);
        setDaily(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [filterSite, workerId, revision]);
  const needsWorker = form && (form.isWorkerAdvance || form.type === "작업비");
  const visible =
    data?.items.filter(
      (e) =>
        (!filterType || e.type === filterType) &&
        (!filterSettled || String(e.settled) === filterSettled) &&
        `${e.description} ${e.vendor} ${e.purchaser}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  function edit(row?: Expense) {
    setEditing(row?.id ?? null);
    setForm(row ? { ...row } : empty(siteId || filterSite));
    setError("");
    setNotice("");
  }
  function setType(type: ExpenseInput["type"]) {
    if (!form) return;
    const advanced = type === "작업진행자 대납 자재구매";
    setForm({
      ...form,
      type,
      isWorkerAdvance: advanced,
      paymentMethod: advanced
        ? "작업진행자 대납"
        : form.paymentMethod === "작업진행자 대납"
          ? "회사계좌이체"
          : form.paymentMethod,
      workerId: advanced || type === "작업비" ? form.workerId : null,
      purchaser: advanced || type === "작업비" ? "" : form.purchaser || "회사",
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError("");
    try {
      await api<Expense>(`expenses${editing ? `/${editing}` : ""}`, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm(null);
      setRevision((v) => v + 1);
      setNotice("지출 기록을 저장했습니다.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  async function remove(row: Expense) {
    if (
      !window.confirm(
        "지출 기록을 삭제하시겠습니까? 연결된 지급예정액도 집계에서 제외됩니다.",
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await api(`expenses/${row.id}`, { method: "DELETE" });
      setRevision((v) => v + 1);
      setNotice("지출 기록을 삭제했습니다.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
  }
  function text(
    key:
      | "expenseDate"
      | "description"
      | "vendor"
      | "unit"
      | "purchaser"
      | "settlementDate",
    label: string,
    type = "text",
    required = false,
  ) {
    return (
      <label key={key}>
        {label}
        {required ? " *" : ""}
        <input
          aria-label={label}
          type={type}
          required={required}
          maxLength={300}
          value={form![key] ?? ""}
          min={key === "settlementDate" ? form!.expenseDate : undefined}
          onChange={(e) =>
            setForm({
              ...form!,
              [key]: e.target.value || (key === "settlementDate" ? null : ""),
            })
          }
        />
      </label>
    );
  }
  function numbers(key: "quantity" | "supplyAmount" | "vat", label: string) {
    return (
      <label>
        {label}
        <input
          aria-label={label}
          type="number"
          required
          min={key === "quantity" ? "0.001" : "0"}
          max={key === "quantity" ? 1000000 : Number.MAX_SAFE_INTEGER}
          step={key === "quantity" ? "0.001" : "1"}
          value={form![key]}
          onChange={(e) => setForm({ ...form!, [key]: Number(e.target.value) })}
        />
      </label>
    );
  }
  function table(rows: Expense[]) {
    return (
      <>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "지출일자",
                  "현장 / 일일작업",
                  "지출유형",
                  "품목/내용",
                  "거래처",
                  "수량 / 단위",
                  "공급가액",
                  "VAT",
                  "합계금액",
                  "결제 / 증빙",
                  "구매자 또는 지출자",
                  "대납",
                  "정산상태 / 정산일",
                  "비고",
                  ...(!workerId ? ["관리"] : []),
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{e.expenseDate}</td>
                  <td>
                    {e.siteName}
                    <small>
                      {e.dailyWorkId
                        ? `${daily.find((d) => d.id === e.dailyWorkId)?.workDate ?? ""} · ${e.dailyWorkId}`
                        : "일일작업 미연결"}
                    </small>
                  </td>
                  <td>{e.type}</td>
                  <td className="description-cell">{e.description}</td>
                  <td>{e.vendor || "—"}</td>
                  <td>
                    {e.quantity} {e.unit}
                  </td>
                  <td>{money(e.supplyAmount)}</td>
                  <td>{money(e.vat)}</td>
                  <td>{money(e.totalAmount)}</td>
                  <td>
                    {e.paymentMethod}
                    <small>{e.evidenceType}</small>
                  </td>
                  <td>
                    {e.workerDisplayName ?? e.purchaser}
                    <small>{e.workerId ?? ""}</small>
                  </td>
                  <td>{e.isWorkerAdvance ? "대납" : "—"}</td>
                  <td>
                    <span
                      className={`badge ${e.settled ? "success" : "warning"}`}
                    >
                      {e.payoutStatus ??
                        (e.settled
                          ? "정산완료"
                          : e.workerId
                            ? "미지급"
                            : "미정산")}
                    </span>
                    <small>{e.settlementDate ?? "—"}</small>
                  </td>
                  <td className="description-cell">{e.notes || "—"}</td>
                  {!workerId && (
                    <td>
                      <div className="worker-actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={saving}
                          onClick={() => edit(e)}
                        >
                          상세·수정
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={saving}
                          onClick={() => remove(e)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">조건에 맞는 지출 기록이 없습니다.</p>
        )}
      </>
    );
  }
  return (
    <div className="expenses-workspace">
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            다시 시도
          </button>
        </div>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      {form ? (
        <section className="panel site-form">
          <div className="panel-title">
            <div>
              <h2>{editing ? "지출 상세·수정" : "새 지출 등록"}</h2>
              <p>
                구매·지출과 실제 사용자재는 별도 기록입니다. 금액은 수량을 곱한
                단가가 아닌 총 공급가액입니다.
              </p>
            </div>
          </div>
          <form onSubmit={save}>
            <fieldset disabled={saving}>
              <div className="form-grid">
                {text("expenseDate", "지출일자", "date", true)}
                <label>
                  현장 *
                  <select
                    aria-label="현장"
                    required
                    disabled={!!siteId}
                    value={form.siteId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        siteId: e.target.value,
                        dailyWorkId: null,
                      })
                    }
                  >
                    <option value="">현장 선택</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  연결 일일작업 (선택)
                  <select
                    aria-label="연결 일일작업"
                    value={form.dailyWorkId ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, dailyWorkId: e.target.value || null })
                    }
                  >
                    <option value="">미연결</option>
                    {daily
                      .filter((d) => d.siteId === form.siteId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.workDate} · {d.content || d.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  지출유형
                  <select
                    aria-label="지출유형"
                    value={form.type}
                    onChange={(e) =>
                      setType(e.target.value as ExpenseInput["type"])
                    }
                  >
                    {EXPENSE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                {text("description", "품목/내용", "text", true)}
                {text("vendor", "거래처")}
                {numbers("quantity", "수량")}
                {text("unit", "단위", "text", true)}
                {numbers("supplyAmount", "공급가액")}
                {numbers("vat", "VAT")}
                <div className="expense-total">
                  합계금액<strong>{money(form.supplyAmount + form.vat)}</strong>
                  <small>공급가액 + VAT · 자동 계산</small>
                </div>
                <label>
                  결제방법
                  <select
                    aria-label="결제방법"
                    value={form.paymentMethod}
                    onChange={(e) => {
                      const paymentMethod = e.target
                        .value as ExpenseInput["paymentMethod"];
                      setForm({
                        ...form,
                        paymentMethod,
                        isWorkerAdvance: paymentMethod === "작업진행자 대납",
                        workerId:
                          paymentMethod === "작업진행자 대납" ||
                          form.type === "작업비"
                            ? form.workerId
                            : null,
                      });
                    }}
                  >
                    {PAYMENT_METHODS.filter((m) =>
                      form.type === "작업진행자 대납 자재구매"
                        ? m === "작업진행자 대납"
                        : form.type === "회사 직접 자재구매" ||
                            form.type === "작업비"
                          ? m !== "작업진행자 대납"
                          : true,
                    ).map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  증빙유형
                  <select
                    aria-label="증빙유형"
                    value={form.evidenceType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        evidenceType: e.target
                          .value as ExpenseInput["evidenceType"],
                      })
                    }
                  >
                    {EVIDENCE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                {needsWorker ? (
                  <label>
                    구매자 또는 지출자 · 작업진행자 *
                    <select
                      aria-label="구매자 또는 지출자 작업진행자"
                      required
                      value={form.workerId ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          workerId: e.target.value || null,
                          purchaser:
                            workers.find((w) => w.id === e.target.value)
                              ?.displayName ?? "",
                        })
                      }
                    >
                      <option value="">작업진행자 선택</option>
                      {workers
                        .filter(
                          (w) =>
                            !w.deletedAt || (w.id === form.workerId && editing),
                        )
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.displayName}
                            {w.deletedAt ? " (삭제됨 · 기존 연결 유지)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  text("purchaser", "구매자 또는 지출자", "text", true)
                )}
                <div className="expense-total">
                  작업진행자 대납 여부
                  <strong>{form.isWorkerAdvance ? "대납" : "아니오"}</strong>
                  <small>지출유형·결제방법에서 자동 결정</small>
                </div>
                <label>
                  정산완료 여부
                  <select
                    aria-label="정산완료 여부"
                    value={String(form.settled)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        settled: e.target.value === "true",
                        settlementDate:
                          e.target.value === "true"
                            ? (form.settlementDate ??
                              (today() < form.expenseDate
                                ? form.expenseDate
                                : today()))
                            : null,
                      })
                    }
                  >
                    <option value="false">
                      {needsWorker ? "미지급" : "미정산"}
                    </option>
                    <option value="true">정산완료</option>
                  </select>
                </label>
                {form.settled && text("settlementDate", "정산일", "date", true)}
                <label className="full-width">
                  비고
                  <textarea
                    aria-label="비고"
                    rows={3}
                    maxLength={5000}
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                  />
                </label>
                <p className="full-width">
                  증빙 파일 참조: {form.receiptFileKey ?? "없음"} · 영수증
                  업로드는 다음 단계입니다. 정산완료는 기록 상태이며 실제 결제는
                  실행하지 않습니다.
                </p>
              </div>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setForm(null)}
                >
                  취소
                </button>
                <button className="primary-button" type="submit">
                  {saving ? "저장 중…" : "지출 저장"}
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      ) : data ? (
        <section className="panel site-list">
          <div className="panel-title">
            <div>
              <h2>
                {workerId
                  ? "작업비·대납 정산"
                  : siteId
                    ? "현장 자재·경비"
                    : "자재·경비 목록"}
              </h2>
              <p>구매/지출 원장 · 실제 결제 없이 정산 상태만 기록합니다.</p>
            </div>
            {!workerId && (
              <button
                className="primary-button"
                disabled={saving}
                onClick={() => edit()}
              >
                ＋ 새 지출 등록
              </button>
            )}
          </div>
          {workerId ? (
            <div className="detail-totals expense-totals">
              {[
                ["작업비", data.workerTotals.labor],
                ["대납금액", data.workerTotals.advances],
                ["총 지급예정", data.workerTotals.totalPayable],
                ["정산완료액", data.workerTotals.settledAmount],
                ["미지급액", data.workerTotals.unpaidAmount],
              ].map(([label, value]) => (
                <div key={label}>
                  {label}
                  <strong>{money(Number(value))}</strong>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="detail-totals expense-totals">
                {[
                  ["직접 자재구매 합계", data.totals.directMaterials],
                  ["작업진행자 대납 합계", data.totals.workerAdvances],
                  ["작업비 합계", data.totals.labor],
                  ["기타경비 합계", data.totals.other],
                  ["총 현장지출", data.totals.total],
                ].map(([label, value]) => (
                  <div key={label}>
                    {label}
                    <strong>{money(Number(value))}</strong>
                  </div>
                ))}
              </div>
              <p>
                합계는 선택 현장의 전체 기록 기준입니다. 기타경비 대납은
                대납·기타경비에 각각 표시되며 총 현장지출에는 한 번만
                포함됩니다.
              </p>
            </>
          )}
          {siteId && (
            <div
              className="tab-list"
              role="tablist"
              aria-label="자재·경비 구분"
            >
              {["사용자재", "구매자재", "작업비", "기타경비"].map((t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === t}
                  className={section === t ? "selected" : ""}
                  key={t}
                  onClick={() => {
                    setSection(t);
                    setFilterType("");
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {siteId && section === "사용자재" ? (
            <SiteMaterialsPanel siteId={siteId} />
          ) : (
            <>
              <div className="site-filters">
                {!siteId && !workerId && (
                  <label>
                    현장 필터
                    <select
                      aria-label="현장 필터"
                      value={filterSite}
                      onChange={(e) => setFilterSite(e.target.value)}
                    >
                      <option value="">전체 현장</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  지출 검색
                  <input
                    aria-label="지출 검색"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="품목, 거래처, 지출자"
                  />
                </label>
                {!siteId && (
                  <label>
                    지출유형 필터
                    <select
                      aria-label="지출유형 필터"
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                    >
                      <option value="">전체 유형</option>
                      {EXPENSE_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  정산상태 필터
                  <select
                    aria-label="정산상태 필터"
                    value={filterSettled}
                    onChange={(e) => setFilterSettled(e.target.value)}
                  >
                    <option value="">전체 상태</option>
                    <option value="false">미정산·미지급</option>
                    <option value="true">정산완료</option>
                  </select>
                </label>
              </div>
              {table(
                siteId
                  ? visible.filter((e) =>
                      section === "구매자재"
                        ? e.type.includes("자재구매")
                        : e.type === section,
                    )
                  : visible,
              )}
            </>
          )}
        </section>
      ) : !error ? (
        <p role="status">지출 기록을 불러오는 중입니다…</p>
      ) : null}
    </div>
  );
}
