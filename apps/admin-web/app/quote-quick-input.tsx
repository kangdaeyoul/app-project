"use client";
import QuoteNumberInput from "./quote-number-input";
import StandardWorkQuick from "./standard-work-quick";
import { useEffect, useRef, useState } from "react";
import {
  StandardWork,
  WorkPrice,
  QuoteItemInput,
  QuoteFavorites,
  QuotePublicTotals,
  priceToQuoteItem,
} from "@jongro/shared";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api" + path,
    body === undefined
      ? undefined
      : {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const v = await r.json();
  if (!r.ok) throw Error(v.message || "요청 실패");
  return v;
}
export default function QuoteQuickInput({
  autoPrice,
  activeTrade,
  onAdd,
  onPendingChange,
  totals,
}: {
  activeTrade?: "기계" | "전기";
  onPendingChange?: (count: number) => void;
  autoPrice: boolean;
  totals?: QuotePublicTotals;
  onAdd: (items: QuoteItemInput[], section: "기계" | "전기") => void;
}) {
  const opener = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLElement>(null);
  const pending = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pending.current) onPendingChange?.(0);
    };
  }, [onPendingChange]);
  const [entryTab, setEntryTab] = useState("표준작업");
  const [expanded, setExpanded] = useState(false),
    [allTrades, setAllTrades] = useState(false);
  const [templates, setTemplates] = useState<StandardWork[]>([]);
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = old;
      opener.current?.focus();
    };
  }, [expanded]);
  const [prices, setPrices] = useState<WorkPrice[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [section, setSection] = useState<"기계" | "전기">("전기"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [defaultPrice, setDefaultPrice] = useState(true);
  useEffect(() => {
    if (activeTrade) setSection(activeTrade);
  }, [activeTrade]);
  const [manual, setManual] = useState({
    materialCode: "",
    name: "",
    specification: "",
    unit: "개",
    quantity: 0,
    saleUnitPrice: 0,
  });
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      fetch("/api/standard-work", { signal: c.signal }).then((r) => {
        if (!r.ok) throw Error("자재DB 조회 실패");
        return r.json();
      }),
      fetch("/api/standard-work/favorites", { signal: c.signal }).then((r) => {
        if (!r.ok) throw Error("즐겨찾기 조회 실패");
        return r.json();
      }),
      fetch("/api/company/current", { signal: c.signal }).then((r) => r.json()),
    ])
      .then(([d, f, company]) => {
        setPrices(d.prices);
        setTemplates(d.templates);
        setIds(f.priceIds);
        setDefaultPrice(company.company.quotePreferences?.autoPrice ?? true);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  async function favorites(next: string[]) {
    setBusy(true);
    setError("");
    try {
      const v = await api<QuoteFavorites>("/standard-work/favorites", {
        priceIds: next,
      });
      setIds(v.priceIds);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function add(p: WorkPrice, source: "catalog" | "favorite") {
    pending.current++;
    onPendingChange?.(pending.current);
    setError("");
    try {
      const data = await api<{ prices: WorkPrice[] }>("/standard-work");
      if (!mounted.current) return;
      const latest = data.prices.find((v) => v.id === p.id);
      if (!latest) throw Error("품목을 다시 조회하세요.");
      setPrices(data.prices);
      onAdd([priceToQuoteItem(latest, autoPrice, source)], section);
      setExpanded(false);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      pending.current--;
      if (mounted.current) onPendingChange?.(pending.current);
    }
  }
  const matchesTrade = (p: WorkPrice) => {
    if (allTrades) return true;
    if (p.trade?.includes("전기") || p.trade?.includes("기계"))
      return p.trade.includes(section);
    const electrical =
      /감지기|유도등|발신기|경종|표시등|시각경보기|조명등|스피커|중계기|수신반|방송|제연댐퍼|전선|전선관|단자|박스/;
    const mechanical =
      /스프링클러|백관|CPVC|동관|배관|밸브|펌프|압력|송수구|소화전|호스|관창|완강기|구조대/;
    const tradeName = electrical.test(p.name)
      ? "전기"
      : mechanical.test(p.name)
        ? "기계"
        : undefined;
    if (tradeName) return tradeName === section;
    return templates.some(
      (t) =>
        t.section === section &&
        t.components.some(
          (c) =>
            c.priceId === p.id ||
            Object.values(c.variants ?? {}).includes(p.id),
        ),
    );
  };
  return (
    <section
      ref={dialog}
      className={`panel standard-work-panel quote-add-workspace ${expanded ? "quote-add-open" : ""}`}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? "품목 추가" : undefined}
      onKeyDown={(e) => {
        if (!expanded) return;
        if (e.key === "Escape") {
          setExpanded(false);
          return;
        }
        if (e.key !== "Tab") return;
        const nodes = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary",
          ) ?? []),
        ].filter((n) => n.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="quote-entry-heading">
        <div>
          <h2>견적 품목 작성</h2>
          <p>공종 선택 → 품목 추가 → 확인 후 반영</p>
        </div>
        <div role="group" aria-label="공종 선택" className="quote-trade-picker">
          {(["전기", "기계", "직접입력"] as const).map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={
                v === "직접입력"
                  ? entryTab === "직접입력"
                  : section === v && entryTab !== "직접입력"
              }
              onClick={() => {
                setAllTrades(false);
                setSearch("");
                if (v === "직접입력") {
                  setEntryTab(v);
                  setExpanded(true);
                } else {
                  setSection(v);
                  setEntryTab("표준작업");
                }
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary-button"
          ref={opener}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "닫기" : "+ 품목 추가"}
        </button>
      </div>
      {expanded && totals && (
        <div className="quote-dialog-totals" aria-label="견적 요약">
          {(
            [
              ["재료비", totals.material],
              ["노무비", totals.labor],
              ["경비", totals.expense],
              ["공급가액", totals.supplyAmount],
              ["VAT", totals.vat],
              ["총액", totals.totalAmount],
            ] as const
          ).map(([label, n]) => (
            <span key={label}>
              {label} <strong>{n.toLocaleString()}원</strong>
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div className="quote-add-body">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div role="tablist" aria-label="견적 빠른입력 구분">
            {["표준작업", "품목", "직접입력"].map((v) => (
              <button
                type="button"
                role="tab"
                aria-selected={entryTab === v}
                key={v}
                onClick={() => setEntryTab(v)}
              >
                {v === "표준작업"
                  ? "표준작업에서 추가"
                  : v === "품목"
                    ? "자재DB에서 직접 추가"
                    : "직접입력"}
              </button>
            ))}
          </div>
          {entryTab === "표준작업" ? (
            <StandardWorkQuick
              key={section}
              section={section}
              allTrades={allTrades}
              onAllTradesChange={setAllTrades}
              autoPrice={autoPrice}
              onAdd={(items, kind) => {
                onAdd(items, kind);
                setExpanded(false);
              }}
            />
          ) : (
            <>
              {entryTab === "직접입력" && (
                <div className="form-grid">
                  <label>
                    추가할 상세 내역서
                    <select
                      aria-label="빠른입력 상세 내역서"
                      value={section}
                      onChange={(e) =>
                        setSection(e.target.value as typeof section)
                      }
                    >
                      <option>전기</option>
                      <option>기계</option>
                    </select>
                  </label>
                </div>
              )}
              <details className="quote-settings">
                <summary>회사 기본 단가 설정</summary>
                <label>
                  회사 기본설정 · 단가 자동입력
                  <input
                    type="checkbox"
                    checked={defaultPrice}
                    disabled={busy}
                    onChange={async (e) => {
                      const value = e.target.checked;
                      setBusy(true);
                      try {
                        await api("/company/quote-preferences", {
                          autoPrice: value,
                        });
                        setDefaultPrice(value);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
                <p>
                  회사 기본값은 새 견적에 적용됩니다. 현재 견적과 기존 행의
                  수정단가는 유지됩니다. 자동입력 OFF에서는 단가를 0원으로
                  추가하며 직접 입력할 수 있습니다.
                </p>
              </details>
              {entryTab === "품목" && (
                <>
                  <label className="quote-all-trades">
                    <input
                      type="checkbox"
                      checked={allTrades}
                      onChange={(e) => setAllTrades(e.target.checked)}
                    />
                    전체 공종 검색
                  </label>
                  <h3>자주 쓰는 품목 · {allTrades ? "전체" : section}</h3>
                  <div className="favorite-items">
                    {ids.map((id, n) => {
                      const p = prices.find((p) => p.id === id);
                      if (!p || !matchesTrade(p)) return null;
                      return (
                        <div key={id}>
                          <button
                            type="button"
                            aria-label={`즐겨찾기 추가 ${p.name} ${p.specification}`}
                            onClick={() => add(p, "favorite")}
                          >
                            {p.name} · {p.specification} <small>{p.unit}</small>
                          </button>
                          <button
                            type="button"
                            aria-label={`${p.name} 즐겨찾기 앞으로`}
                            disabled={busy || n === 0}
                            onClick={() => {
                              const next = [...ids];
                              [next[n - 1], next[n]] = [next[n], next[n - 1]];
                              void favorites(next);
                            }}
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            aria-label={`${p.name} 즐겨찾기 뒤로`}
                            disabled={busy || n === ids.length - 1}
                            onClick={() => {
                              const next = [...ids];
                              [next[n], next[n + 1]] = [next[n + 1], next[n]];
                              void favorites(next);
                            }}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            aria-label={`${p.name} 즐겨찾기 해제`}
                            disabled={busy}
                            onClick={() =>
                              void favorites(ids.filter((v) => v !== id))
                            }
                          >
                            ★ 해제
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <label>
                    자재DB 검색
                    <input
                      type="search"
                      aria-label="자재DB 검색"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <div className="table-scroll" style={{ maxHeight: 320 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>자재코드</th>
                          <th>품명</th>
                          <th>규격</th>
                          <th>단위</th>
                          <th>기준판매단가</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {prices
                          .filter(
                            (p) =>
                              matchesTrade(p) &&
                              [
                                p.materialCode ?? p.id,
                                p.name,
                                p.specification,
                                p.unit,
                              ]
                                .join(" ")
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          )
                          .map((p) => (
                            <tr key={p.id}>
                              <td>{p.materialCode ?? p.id}</td>
                              <td>
                                <button
                                  type="button"
                                  aria-label={`DB 추가 ${p.name} ${p.specification}`}
                                  onClick={() => add(p, "catalog")}
                                >
                                  {p.name}
                                </button>
                              </td>
                              <td>{p.specification}</td>
                              <td>{p.unit}</td>
                              <td>
                                {p.priceRegistered === false
                                  ? "단가 미등록"
                                  : p.salePrice.toLocaleString() + "원"}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={`${p.name} ${p.specification} 즐겨찾기 등록`}
                                  onClick={() =>
                                    void favorites(
                                      ids.includes(p.id)
                                        ? ids.filter((id) => id !== p.id)
                                        : [...ids, p.id],
                                    )
                                  }
                                >
                                  {ids.includes(p.id) ? "★ 해제" : "☆ 등록"}
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!prices.some(
                      (p) =>
                        matchesTrade(p) &&
                        [
                          p.materialCode ?? p.id,
                          p.name,
                          p.specification,
                          p.unit,
                        ]
                          .join(" ")
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    ) && <p>검색 결과가 없습니다.</p>}
                  </div>
                </>
              )}
              {entryTab === "직접입력" && (
                <div className="quote-manual-entry">
                  <h3>직접 품목 입력 · {section}</h3>
                  <div className="form-grid">
                    {(
                      ["materialCode", "name", "specification", "unit"] as const
                    ).map((k, n) => (
                      <label key={k}>
                        {["자재코드 (선택)", "품명", "규격", "단위"][n]}
                        <input
                          aria-label={`수동 ${k}`}
                          value={manual[k]}
                          onChange={(e) =>
                            setManual({ ...manual, [k]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      수량
                      <QuoteNumberInput
                        aria-label="수동 수량"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={manual.quantity}
                        onChange={(e) =>
                          setManual({
                            ...manual,
                            quantity: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      판매단가
                      <QuoteNumberInput
                        aria-label="수동 판매단가"
                        type="number"
                        min="0"
                        step="1"
                        value={manual.saleUnitPrice}
                        onChange={(e) =>
                          setManual({
                            ...manual,
                            saleUnitPrice: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={
                      !manual.name.trim() ||
                      !manual.unit.trim() ||
                      manual.quantity <= 0 ||
                      manual.saleUnitPrice < 0
                    }
                    onClick={() => {
                      onAdd(
                        [
                          {
                            ...manual,
                            trade: "소방시설",
                            priceCategory: "재료비",
                            materialUnitCost: 0,
                            laborUnitCost: 0,
                            expenseUnitCost: 0,
                            notes: "",
                            entrySources: ["manual"],
                          },
                        ],
                        section,
                      );
                      setManual({
                        materialCode: "",
                        name: "",
                        specification: "",
                        unit: "개",
                        quantity: 0,
                        saleUnitPrice: 0,
                      });
                    }}
                  >
                    수동 품목 추가
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
