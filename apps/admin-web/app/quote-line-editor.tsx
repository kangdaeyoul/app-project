"use client";
import GuidedNumberInput from "./quote-number-input";
import { useRef, useState, type ReactNode } from "react";
import {
  quoteLineAmount,
  type QuoteInput,
  type QuoteItemInput,
} from "@jongro/shared";
import QuoteNumberInput from "./quote-number-input";
type Kind = "전기" | "기계";
const blank = () => ({
  name: "",
  specification: "",
  quantity: "",
  unit: "개",
  materialUnitCost: "",
  laborUnitCost: "",
  expenseUnitCost: "",
  saleUnitPrice: "",
});
export default function QuoteLineEditor({
  form,
  disabled,
  onAdd,
  onChange,
  quickInput,
}: {
  form: QuoteInput;
  disabled: boolean;
  onAdd: (kind: Kind, items: QuoteItemInput[]) => void;
  onChange: (patch: Partial<QuoteInput>) => void;
  quickInput: (kind: Kind) => ReactNode;
}) {
  const [kind, setKind] = useState<Kind>("전기"),
    [direct, setDirect] = useState(false),
    [draft, setDraft] = useState(blank),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const update = (
    section: number,
    index: number,
    patch: Partial<QuoteItemInput>,
  ) =>
    onChange({
      sections: form.sections.map((s, n) =>
        n === section
          ? {
              ...s,
              items: s.items.map((item, i) =>
                i === index ? { ...item, ...patch } : item,
              ),
            }
          : s,
      ),
    });
  function add() {
    const quantity = Number(draft.quantity);
    const amounts = [
      draft.materialUnitCost,
      draft.laborUnitCost,
      draft.expenseUnitCost,
      draft.saleUnitPrice,
    ].map(Number);
    if (
      !draft.name.trim() ||
      !draft.unit.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000 ||
      amounts.some((v) => !Number.isSafeInteger(v) || v < 0)
    ) {
      setError("품명·단위와 0보다 큰 수량, 올바른 단가를 입력하세요.");
      return;
    }
    onAdd(kind, [
      {
        trade: kind === "전기" ? "소방전기" : "소방기계",
        name: draft.name.trim(),
        specification: draft.specification.trim(),
        quantity,
        unit: draft.unit.trim(),
        materialUnitCost: amounts[0],
        laborUnitCost: amounts[1],
        expenseUnitCost: amounts[2],
        saleUnitPrice: amounts[3],
        pricePending: draft.saleUnitPrice === "",
        priceCategory: "재료비",
        notes: "",
        entrySources: ["manual"],
      },
    ]);
    setNotice(`${draft.name} 추가 완료`);
    setDraft(blank());
    setError("");
    nameRef.current?.focus();
  }
  const count = form.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.name.trim()).length,
    0,
  );
  return (
    <div className="quote-live-editor">
      <fieldset
        disabled={disabled}
        className="quote-entry-single quote-fieldset"
      >
        <h3>품목 추가</h3>
        <div role="group" aria-label="품목 공종" className="quote-mode-picker">
          {(["전기", "기계"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k && !direct}
              onClick={() => {
                setKind(k);
                setDirect(false);
              }}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={direct}
            onClick={() => {
              setDirect(true);
              nameRef.current?.focus();
            }}
          >
            직접입력
          </button>
        </div>
        {!direct && quickInput(kind)}
        <div className="quote-single-fields">
          <label>
            품명
            <input
              ref={nameRef}
              aria-label="추가 품명"
              maxLength={300}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            규격
            <input
              aria-label="추가 규격"
              maxLength={300}
              value={draft.specification}
              onChange={(e) =>
                setDraft({ ...draft, specification: e.target.value })
              }
            />
          </label>
          <label>
            수량
            <GuidedNumberInput
              aria-label="추가 수량"
              type="number"
              inputMode="decimal"
              min="0.001"
              max="1000000"
              step="0.001"
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
            />
          </label>
          <label>
            단위
            <input
              aria-label="추가 단위"
              maxLength={30}
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            />
          </label>
          <label className="quote-single-sale">
            판매단가
            <GuidedNumberInput
              aria-label="추가 판매단가"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={draft.saleUnitPrice}
              onChange={(e) =>
                setDraft({ ...draft, saleUnitPrice: e.target.value })
              }
            />
          </label>
        </div>
        <details className="quote-single-costs">
          <summary>상세입력 · 내부 원가</summary>
          <div className="quote-single-fields">
            {(
              ["materialUnitCost", "laborUnitCost", "expenseUnitCost"] as const
            ).map((key, i) => (
              <label key={key}>
                {["재료비 단가", "노무비 단가", "경비 단가"][i]}
                <GuidedNumberInput
                  aria-label={`추가 ${["재료비 단가", "노무비 단가", "경비 단가"][i]}`}
                  type="number"
                  min="0"
                  step="1"
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <button
          type="button"
          className="primary-button quote-single-add"
          onClick={add}
        >
          견적표에 추가
        </button>
        {error && <p role="alert">{error}</p>}
        {notice && <small role="status">{notice}</small>}
      </fieldset>
      <section className="quote-current-lines" aria-label="현재 견적표">
        <h3>
          현재 견적표 <small>{count}개 품목</small>
        </h3>
        <p>추가한 품목만 표시됩니다. 수량·단가를 바로 수정하세요.</p>
        <div className="quote-lines-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "공종 / 품명",
                  "규격",
                  "수량",
                  "단위",
                  "판매단가",
                  "금액",
                  "편집",
                ].map((v) => (
                  <th key={v}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.sections.flatMap((s, n) =>
                s.items.map((item, i) =>
                  item.name.trim() ? (
                    <tr key={`${n}-${i}`}>
                      <td>
                        <small>{s.kind}</small>
                        <strong>{item.name}</strong>
                      </td>
                      <td>{item.specification || "—"}</td>
                      <td>
                        <QuoteNumberInput
                          aria-label={`${item.name} 수량`}
                          value={item.quantity}
                          min={0.001}
                          max={1000000}
                          step={0.001}
                          disabled={disabled}
                          onValue={(quantity) =>
                            update(n, i, {
                              quantity,
                              quantityPending: false,
                              manualQuantity: true,
                            })
                          }
                        />
                      </td>
                      <td>{item.unit}</td>
                      <td>
                        <QuoteNumberInput
                          aria-label={`${item.name} 판매단가`}
                          value={item.saleUnitPrice}
                          min={0}
                          step={1}
                          disabled={disabled}
                          onValue={(saleUnitPrice) =>
                            update(n, i, { saleUnitPrice, pricePending: false })
                          }
                        />
                      </td>
                      <td>
                        {(() => {
                          try {
                            return (
                              quoteLineAmount(
                                item.quantity,
                                item.saleUnitPrice,
                              ).toLocaleString("ko-KR") + "원"
                            );
                          } catch {
                            return "범위 확인";
                          }
                        })()}
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={`${item.name} 삭제`}
                          onClick={() => {
                            if (
                              confirm(
                                `${item.name}을 견적표에서 삭제하시겠습니까?`,
                              )
                            )
                              onChange({
                                sections: form.sections.map((v, k) =>
                                  k === n
                                    ? {
                                        ...v,
                                        items: v.items.filter(
                                          (_, j) => j !== i,
                                        ),
                                      }
                                    : v,
                                ),
                              });
                          }}
                        >
                          삭제
                        </button>
                        <details>
                          <summary>상세</summary>
                          <div className="quote-line-more">
                            {(
                              [
                                "trade",
                                "name",
                                "specification",
                                "unit",
                                "notes",
                              ] as const
                            ).map((key, j) => (
                              <label key={key}>
                                {["공종", "품명", "규격", "단위", "비고"][j]}
                                <input
                                  defaultValue={item[key]}
                                  disabled={disabled}
                                  onBlur={(e) =>
                                    update(n, i, { [key]: e.target.value })
                                  }
                                />
                              </label>
                            ))}
                            {(
                              [
                                "materialUnitCost",
                                "laborUnitCost",
                                "expenseUnitCost",
                              ] as const
                            ).map((key, j) => (
                              <label key={key}>
                                {["재료비 단가", "노무비 단가", "경비 단가"][j]}
                                <QuoteNumberInput
                                  value={item[key]}
                                  min={0}
                                  step={1}
                                  disabled={disabled}
                                  onValue={(v) => update(n, i, { [key]: v })}
                                />
                              </label>
                            ))}
                            <label>
                              금액 분류
                              <select
                                value={item.priceCategory}
                                disabled={disabled}
                                onChange={(e) =>
                                  update(n, i, {
                                    priceCategory: e.target
                                      .value as QuoteItemInput["priceCategory"],
                                  })
                                }
                              >
                                {["재료비", "노무비", "경비"].map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </select>
                            </label>
                            {item.calculationBasis && (
                              <small>계산근거: {item.calculationBasis}</small>
                            )}
                            {item.autoGenerated && (
                              <small>자동추가된 구성품</small>
                            )}
                            {item.manualQuantity && (
                              <small>수동 수정 수량</small>
                            )}
                            {item.reviewNotice && (
                              <small>{item.reviewNotice}</small>
                            )}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ) : null,
                ),
              )}
            </tbody>
          </table>
          {!count && <p className="empty">첫 품목을 추가해 보세요.</p>}
        </div>
      </section>
    </div>
  );
}
