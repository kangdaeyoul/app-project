"use client";
import { useEffect, useState } from "react";
import {
  StandardWork,
  QuoteItemInput,
  WorkSiteConditions,
  WorkPrice,
} from "@jongno/shared";
export default function StandardWorkQuick({
  autoPrice,
  onAdd,
}: {
  autoPrice: boolean;
  onAdd: (items: QuoteItemInput[], section: "기계" | "전기") => void;
}) {
  const [templates, setTemplates] = useState<StandardWork[]>([]),
    [prices, setPrices] = useState<WorkPrice[]>([]),
    [selected, setSelected] = useState(""),
    [qty, setQty] = useState(1),
    [lengths, setLengths] = useState({ 배선: 0, 배관: 0 }),
    [overrides, setOverrides] = useState<Record<string, number>>({}),
    [conditions, setConditions] = useState<WorkSiteConditions>({
      workType: "증설",
      installation: "노출",
      reuseWiring: false,
      reusePiping: false,
      reuseEquipment: false,
      ceiling: "일반",
      height: 3,
      night: false,
      demolition: true,
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/standard-work", { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("표준작업 조회 실패");
        return r.json();
      })
      .then((v) => {
        setTemplates(
          v.templates.filter((t: StandardWork) => t.active !== false),
        );
        setPrices(v.prices);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const choose = (t: StandardWork) => {
    setSelected(t.id);
    setQty(t.baseQuantity ?? 1);
    setOverrides({});
    setConditions((c) => ({
      ...c,
      workType:
        t.workType ??
        ["증설", "이설", "신설", "교체"].find((v) => t.name.endsWith(v)) ??
        "신설",
    }));
    setNotice("");
  };
  async function add(t: StandardWork) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/standard-work/${t.id}/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: selected === t.id ? qty : (t.baseQuantity ?? 1),
          lengths,
          reuse: [],
          overrides: selected === t.id ? overrides : {},
          autoPrice,
          conditions: {
            ...conditions,
            workType:
              selected === t.id
                ? conditions.workType
                : (t.workType ??
                  ["증설", "이설", "신설", "교체"].find((v) =>
                    t.name.endsWith(v),
                  ) ??
                  "신설"),
          },
        }),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.message || "표준작업 추가 실패");
      if (!v.items.length) throw Error("현장조건에 맞는 구성품이 없습니다.");
      onAdd(v.items, v.section);
      setNotice(`${t.name} 구성품 ${v.items.length}개를 견적에 추가했습니다.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const t = templates.find((t) => t.id === selected);
  return (
    <div className="standard-work-quick">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
      <p>
        작업명 버튼은 기본수량으로 즉시 추가합니다. 수량·현장조건을 바꾸려면
        설정을 선택하세요.
      </p>
      <div className="favorite-items">
        {templates.map((t) => (
          <div key={t.id}>
            <button
              type="button"
              disabled={busy}
              aria-label={`표준작업 즉시 추가 ${t.name}`}
              onClick={() => void add(t)}
            >
              {t.name}
            </button>
            <button
              type="button"
              aria-label={`${t.name} 조건 설정`}
              onClick={() => choose(t)}
            >
              설정
            </button>
          </div>
        ))}
      </div>
      {t && (
        <>
          <h3>
            {t.name} · {t.description}
          </h3>
          <div className="form-grid">
            <label>
              작업수량
              <input
                aria-label="세트 작업수량"
                type="number"
                min="0.001"
                step="0.001"
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
              />
            </label>
            <label>
              작업구분
              <select
                value={conditions.workType}
                onChange={(e) =>
                  setConditions({ ...conditions, workType: e.target.value })
                }
              >
                {["증설", "이설", "신설", "교체"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              노출 / 매립
              <select
                value={conditions.installation}
                onChange={(e) =>
                  setConditions({
                    ...conditions,
                    installation: e.target
                      .value as typeof conditions.installation,
                  })
                }
              >
                <option>노출</option>
                <option>매립</option>
              </select>
            </label>
            <label>
              천장 종류
              <input
                aria-label="세트 천장 종류"
                value={conditions.ceiling}
                onChange={(e) =>
                  setConditions({ ...conditions, ceiling: e.target.value })
                }
              />
            </label>
            <label>
              층고(m)
              <input
                aria-label="세트 층고"
                type="number"
                min="0"
                max="100"
                step="0.001"
                value={conditions.height}
                onChange={(e) =>
                  setConditions({
                    ...conditions,
                    height: Number(e.target.value),
                  })
                }
              />
            </label>
            {(["배선", "배관"] as const).map((k) => (
              <label key={k}>
                {k} 총길이 (0=기본)
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={lengths[k]}
                  onChange={(e) =>
                    setLengths({ ...lengths, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          {(
            [
              "reuseWiring",
              "reusePiping",
              "reuseEquipment",
              "night",
              "demolition",
            ] as const
          ).map((k, i) => (
            <label key={k} style={{ marginRight: 16 }}>
              <input
                type="checkbox"
                checked={conditions[k]}
                onChange={(e) =>
                  setConditions({ ...conditions, [k]: e.target.checked })
                }
              />
              {
                [
                  "기존 배선 활용",
                  "기존 배관 활용",
                  "기존 기구 재사용",
                  "야간작업",
                  "철거 포함 여부",
                ][i]
              }
            </label>
          ))}
          {t.components
            .filter((c) => c.mode === "관리자 직접입력")
            .map((c) => (
              <label key={c.id}>
                {prices.find((p) => p.id === c.priceId)?.name} 직접수량
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={overrides[c.id] ?? ""}
                  onChange={(e) =>
                    setOverrides({
                      ...overrides,
                      [c.id]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          <button type="button" disabled={busy} onClick={() => void add(t)}>
            조건 적용하여 세트 추가
          </button>
        </>
      )}
    </div>
  );
}
