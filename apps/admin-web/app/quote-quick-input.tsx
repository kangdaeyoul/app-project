"use client";
import { useEffect, useState } from "react";
import {
  WorkPrice,
  QuoteItemInput,
  QuoteFavorites,
  priceToQuoteItem,
} from "@jongno/shared";
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
  onAdd,
}: {
  autoPrice: boolean;
  onAdd: (items: QuoteItemInput[], section: "기계" | "전기") => void;
}) {
  const [prices, setPrices] = useState<WorkPrice[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [section, setSection] = useState<"기계" | "전기">("전기"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [defaultPrice, setDefaultPrice] = useState(true);
  const [manual, setManual] = useState({
    materialCode: "",
    name: "",
    specification: "",
    unit: "개",
    quantity: 1,
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
    setError('');try{const data=await api<{prices:WorkPrice[]}>('/standard-work');const latest=data.prices.find(v=>v.id===p.id);if(!latest)throw Error('품목을 다시 조회하세요.');setPrices(data.prices);onAdd([priceToQuoteItem(latest,autoPrice,source)],section);}catch(e){setError((e as Error).message);}
  }
  return (
    <section className="panel standard-work-panel">
      <h2>빠른 품목입력 · 자주 쓰는 품목</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label>
          추가할 을지
          <select
            aria-label="빠른입력 을지"
            value={section}
            onChange={(e) => setSection(e.target.value as typeof section)}
          >
            <option>전기</option>
            <option>기계</option>
          </select>
        </label>
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
                await api("/company/quote-preferences", { autoPrice: value });
                setDefaultPrice(value);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      <p>
        회사 기본값은 새 견적에 적용됩니다. 현재 견적과 기존 행의 수정단가는
        유지됩니다. 자동입력 OFF에서는 단가를 0원으로 추가하며 직접 입력할 수
        있습니다.
      </p>
      <h3>자주 쓰는 품목</h3>
      <div className="favorite-items">
        {ids.map((id, n) => {
          const p = prices.find((p) => p.id === id);
          if (!p) return null;
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
                onClick={() => void favorites(ids.filter((v) => v !== id))}
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
              .filter((p) =>
                [p.id, p.name, p.specification, p.unit]
                  .join(" ")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
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
                  <td>{p.salePrice.toLocaleString()}원</td>
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
        {!prices.some((p) =>
          [p.id, p.name, p.specification, p.unit]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
        ) && <p>검색 결과가 없습니다.</p>}
      </div>
      <details>
        <summary>직접 품목 입력</summary>
        <div className="form-grid">
          {(["materialCode", "name", "specification", "unit"] as const).map(
            (k, n) => (
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
            ),
          )}
          <label>
            수량
            <input
              aria-label="수동 수량"
              type="number"
              min="0.001"
              step="0.001"
              value={manual.quantity}
              onChange={(e) =>
                setManual({ ...manual, quantity: Number(e.target.value) })
              }
            />
          </label>
          <label>
            판매단가
            <input
              aria-label="수동 판매단가"
              type="number"
              min="0"
              step="1"
              value={manual.saleUnitPrice}
              onChange={(e) =>
                setManual({ ...manual, saleUnitPrice: Number(e.target.value) })
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
          onClick={() =>
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
            )
          }
        >
          수동 품목 추가
        </button>
      </details>
    </section>
  );
}
