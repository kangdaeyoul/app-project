"use client";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_COMPANY,
  Customer,
  QuoteInput,
  QuoteItemInput,
  QuoteView,
  QuoteListRow,
  Site,
  QUOTE_STATUSES,
  QUOTE_PRINT_MODES,
  calculateQuote,
} from "@jongro/shared";
import QuoteCustomerPicker from "./quote-customer-picker";
import QuoteCustomerDirectory from "./quote-customer-directory";
import QuoteDetailView from "./quote-detail-view";
import { fetchQuoteDocument } from "./quote-document-client";
import { quoteDocumentFilename } from "@jongro/shared";
import QuoteSummaryEditor from "./quote-summary-editor";
import { QuoteCompanySnapshot, quoteCompanyDefaults } from "@jongro/shared";
import QuoteQuickInput from "./quote-quick-input";
import QuoteLineEditor from "./quote-line-editor";
import QuoteNumberInput from "./quote-number-input";
import { accumulateQuoteItems } from "@jongro/shared";
import StandardWorkPanel from "./standard-work-panel";
import PdfPreview from "./pdf-preview";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
const money = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const sale = (n: number, unit: QuoteInput["displayUnit"]) =>
  unit === "만원"
    ? `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(n / 10000)}만원 (${money(n)})`
    : money(n);
const newQuote = (customerId: string): QuoteInput => ({
  customerId,
  siteId: null,
  siteName: "",
  address: "",
  workContent: "",
  quoteDate: today(),
  validUntil: new Date(Date.parse(today()) + 30 * 86400000)
    .toISOString()
    .slice(0, 10),
  status: "작성중",
  notes: "",
  generalFee: 0,
  supportFee: 0,
  internalGeneralCost: 0,
  internalSupportCost: 0,
  rounding: "천원 반올림",
  displayUnit: "만원",
  sections: [],
});
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const readOnly = !init?.method || init.method.toUpperCase() === "GET";
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, { cache: "no-store", ...init });
    } catch (e) {
      if (
        readOnly &&
        attempt === 0 &&
        !init?.signal?.aborted &&
        e instanceof TypeError
      )
        continue;
      throw e;
    }
    // The web proxy can lose an idle API connection. Never retry writes.
    const isJson = response.headers
      .get("content-type")
      ?.includes("application/json");
    if (
      readOnly &&
      attempt === 0 &&
      !isJson &&
      [500, 502, 503, 504].includes(response.status)
    ) {
      await response.text();
      continue;
    }
    if (!isJson)
      throw Error(
        `API 연결에 실패했습니다 (${response.status}). 다시 시도하세요.`,
      );
    const body = await response.json();
    if (!response.ok) throw Error(body.message || "견적 요청 실패");
    return body;
  }
}

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export default function QuotesPanel({
  onChanged,
  onOpenSite,
  initialQuoteId,
}: {
  initialQuoteId?: string;
  onChanged: () => void;
  onOpenSite: (id: string) => void;
}) {
  const [pendingItems, setPendingItems] = useState(0);
  const [autoPriceDefault, setAutoPriceDefault] = useState(true);
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY.displayName);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/company/current", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((v) => {
        setCompanyName(v.company.displayName);
        setAutoPriceDefault(v.company.quotePreferences?.autoPrice ?? true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [sites, setSites] = useState<Site[]>([]);
  const [convertModal, setConvertModal] = useState(false);
  const [editing, setEditing] = useState(false),
    [showCustomers, setShowCustomers] = useState(false);
  const [tradeFilter, setTradeFilter] = useState(""),
    [sort, setSort] = useState("updated"),
    [page, setPage] = useState(0);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<QuoteView | null>(null),
    [form, setForm] = useState<QuoteInput | null>(null);
  const [printMode, setPrintMode] = useState<string>("전체 상세"),
    [preview, setPreview] = useState("");
  const [startDate, setStartDate] = useState(today),
    [endDate, setEndDate] = useState(today),
    [converting, setConverting] = useState(false);
  const previewUrl = useRef("");
  function clearPreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
    setPreview("");
  }
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    const q = new URLSearchParams({
      search,
      status,
      from,
      to,
      trade: tradeFilter,
      sort,
    });
    setPage(0);
    Promise.all([
      api<QuoteListRow[]>(`/quotes/index?${q}`, { signal: c.signal }),
      api<Customer[]>("/customers", { signal: c.signal }),
      api<Site[]>("/sites", { signal: c.signal }),
    ])
      .then(([qs, cs, ss]) => {
        if (c.signal.aborted) return;
        setQuotes(qs);
        setCustomers(cs);
        setSites(ss);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [search, status, from, to, tradeFilter, sort, revision]);
  useEffect(() => {
    if (initialQuoteId)
      fetch(`/api/quotes/${initialQuoteId}`)
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw Error(b.message);
          return b;
        })
        .then((q) => open(q))
        .catch((e) => setError(e.message));
  }, [initialQuoteId]);
  async function open(input: QuoteView | QuoteListRow, edit = false) {
    let q = input as QuoteView;
    if (!q.companySnapshot) {
      try {
        q = await api<QuoteView>(`/quotes/${q.id}`);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setEditing(edit);
    setShowCustomers(false);
    clearPreview();
    setSelected(q);
    setForm(structuredClone(q));
    setConverting(false);
    setError("");
    setNotice("");
  }
  function change(patch: Partial<QuoteInput>) {
    clearPreview();
    setForm((f) => (f ? { ...f, ...patch } : f));
  }
  function addItems(
    kind: "기계" | "전기",
    items: QuoteItemInput[],
    standard = false,
  ) {
    clearPreview();
    setForm((f) => {
      if (!f) return f;
      const sections = f.sections.map((s) => ({
        ...s,
        items: s.items.filter((i) => i.name.trim()),
      }));
      let section = sections.find((s) => s.kind === kind);
      if (!section) {
        section = { kind, items: [] };
        sections.push(section);
      }
      const incoming =
        standard && f.autoPrice === false
          ? items.map((i) => ({
              ...i,
              pricePending: true,
              saleUnitPrice: 0,
              materialUnitCost: 0,
              laborUnitCost: 0,
              expenseUnitCost: 0,
            }))
          : items;
      section.items = accumulateQuoteItems(
        section.items,
        incoming,
        f.mergeDuplicates ?? true,
        f.mergeAcrossSources ?? true,
      );
      return { ...f, sections: sections.filter((s) => s.items.length) };
    });
  }
  const calc = (() => {
    try {
      return form ? calculateQuote(form) : null;
    } catch {
      return null;
    }
  })();
  const locked = !!selected?.convertedSiteId;
  async function save() {
    if (!form || busy || pendingItems > 0) return;
    setBusy(true);
    setError("");
    try {
      const q = await api<QuoteView>(
        selected ? `/quotes/${selected.id}` : "/quotes",
        json(
          {
            ...form,
            sections: form.sections
              .map((s) => ({
                ...s,
                items: s.items.filter((i) => i.name.trim()),
              }))
              .filter((s) => s.items.length),
          },
          selected ? "PUT" : "POST",
        ),
      );
      void open(q);
      setRevision((v) => v + 1);
      setNotice("견적을 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  async function copy(q: QuoteView) {
    setBusy(true);
    setError("");
    try {
      const clone = await api<QuoteView>(`/quotes/${q.id}/copy`, {
        method: "POST",
      });
      open(clone);
      setRevision((v) => v + 1);
      setNotice("작성중 상태의 새 견적으로 복사했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "복사 실패");
    } finally {
      setBusy(false);
    }
  }
  async function remove(q: QuoteView) {
    if (!window.confirm(`${q.siteName} 견적을 삭제하시겠습니까?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/quotes/${q.id}`, { method: "DELETE" });
      setForm(null);
      setSelected(null);
      clearPreview();
      setRevision((v) => v + 1);
      setNotice("견적을 삭제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }
  async function convert() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const site = await api<Site>(
        `/quotes/${selected.id}/convert`,
        json({ startDate, endDate }),
      );
      const q = await api<QuoteView>(`/quotes/${selected.id}`);
      void open(q);
      setRevision((v) => v + 1);
      onChanged();
      setNotice("계약금액과 공종을 반영한 새 현장을 생성했습니다.");
      setSites((ss) => [...ss.filter((s) => s.id !== site.id), site]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "현장 생성 실패");
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetchQuoteDocument(
        `/api/quotes/${selected.id}/pdf?mode=${encodeURIComponent(printMode)}`,
      );
      if (!r.ok) throw Error("공유용 PDF를 생성하지 못했습니다.");
      const filename = quoteDocumentFilename(
        selected.siteName,
        selected.quoteDate,
        "pdf",
      );
      const file = new File([await r.blob()], filename, {
        type: "application/pdf",
      });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: selected.siteName + " 견적서",
        });
        setNotice("공유 창을 열었습니다.");
      } else {
        const url = URL.createObjectURL(file),
          a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice(`공유용 PDF를 다운로드했습니다: ${filename}`);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function print(download: boolean, excel = false) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetchQuoteDocument(
        `/api/quotes/${selected.id}/${excel ? "excel" : "pdf"}?${new URLSearchParams({ mode: printMode, preview: download ? "false" : "true" })}`,
      );
      if (!r.ok) {
        const b = await r.json();
        throw Error(b.message || "견적서 PDF 생성 실패");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const name = r.headers
          .get("Content-Disposition")
          ?.match(/filename\*=UTF-8''(.+)$/)?.[1];
        const a = document.createElement("a");
        a.href = url;
        a.download = name ? decodeURIComponent(name) : "견적서.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice(
          `고객용 견적서 ${excel ? "Excel" : "PDF"}을 다운로드했습니다.`,
        );
      } else {
        clearPreview();
        previewUrl.current = url;
        setPreview(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 생성 실패");
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    !!selected &&
    !!form &&
    JSON.stringify(form) !== JSON.stringify({ ...selected });
  // Compare only editable fields: computed projection fields are preserved in loaded form,
  // and a newly changed field makes the document snapshot dirty.
  const rows = calc
    ? ([
        ["재료비", calc.totals.material],
        ["노무비", calc.totals.labor],
        ["경비", calc.totals.expense],
        ["일반관리비", calc.totals.generalFee],
        ["착·준공지원비", calc.totals.supportFee],
        ["고객가격 조정", calc.totals.adjustment],
        ["공급가액", calc.totals.supplyAmount],
        ["VAT", calc.totals.vat],
        ["총액", calc.totals.totalAmount],
      ] as const)
    : [];
  return (
    <div className="quotes-workspace quote-simple-mode">
      {form && editing && (
        <>
          <details className="quote-settings">
            <summary>입력 옵션 · 단가 자동입력 / 중복 합산</summary>
            <div className="quote-entry-options">
              <label>
                <input
                  type="checkbox"
                  checked={form.autoPrice ?? autoPriceDefault}
                  onChange={(e) => change({ autoPrice: e.target.checked })}
                />
                단가 자동입력
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.mergeDuplicates ?? true}
                  onChange={(e) =>
                    change({ mergeDuplicates: e.target.checked })
                  }
                />
                중복 품목 자동합산
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.mergeAcrossSources ?? true}
                  onChange={(e) =>
                    change({ mergeAcrossSources: e.target.checked })
                  }
                />
                자동·수동 입력 품목 병합
              </label>
            </div>
          </details>
          {calc && (
            <div className="quote-sticky-total" aria-label="견적 요약">
              {rows
                .filter(([label]) =>
                  [
                    "재료비",
                    "노무비",
                    "경비",
                    "공급가액",
                    "VAT",
                    "총액",
                  ].includes(label),
                )
                .map(([label, n]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{money(n)}</strong>
                  </div>
                ))}
            </div>
          )}
          {pendingItems > 0 && (
            <p role="status">선택한 품목을 추가하는 중입니다…</p>
          )}
        </>
      )}
      <details className="quote-settings quote-management">
        <summary>자재DB · 표준작업 관리</summary>
        <StandardWorkPanel
          onAdd={
            form && editing
              ? (kind, items) => addItems(kind, items, true)
              : undefined
          }
        />
      </details>

      {form && editing && (
        <label>
          <input
            type="checkbox"
            checked={form.groupComponents ?? false}
            onChange={(e) => change({ groupComponents: e.target.checked })}
          />
          고객 출력: 부속류·잡자재·배관 묶음 표시 (내부 구성품 유지)
        </label>
      )}

      {!form && (
        <div className="quote-mode-picker" aria-label="견적 및 거래처 관리">
          <button
            type="button"
            aria-pressed={!showCustomers}
            onClick={() => setShowCustomers(false)}
          >
            견적 목록
          </button>
          <button
            type="button"
            aria-pressed={showCustomers}
            onClick={() => setShowCustomers(true)}
          >
            거래처 관리
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            다시 시도
          </button>
        </p>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      {!form ? (
        showCustomers ? (
          <QuoteCustomerDirectory
            onQuote={(q) => void open(q)}
            onSite={onOpenSite}
          />
        ) : (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>견적 목록</h2>
                <p>기계·전기 견적과 승인 후 계약전환을 관리하세요.</p>
              </div>
              <button
                className="primary-button"
                disabled={busy || loading}
                onClick={() => {
                  setSelected(null);
                  setEditing(true);
                  void api<{
                    company: import("@jongro/shared").Company;
                  }>("/company/current")
                    .then((v) =>
                      setForm({
                        ...newQuote(""),
                        companySnapshot: quoteCompanyDefaults(v.company),
                        autoPrice:
                          v.company.quotePreferences?.autoPrice ?? true,
                        mergeDuplicates: true,
                        mergeAcrossSources: true,
                      }),
                    )
                    .catch((e) => setError(e.message));
                  setNotice("");
                  setError("");
                }}
              >
                ＋ 새 견적 작성
              </button>
            </div>
            <div className="site-filters">
              <label>
                과거 견적 검색
                <input
                  type="search"
                  placeholder="견적번호 · 거래처 · 현장 · 공사내용"
                  value={search}
                  maxLength={300}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                견적 상태 필터
                <select
                  aria-label="견적 상태 필터"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">전체 상태</option>
                  {QUOTE_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                견적일 시작
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                견적일 종료
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label>
                공종 필터
                <select
                  aria-label="견적 공종 필터"
                  value={tradeFilter}
                  onChange={(e) => setTradeFilter(e.target.value)}
                >
                  {["", "기계", "전기", "기계+전기"].map((t) => (
                    <option key={t} value={t}>
                      {t || "전체 공종"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                정렬
                <select
                  aria-label="견적 정렬"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  {[
                    ["updated", "최신 수정일"],
                    ["created", "최신 작성일"],
                    ["amount", "견적금액"],
                    ["client", "거래처명"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {loading ? (
              <p role="status">견적을 불러오는 중입니다…</p>
            ) : (
              <>
                <div className="table-scroll quote-list-desktop">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "견적일",
                          "견적번호",
                          "거래처",
                          "현장명",
                          "공사내용",
                          "견적금액",
                          "상태",
                          "담당자",
                          "최종수정일",
                        ].map((l) => (
                          <th key={l}>{l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.slice(page * 40, (page + 1) * 40).map((q) => (
                        <tr
                          key={q.id}
                          className="quote-list-row"
                          onClick={() => void open(q)}
                        >
                          <td>{q.quoteDate}</td>
                          <td>{q.quoteNumber ?? q.id}</td>
                          <td>{q.customerName || "—"}</td>
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              aria-label={`견적 상세 ${q.siteName}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void open(q);
                              }}
                            >
                              {q.siteName}
                            </button>
                          </td>
                          <td>{q.workContent}</td>
                          <td>{money(q.totals.totalAmount)}</td>
                          <td>
                            <span className="badge">{q.status}</span>
                          </td>
                          <td>{q.quoteContactName || "—"}</td>
                          <td>{q.updatedAt.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="quote-list-mobile">
                  {quotes.slice(page * 40, (page + 1) * 40).map((q) => (
                    <button
                      type="button"
                      className="quote-list-card"
                      key={q.id}
                      onClick={() => void open(q)}
                    >
                      <strong>{q.siteName}</strong>
                      <span>{q.customerName || "거래처 입력 안 함"}</span>
                      <b>{money(q.totals.totalAmount)}</b>
                      <span>
                        {q.status} · {q.quoteDate}
                      </span>
                      <small>{q.quoteNumber ?? q.id}</small>
                    </button>
                  ))}
                </div>
                {!quotes.length && (
                  <p className="empty">조건에 맞는 견적이 없습니다.</p>
                )}
                {quotes.length > 40 && (
                  <div className="quote-list-pagination">
                    <button
                      disabled={!page}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      이전
                    </button>
                    <span>
                      {page + 1} / {Math.ceil(quotes.length / 40)}
                    </span>
                    <button
                      disabled={(page + 1) * 40 >= quotes.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      다음
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )
      ) : !editing && selected ? (
        <QuoteDetailView
          quote={selected}
          onEdit={() => {
            setEditing(true);
            clearPreview();
          }}
          onCopy={() => void copy(selected)}
          onRemove={() => void remove(selected)}
          onPrint={(d, e) => void print(d, e)}
          onShare={() => void share()}
          onBack={() => {
            setForm(null);
            setSelected(null);
            clearPreview();
          }}
          onSite={onOpenSite}
          onConvert={() => {
            setConvertModal(true);
          }}
          busy={busy}
          mode={printMode}
          onMode={(v) => {
            setPrintMode(v);
            clearPreview();
          }}
          preview={preview}
        />
      ) : (
        <>
          <div className="site-toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "저장하지 않은 변경사항을 버리고 목록으로 이동하시겠습니까?",
                  )
                )
                  return;
                setForm(null);
                setSelected(null);
                clearPreview();
              }}
            >
              ← 견적 목록
            </button>
            <div className="worker-actions">
              {selected && (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || dirty}
                    onClick={() => copy(selected)}
                  >
                    견적 복사
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || locked}
                    onClick={() => remove(selected)}
                  >
                    견적 삭제
                  </button>
                </>
              )}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>{selected ? "견적 수정" : "새 견적 작성"}</h2>
                  <p>
                    {locked
                      ? "계약전환된 견적은 복사하여 새 견적으로 수정할 수 있습니다."
                      : "고객 판매가격과 내부 원가를 분리하여 입력합니다."}
                  </p>
                </div>
                {!locked && (
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={busy || pendingItems > 0}
                  >
                    {busy ? "처리 중…" : "견적 저장"}
                  </button>
                )}
              </div>
              <fieldset disabled={busy || locked} className="quote-fieldset">
                <div className="form-grid">
                  <div className="full-width">
                    <QuoteCustomerPicker
                      customers={customers}
                      quote={form}
                      onChange={change}
                      onCreated={(c) => setCustomers((cs) => [...cs, c])}
                    />
                  </div>
                  <label>
                    기존 현장 연결 (선택)
                    <select
                      aria-label="기존 현장 연결 (선택)"
                      value={form.siteId ?? ""}
                      onChange={(e) => {
                        const site = sites.find((s) => s.id === e.target.value);
                        const c = customers.find(
                          (c) =>
                            c.id === site?.clientId || c.name === site?.client,
                        );
                        change(
                          site
                            ? {
                                siteId: site.id,
                                siteName: site.name,
                                address: site.address,
                                workContent: site.description,
                                ...(c ? { customerId: c.id } : {}),
                              }
                            : { siteId: null },
                        );
                      }}
                    >
                      <option value="">연결 없음</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    현장명
                    <input
                      required
                      maxLength={300}
                      value={form.siteName}
                      onChange={(e) => change({ siteName: e.target.value })}
                    />
                  </label>
                  <details className="quote-settings full-width">
                    <summary>주소 · 날짜 · 출력 설정 · 비고</summary>
                    <div className="form-grid">
                      <label>
                        주소
                        <input
                          maxLength={300}
                          value={form.address}
                          onChange={(e) => change({ address: e.target.value })}
                        />
                      </label>
                      <label>
                        견적일
                        <input
                          required
                          type="date"
                          value={form.quoteDate}
                          onChange={(e) =>
                            change({ quoteDate: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        유효기간
                        <input
                          required
                          type="date"
                          min={form.quoteDate}
                          value={form.validUntil}
                          onChange={(e) =>
                            change({ validUntil: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        견적 상태
                        <select
                          aria-label="견적 상태"
                          value={form.status}
                          onChange={(e) =>
                            change({
                              status: e.target.value as QuoteInput["status"],
                            })
                          }
                        >
                          {QUOTE_STATUSES.filter(
                            (s) => s !== "계약전환" || locked,
                          ).map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        고객가격 반올림
                        <select
                          aria-label="고객가격 반올림"
                          value={form.rounding}
                          onChange={(e) =>
                            change({
                              rounding: e.target
                                .value as QuoteInput["rounding"],
                            })
                          }
                        >
                          <option>천원 반올림</option>
                          <option>반올림 없음</option>
                        </select>
                      </label>
                      <label>
                        고객금액 표시
                        <select
                          aria-label="고객금액 표시"
                          value={form.displayUnit}
                          onChange={(e) =>
                            change({
                              displayUnit: e.target
                                .value as QuoteInput["displayUnit"],
                            })
                          }
                        >
                          <option>만원</option>
                          <option>원</option>
                        </select>
                      </label>
                      <label className="full-width">
                        공사내용
                        <textarea
                          rows={2}
                          maxLength={5000}
                          value={form.workContent}
                          onChange={(e) =>
                            change({ workContent: e.target.value })
                          }
                        />
                      </label>
                      <label className="full-width">
                        고객용 비고
                        <textarea
                          rows={2}
                          maxLength={5000}
                          value={form.notes}
                          onChange={(e) => change({ notes: e.target.value })}
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </fieldset>
            </section>
            <section className="panel quote-details quote-mobile-compose">
              {calc && (
                <QuoteSummaryEditor
                  quote={form}
                  documentNumber={selected?.quoteNumber ?? selected?.id}
                  disabled={busy || locked}
                  onChange={change}
                  totals={calc.totals}
                />
              )}
              <QuoteLineEditor
                key={selected?.id ?? "new"}
                form={form}
                disabled={busy || locked}
                onAdd={addItems}
                onChange={change}
                quickInput={(kind) => (
                  <QuoteQuickInput
                    activeTrade={kind}
                    totals={calc?.totals}
                    onPendingChange={setPendingItems}
                    autoPrice={form.autoPrice ?? autoPriceDefault}
                    onAdd={(items, section) => addItems(section, items)}
                  />
                )}
              />
              <details className="quote-settings quote-financial-details">
                <summary>
                  금액 상세 · 일반관리비 · 착·준공지원비 · 내부원가
                </summary>
                <div className="quote-summary">
                  <div>
                    <h3>고객 공개 견적 요약</h3>
                    <p>
                      VAT 포함 총액을 기준으로 표시합니다. 항목별 판매금액을
                      고객금액 분류에 따라 집계합니다.
                    </p>
                    <table>
                      <tbody>
                        {rows.map(([label, n]) => (
                          <tr key={label}>
                            <th>{label}</th>
                            <td>{sale(n, form.displayUnit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details className="quote-internal">
                    <summary>내부 원가·마진 · 관리자용</summary>

                    <p>고객용 PDF와 공개 데이터에는 포함되지 않습니다.</p>
                    {calc ? (
                      <dl className="info-grid">
                        {[
                          ["재료 원가", calc.internal.material],
                          ["노무 원가", calc.internal.labor],
                          ["경비 원가", calc.internal.expense],
                          ["총 내부 원가", calc.internal.totalCost],
                          ["마진 (공급가액 기준)", calc.internal.margin],
                        ].map(([l, n]) => (
                          <div key={l}>
                            <dt>{l}</dt>
                            <dd>{money(Number(n))}</dd>
                          </div>
                        ))}
                        <div>
                          <dt>마진율</dt>
                          <dd>{calc.internal.marginRate.toFixed(1)}%</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="error">수량과 금액 범위를 확인해 주세요.</p>
                    )}
                  </details>
                </div>
                <fieldset disabled={busy || locked} className="quote-fieldset">
                  <div className="form-grid">
                    {(
                      [
                        "generalFee",
                        "supportFee",
                        "internalGeneralCost",
                        "internalSupportCost",
                      ] as const
                    ).map((key, i) => (
                      <label key={key}>
                        {
                          [
                            "고객 일반관리비",
                            "고객 착·준공지원비",
                            "내부 일반관리 원가",
                            "내부 착·준공지원 원가",
                          ][i]
                        }
                        <QuoteNumberInput
                          min={0}
                          step={1}
                          value={form[key]}
                          onValue={(value) => change({ [key]: value })}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              </details>
            </section>
            {form && editing && (
              <div className="quote-save-bar" aria-label="견적 저장 액션바">
                <span>
                  {form.sections.reduce(
                    (n, s) => n + s.items.filter((i) => i.name.trim()).length,
                    0,
                  )}
                  개 품목
                </span>
                <span>
                  공급가액{" "}
                  <strong>{money(calc?.totals.supplyAmount ?? 0)}</strong>
                </span>
                <span>
                  VAT <strong>{money(calc?.totals.vat ?? 0)}</strong>
                </span>
                <span>
                  총액 <strong>{money(calc?.totals.totalAmount ?? 0)}</strong>
                </span>
                {!locked && (
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={busy || pendingItems > 0}
                  >
                    {busy ? "저장 중…" : "저장"}
                  </button>
                )}
              </div>
            )}
          </form>
          {selected && (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>고객용 견적서 출력</h3>
                  <p>저장된 견적을 출력합니다. 변경사항은 먼저 저장하세요.</p>
                </div>
              </div>
              <div className="site-filters">
                <label>
                  출력모드
                  <select
                    aria-label="출력모드"
                    disabled={busy}
                    value={printMode}
                    onChange={(e) => {
                      setPrintMode(e.target.value);
                      clearPreview();
                    }}
                  >
                    {QUOTE_PRINT_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || dirty}
                  onClick={() => print(false)}
                >
                  고객용 PDF 미리보기
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || dirty}
                  onClick={() => print(true)}
                >
                  견적서 PDF 다운로드
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || dirty}
                  onClick={() => print(true, true)}
                >
                  {companyName} Excel 다운로드
                </button>
              </div>
              {preview && (
                <div className="report-preview">
                  <PdfPreview url={preview} />
                  <a href={preview} target="_blank" rel="noreferrer">
                    견적서 미리보기 새 창
                  </a>
                </div>
              )}
            </section>
          )}
          {selected && (
            <section className="panel">
              <h3>현장으로 전환</h3>
              {locked ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onOpenSite(selected.convertedSiteId!)}
                >
                  생성된 현장 보기
                </button>
              ) : (
                <>
                  <p>
                    승인된 견적의 거래처·현장명·주소·공사내용·VAT 포함
                    계약금액·기계/전기 공종으로 새 현장을 생성합니다.
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || dirty || selected.status !== "승인"}
                    onClick={() => setConverting((v) => !v)}
                  >
                    현장 생성
                  </button>
                  {converting && (
                    <div className="site-filters">
                      <label>
                        공사 시작일
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </label>
                      <label>
                        공사 종료예정일
                        <input
                          type="date"
                          min={startDate}
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy}
                        onClick={convert}
                      >
                        현장 생성 확정
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {convertModal && selected && (
        <div
          className="quote-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="견적 현장 생성"
        >
          <section className="panel">
            <h3>승인 견적에서 현장 생성</h3>
            <p>{selected.siteName}</p>
            <label>
              공사 시작일
              <input
                aria-label="현장 생성 시작일"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              공사 종료예정일
              <input
                aria-label="현장 생성 종료일"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              type="button"
              onClick={() => void convert().then(() => setConvertModal(false))}
            >
              현장 생성 확정
            </button>
            <button type="button" onClick={() => setConvertModal(false)}>
              취소
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
