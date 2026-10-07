"use client";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_COMPANY,
  Customer,
  QuoteInput,
  QuoteItemInput,
  QuoteView,
  Site,
  QUOTE_SECTIONS,
  QUOTE_STATUSES,
  QUOTE_PRICE_CATEGORIES,
  QUOTE_PRINT_MODES,
  calculateQuote,
  quoteLineAmount,
} from "@jongno/shared";
import QuoteQuickInput from "./quote-quick-input";
import {accumulateQuoteItems} from "@jongno/shared";
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
const newItem = (): QuoteItemInput => ({
  entrySources:["manual"],
  trade: "소방시설",
  name: "",
  specification: "",
  quantity: 1,
  unit: "개",
  materialUnitCost: 0,
  laborUnitCost: 0,
  expenseUnitCost: 0,
  saleUnitPrice: 0,
  priceCategory: "재료비",
  notes: "",
});
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
  sections: [{ kind: "기계", items: [newItem()] }],
});
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, init),
    body = await r.json();
  if (!r.ok) throw Error(body.message || "견적 요청 실패");
  return body;
}
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export default function QuotesPanel({
  onChanged,
  onOpenSite,
}: {
  onChanged: () => void;
  onOpenSite: (id: string) => void;
}) {
  const [autoPriceDefault,setAutoPriceDefault]=useState(true);
  const [companyName,setCompanyName] = useState(DEFAULT_COMPANY.displayName);
  useEffect(()=>{const controller=new AbortController();fetch("/api/company/current",{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{setCompanyName(v.company.displayName);setAutoPriceDefault(v.company.quotePreferences?.autoPrice??true);}).catch(()=>{});return()=>controller.abort();},[]);
  const [quotes, setQuotes] = useState<QuoteView[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [sites, setSites] = useState<Site[]>([]);
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
  const [tab, setTab] = useState("갑지: 총괄"),
    [printMode, setPrintMode] = useState<string>("전체 상세"),
    [preview, setPreview] = useState("");
  const [startDate, setStartDate] = useState(today),
    [endDate, setEndDate] = useState(today),
    [converting, setConverting] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: "",
    address: "",
    contactName: "",
    phone: "",
  });
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
    const q = new URLSearchParams({ search, status, from, to });
    Promise.all([
      api<QuoteView[]>(`/quotes?${q}`, { signal: c.signal }),
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
  }, [search, status, from, to, revision]);
  function open(q: QuoteView) {
    clearPreview();
    setSelected(q);
    setForm(structuredClone(q));
    setTab("갑지: 총괄");
    setConverting(false);
    setError("");
    setNotice("");
  }
  function change(patch: Partial<QuoteInput>) {
    clearPreview();
    setForm((f) => (f ? { ...f, ...patch } : f));
  }
  function addItems(kind:'기계'|'전기',items:QuoteItemInput[],standard=false){
    clearPreview();setForm(f=>{if(!f)return f;const sections=f.sections.map(s=>({...s,items:s.items.filter(i=>i.name.trim())}));let section=sections.find(s=>s.kind===kind);if(!section){section={kind,items:[]};sections.push(section);}
    const incoming=standard&&f.autoPrice===false?items.map(i=>({...i,pricePending:true,saleUnitPrice:0,materialUnitCost:0,laborUnitCost:0,expenseUnitCost:0})):items;
    section.items=accumulateQuoteItems(section.items,incoming,f.mergeDuplicates??true,f.mergeAcrossSources??true);
    return {...f,sections:sections.filter(s=>s.items.length)};
    });setTab(`을지: ${kind}`);
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
    if (!form || busy) return;
    setBusy(true);
    setError("");
    try {
      const q = await api<QuoteView>(
        selected ? `/quotes/${selected.id}` : "/quotes",
        json(form, selected ? "PUT" : "POST"),
      );
      open(q);
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
  async function createCustomer() {
    setBusy(true);
    setError("");
    try {
      const c = await api<Customer>("/customers", json(customerForm));
      setCustomers((cs) => [...cs, c]);
      change({ customerId: c.id });
      setCustomerForm({ name: "", address: "", contactName: "", phone: "" });
      setNotice("거래처를 등록하고 견적에 연결했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "거래처 등록 실패");
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
      open(q);
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
  async function print(download: boolean, excel = false) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
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
        setNotice(`고객용 견적서 ${excel ? "Excel" : "PDF"}을 다운로드했습니다.`);
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
    <div className="quotes-workspace">
      {form&&<>
        <div className="quote-entry-options">
        <label><input type="checkbox" checked={form.autoPrice??autoPriceDefault} onChange={e=>change({autoPrice:e.target.checked})}/>단가 자동입력</label>
        <label><input type="checkbox" checked={form.mergeDuplicates??true} onChange={e=>change({mergeDuplicates:e.target.checked})}/>중복 품목 자동합산</label>
        <label><input type="checkbox" checked={form.mergeAcrossSources??true} onChange={e=>change({mergeAcrossSources:e.target.checked})}/>자동·수동 입력 품목 병합</label>
        </div><QuoteQuickInput autoPrice={form.autoPrice??autoPriceDefault} onAdd={(items,kind)=>addItems(kind,items)}/>
      </>}
      <StandardWorkPanel onAdd={form?(kind,items)=>addItems(kind,items,true):undefined}/>

      {form && <label><input type="checkbox" checked={form.groupComponents??false} onChange={e=>change({groupComponents:e.target.checked})}/>고객 출력: 부속류·잡자재·배관 묶음 표시 (내부 구성품 유지)</label>}

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
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>견적 목록</h2>
              <p>기계·전기 견적과 승인 후 계약전환을 관리하세요.</p>
            </div>
            <button
              className="primary-button"
              disabled={busy || !customers.length}
              onClick={() => {
                setSelected(null);
                void api<{company:{quotePreferences?:{autoPrice:boolean}}}>("/company/current").then(v=>setForm({...newQuote(customers[0].id),autoPrice:v.company.quotePreferences?.autoPrice??true,mergeDuplicates:true,mergeAcrossSources:true})).catch(e=>setError(e.message));
                setTab("갑지: 총괄");
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
                placeholder="현장, 거래처, 품명"
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
          </div>
          {loading ? (
            <p role="status">견적을 불러오는 중입니다…</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "현장명",
                      "거래처",
                      "견적일 / 유효기간",
                      "을지",
                      "고객 총액 (VAT 포함)",
                      "상태",
                      "연결 현장",
                      "관리",
                    ].map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => open(q)}
                        >
                          {q.siteName}
                        </button>
                        <small>{q.id}</small>
                      </td>
                      <td>{q.customerName}</td>
                      <td>
                        {q.quoteDate}
                        <small>{q.validUntil}까지</small>
                      </td>
                      <td>
                        {q.sections
                          .filter((s) => s.items.length)
                          .map((s) => s.kind)
                          .join(" + ")}
                      </td>
                      <td>{sale(q.totals.totalAmount, q.displayUnit)}</td>
                      <td>
                        <span className="badge">{q.status}</span>
                      </td>
                      <td>
                        {q.convertedSiteId || q.siteId ? (
                          <button
                            className="text-button"
                            onClick={() =>
                              onOpenSite(q.convertedSiteId || q.siteId!)
                            }
                          >
                            현장 보기
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => copy(q)}
                        >
                          복사
                        </button>{" "}
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy || !!q.convertedSiteId}
                          onClick={() => remove(q)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quotes.length && (
                <p className="empty">조건에 맞는 견적이 없습니다.</p>
              )}
            </div>
          )}
        </section>
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
                    disabled={busy}
                  >
                    {busy ? "처리 중…" : "견적 저장"}
                  </button>
                )}
              </div>
              <fieldset disabled={busy || locked} className="quote-fieldset">
                <div className="form-grid">
                  <label>
                    거래처
                    <select
                      aria-label="거래처"
                      required
                      value={form.customerId}
                      onChange={(e) => change({ customerId: e.target.value })}
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
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
                      onChange={(e) => change({ quoteDate: e.target.value })}
                    />
                  </label>
                  <label>
                    유효기간
                    <input
                      required
                      type="date"
                      min={form.quoteDate}
                      value={form.validUntil}
                      onChange={(e) => change({ validUntil: e.target.value })}
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
                          rounding: e.target.value as QuoteInput["rounding"],
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
                      onChange={(e) => change({ workContent: e.target.value })}
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
                <details className="quote-customer">
                  <summary>새 거래처 등록</summary>
                  <div className="form-grid">
                    {(["name", "address", "contactName", "phone"] as const).map(
                      (key, i) => (
                        <label key={key}>
                          {
                            [
                              "거래처명",
                              "거래처 주소",
                              "담당자",
                              "거래처 연락처",
                            ][i]
                          }
                          <input
                            maxLength={300}
                            value={customerForm[key]}
                            onChange={(e) =>
                              setCustomerForm((c) => ({
                                ...c,
                                [key]: e.target.value,
                              }))
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!customerForm.name.trim()}
                    onClick={createCustomer}
                  >
                    거래처 등록
                  </button>
                </details>
              </fieldset>
            </section>
            <section className="panel quote-details">
              <div className="tab-list" role="tablist" aria-label="견적 구성">
                {["갑지: 총괄", "을지: 기계", "을지: 전기"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "selected" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {tab === "갑지: 총괄" ? (
                <>
                  <div className="quote-summary">
                    <div>
                      <h3>고객 공개 갑지</h3>
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
                    <div className="quote-internal">
                      <h3>내부 원가·마진 · 관리자용</h3>
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
                        <p className="error">
                          수량과 금액 범위를 확인해 주세요.
                        </p>
                      )}
                    </div>
                  </div>
                  <fieldset
                    disabled={busy || locked}
                    className="quote-fieldset"
                  >
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
                          <input
                            type="number"
                            min={0}
                            step={1}
                            required
                            value={form[key]}
                            onChange={(e) =>
                              change({ [key]: Number(e.target.value) })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              ) : (
                QUOTE_SECTIONS.filter((kind) => tab === `을지: ${kind}`).map(
                  (kind) => {
                    const section = form.sections.find((s) => s.kind === kind);
                    const items = section?.items ?? [];
                    const update = (
                      index: number,
                      patch: Partial<QuoteItemInput>,
                    ) =>
                      change({
                        sections: section
                          ? form.sections.map((s) =>
                              s.kind === kind
                                ? {
                                    ...s,
                                    items: s.items.map((item, i) =>
                                      i === index
                                        ? { ...item, ...patch }
                                        : item,
                                    ),
                                  }
                                : s,
                            )
                          : [...form.sections, { kind, items: [] }],
                      });
                    return (
                      <fieldset
                        key={kind}
                        className="quote-fieldset"
                        disabled={busy || locked}
                      >
                        <div className="panel-title">
                          <div>
                            <h3>을지 · {kind}</h3>
                            <p>
                              {items.length}개 항목 · 판매단가로 고객금액을
                              계산합니다.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              change({
                                sections: section
                                  ? form.sections.map((s) =>
                                      s.kind === kind
                                        ? {
                                            ...s,
                                            items: [...s.items, newItem()],
                                          }
                                        : s,
                                    )
                                  : [
                                      ...form.sections,
                                      { kind, items: [newItem()] },
                                    ],
                              })
                            }
                          >
                            {kind} 항목 추가
                          </button>
                        </div>
                        {items.map((item, index) => (
                          <article className="quote-item" key={index}>
                            <div className="panel-title">
                              <strong>
                                {kind} 항목 {index + 1}
                              </strong>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  change({
                                    sections: form.sections.map((s) =>
                                      s.kind === kind
                                        ? {
                                            ...s,
                                            items: s.items.filter(
                                              (_, i) => i !== index,
                                            ),
                                          }
                                        : s,
                                    ),
                                  })
                                }
                              >
                                항목 삭제
                              </button>
                            </div>
                            <div className="form-grid">
                              {(
                                [
                                  "trade",
                                  "name",
                                  "specification",
                                  "unit",
                                ] as const
                              ).map((key, i) => (
                                <label key={key}>
                                  {["공종", "품명", "규격", "단위"][i]}
                                  <input
                                    required={key !== "specification"}
                                    maxLength={
                                      key === "trade"
                                        ? 100
                                        : key === "unit"
                                          ? 30
                                          : 300
                                    }
                                    value={item[key]}
                                    onChange={(e) =>
                                      update(index, { [key]: e.target.value })
                                    }
                                  />
                                </label>
                              ))}
                              <label>
                                수량
                                <input
                                  required
                                  type="number"
                                  min={0.001}
                                  max={1000000}
                                  step={0.001}
                                  value={item.quantity}
                                  onChange={(e) =>
                                    update(index, {
                                      quantity: Number(e.target.value),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                판매단가 (고객 공개)
                                <input
                                  required
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.pricePending&&item.saleUnitPrice===0?"":item.saleUnitPrice}
                                  onChange={(e) =>
                                    update(index, {
                                      saleUnitPrice: Number(e.target.value),pricePending:false,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                고객금액 분류
                                <select
                                  aria-label="고객금액 분류"
                                  value={item.priceCategory}
                                  onChange={(e) =>
                                    update(index, {
                                      priceCategory: e.target
                                        .value as QuoteItemInput["priceCategory"],
                                    })
                                  }
                                >
                                  {QUOTE_PRICE_CATEGORIES.map((c) => (
                                    <option key={c}>{c}</option>
                                  ))}
                                </select>
                              </label>
                              <div className="quote-line-total">
                                고객 금액
                                <strong>
                                  {(() => {
                                    try {
                                      return money(
                                        quoteLineAmount(
                                          item.quantity,
                                          item.saleUnitPrice,
                                        ),
                                      );
                                    } catch {
                                      return "범위 오류";
                                    }
                                  })()}
                                </strong>
                              </div>
                              <label className="full-width">
                                항목 비고 (고객 공개)
                                <textarea
                                  rows={2}
                                  maxLength={1000}
                                  value={item.notes}
                                  onChange={(e) =>
                                    update(index, { notes: e.target.value })
                                  }
                                />
                              </label>
                            </div>
                            <div className="quote-internal">
                              <strong>내부 원가 단가 · 관리자용</strong>
                              <div className="form-grid">
                                {(
                                  [
                                    "materialUnitCost",
                                    "laborUnitCost",
                                    "expenseUnitCost",
                                  ] as const
                                ).map((key, i) => (
                                  <label key={key}>
                                    {
                                      [
                                        "재료비 단가 (내부)",
                                        "노무비 단가 (내부)",
                                        "경비 단가 (내부)",
                                      ][i]
                                    }
                                    <input
                                      required
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={item[key]}
                                      onChange={(e) =>
                                        update(index, {
                                          [key]: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          </article>
                        ))}
                        {!items.length && (
                          <p className="empty">
                            {kind} 항목을 추가하세요. 빈 을지는 고객 출력에서
                            생략합니다.
                          </p>
                        )}
                      </fieldset>
                    );
                  },
                )
              )}
            </section>
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
                <button type="button" className="primary-button" disabled={busy || dirty} onClick={() => print(true, true)}>{companyName} Excel 다운로드</button>
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
    </div>
  );
}
