"use client";
import WorkCalculationEditor from "./work-calculation-editor";
import WorkConditionsEditor from "./work-conditions-editor";
import { useEffect, useState } from "react";
import {
  WorkPrice,
  StandardWork,
  QuoteItemInput,
  WORK_COMPONENT_ROLES,
  WORK_QUANTITY_MODES,
  WORK_REUSE_FLAGS,
} from "@jongno/shared";
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const r = await fetch(
    "/api/standard-work" + path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const v = await r.json();
  if (!r.ok) throw Error(v.message || "요청 실패");
  return v;
}
export default function StandardWorkPanel({
  onAdd,
}: {
  onAdd?: (section: "기계" | "전기", items: QuoteItemInput[]) => void;
}) {
  const [data, setData] = useState<{
      prices: WorkPrice[];
      templates: StandardWork[];
    }>({ prices: [], templates: [] }),
    [template, setTemplate] = useState<StandardWork | null>(null),
    [overrides, setOverrides] = useState<Record<string, number>>({}),
    [quantity, setQuantity] = useState(5),
    [lengths, setLengths] = useState({ 배선: 0, 배관: 0 }),
    [reuse, setReuse] = useState<string[]>([]),
    [items, setItems] = useState<QuoteItemInput[]>([]),
    [history, setHistory] = useState<StandardWork[]>([]),
    [price, setPrice] = useState<WorkPrice | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false);
  const refresh = async () => {
    const v = await api<typeof data>("");
    setData(v);
    return v;
  };
  useEffect(() => {
    let active = true;
    api<typeof data>("")
      .then((v) => {
        if (active) {
          setData(v);
          setTemplate(v.templates[0] ?? null);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel standard-work-panel">
      <div className="panel-title">
        <h2>표준작업 구성품 · 자재단가</h2>
        <button type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "접기" : "열기"}
        </button>
      </div>
      {expanded && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api<{
                  templateCount: number;
                  materialCount: number;
                }>("/initialize-defaults", {});
                await refresh();
                setNotice(
                  `기본 작업 ${result.templateCount}개, 자재 ${result.materialCount}개 등록 · 기존 설정과 삭제 이력 유지`,
                );
              })
            }
          >
            기본 표준작업 등록 (중복 방지)
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <p>
            샘플 기준값입니다. 실제 현장 조건에 맞춰 수량과 단가를 확인하세요.
            고객용 묶음 출력은 견적 작성 화면에서 선택합니다.
          </p>
          <div className="worker-actions">
            <button
              type="button"
              disabled={busy || !data.prices.length}
              onClick={() => {
                setItems([]);
                setHistory([]);
                setTemplate({
                  id: "",
                  companyId: "",
                  name: "새 작업세트",
                  section: "전기",
                  workType: "증설",
                  description: "",
                  baseQuantity: 1,
                  unit: "개",
                  calculation: "구성품별 계산",
                  conditions: [],
                  active: true,
                  version: 1,
                  reason: "새 작업세트 등록",
                  updatedAt: "",
                  updatedBy: "",
                  components: [
                    {
                      id: crypto.randomUUID(),
                      priceId: data.prices[0].id,
                      role: "주자재",
                      mode: "작업수량에 비례",
                      factor: 1,
                      lengthKey: "배선",
                      omitWhen: [],
                      customerGroup: "",
                    },
                  ],
                });
              }}
            >
              작업세트 추가
            </button>
            <button
              type="button"
              disabled={busy || !template?.id}
              onClick={() =>
                run(async () => {
                  const copied = await api<StandardWork>(
                    `/${template!.id}/copy`,
                    {},
                    "POST",
                  );
                  await refresh();
                  setTemplate(copied);
                  setItems([]);
                  setHistory([]);
                  setNotice("작업세트를 복사했습니다.");
                })
              }
            >
              작업세트 복사
            </button>
            <button
              type="button"
              disabled={busy || !template?.id}
              onClick={() => {
                if (
                  window.confirm(
                    "작업세트를 삭제할까요? 기존 견적과 버전 이력은 보존됩니다.",
                  )
                )
                  void run(async () => {
                    await api(`/${template!.id}`, {}, "DELETE");
                    const d = await refresh();
                    setTemplate(d.templates[0] ?? null);
                    setItems([]);
                    setHistory([]);
                    setNotice("작업세트를 삭제했습니다.");
                  });
              }}
            >
              작업세트 삭제
            </button>
          </div>
          <div className="form-grid">
            <label>
              표준작업
              <select
                value={template?.id ?? ""}
                onChange={(e) => {
                  setTemplate(
                    structuredClone(
                      data.templates.find((t) => t.id === e.target.value)!,
                    ),
                  );
                  setQuantity(
                    data.templates.find((t) => t.id === e.target.value)
                      ?.baseQuantity ?? 1,
                  );
                  setItems([]);
                  setHistory([]);
                  setReuse([]);
                  setOverrides({});
                }}
              >
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · v{t.version}
                    {t.active === false ? " (비활성)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              작업수량
              <input
                aria-label="작업수량"
                type="number"
                min="0.001"
                step="0.001"
                value={quantity}
                onChange={(e) => {
                  setQuantity(Number(e.target.value));
                  setItems([]);
                }}
              />
            </label>
            {(["배선", "배관"] as const).map((k) => (
              <label key={k}>
                {k} 총길이(m, 0=기본값)
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={lengths[k]}
                  onChange={(e) => {
                    setLengths({ ...lengths, [k]: Number(e.target.value) });
                    setItems([]);
                  }}
                />
              </label>
            ))}
          </div>
          <div>
            {WORK_REUSE_FLAGS.map((f) => (
              <label key={f} style={{ marginRight: 16 }}>
                <input
                  type="checkbox"
                  checked={reuse.includes(f)}
                  onChange={(e) => {
                    setReuse(
                      e.target.checked
                        ? [...reuse, f]
                        : reuse.filter((x) => x !== f),
                    );
                    setItems([]);
                  }}
                />
                {f}
              </label>
            ))}
          </div>
          {template?.components
            .filter((c) => c.mode === "관리자 직접입력")
            .map((c) => (
              <label key={c.id}>
                {data.prices.find((p) => p.id === c.priceId)?.name} 직접 수량
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={overrides[c.id] ?? ""}
                  onChange={(e) => {
                    setOverrides({
                      ...overrides,
                      [c.id]: Number(e.target.value),
                    });
                    setItems([]);
                  }}
                />
              </label>
            ))}
          <button
            type="button"
            disabled={busy || !template?.id || template.active === false}
            onClick={() =>
              run(async () => {
                const v = await api<{ items: QuoteItemInput[] }>(
                  `/${template!.id}/calculate`,
                  { quantity, lengths, reuse, overrides },
                );
                setItems(v.items);
              })
            }
          >
            구성품 자동 계산
          </button>
          {items.length > 0 && (
            <>
              <h3>내부 세부 구성품 (수량·단가 수정 가능)</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>품명</th>
                      <th>규격</th>
                      <th>수량</th>
                      <th>단위</th>
                      <th>내부 단가</th>
                      <th>판매 단가</th>
                      <th>고객 묶음</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i, n) => (
                      <tr key={n}>
                        <td>{i.name}</td>
                        <td>{i.specification}</td>
                        <td>
                          <input
                            aria-label={`${i.name} 수량`}
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={i.quantity}
                            onChange={(e) =>
                              setItems(
                                items.map((v, j) =>
                                  j === n
                                    ? { ...v, quantity: Number(e.target.value) }
                                    : v,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>{i.unit}</td>
                        <td>
                          <input
                            aria-label={`${i.name} 내부 단가`}
                            type="number"
                            min="0"
                            value={
                              i.materialUnitCost +
                              i.laborUnitCost +
                              i.expenseUnitCost
                            }
                            onChange={(e) =>
                              setItems(
                                items.map((v, j) =>
                                  j === n
                                    ? {
                                        ...v,
                                        [i.priceCategory === "재료비"
                                          ? "materialUnitCost"
                                          : i.priceCategory === "노무비"
                                            ? "laborUnitCost"
                                            : "expenseUnitCost"]: Number(
                                          e.target.value,
                                        ),
                                      }
                                    : v,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${i.name} 판매 단가`}
                            type="number"
                            min="0"
                            value={i.saleUnitPrice}
                            onChange={(e) =>
                              setItems(
                                items.map((v, j) =>
                                  j === n
                                    ? {
                                        ...v,
                                        saleUnitPrice: Number(e.target.value),
                                      }
                                    : v,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>{i.customerGroup || "개별 표시"}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              setItems(items.filter((_, j) => j !== n))
                            }
                          >
                            제외
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {onAdd ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onAdd(template!.section, items);
                    setItems([]);
                    setNotice("견적 을지에 세부 구성품을 추가했습니다.");
                  }}
                >
                  견적에 구성품 추가
                </button>
              ) : (
                <p>
                  새 견적 또는 견적 수정 화면에서 구성품을 추가할 수 있습니다.
                </p>
              )}
            </>
          )}
          {template && (
            <details open={template.id === "" ? true : undefined}>
              <summary>관리자 템플릿 수정 · 버전 이력</summary>
              <p>
                수량 비례=작업수량×기준값, 길이=총길이 입력 또는
                작업수량×기준길이, 고정=기준값, 1식=1. 템플릿 변경 후에는 새
                버전을 저장해야 계산에 적용됩니다. 직접입력 항목은 자동 계산
                버튼 위에서 수량을 입력합니다.
              </p>
              <label>
                템플릿명
                <input
                  value={template.name}
                  onChange={(e) =>
                    setTemplate({ ...template, name: e.target.value })
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  공종
                  <select
                    aria-label="세트 공종"
                    value={template.section}
                    onChange={(e) =>
                      setTemplate({
                        ...template,
                        section: e.target.value as typeof template.section,
                      })
                    }
                  >
                    <option>전기</option>
                    <option>기계</option>
                  </select>
                </label>
                <label>
                  작업구분
                  <input
                    aria-label="세트 작업구분"
                    value={template.workType ?? "신설"}
                    onChange={(e) =>
                      setTemplate({ ...template, workType: e.target.value })
                    }
                  />
                </label>
                <label>
                  설명
                  <input
                    aria-label="세트 설명"
                    value={template.description ?? ""}
                    onChange={(e) =>
                      setTemplate({ ...template, description: e.target.value })
                    }
                  />
                </label>
                <label>
                  기본수량
                  <input
                    aria-label="세트 기본수량"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={template.baseQuantity ?? 1}
                    onChange={(e) =>
                      setTemplate({
                        ...template,
                        baseQuantity: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  세트 단위
                  <input
                    aria-label="세트 단위"
                    value={template.unit ?? "개"}
                    onChange={(e) =>
                      setTemplate({ ...template, unit: e.target.value })
                    }
                  />
                </label>
                <label>
                  검토 상태
                  <select
                    aria-label="세트 검토 상태"
                    value={template.reviewStatus ?? "검토필요"}
                    onChange={(e) =>
                      setTemplate({
                        ...template,
                        reviewStatus: e.target.value as "검토필요" | "사용승인",
                      })
                    }
                  >
                    <option>검토필요</option>
                    <option>사용승인</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={template.integrated ?? false}
                    onChange={(e) =>
                      setTemplate({ ...template, integrated: e.target.checked })
                    }
                  />
                  현장산출 계산 사용
                </label>
                <label>
                  세트 계산방식
                  <input
                    aria-label="세트 계산방식"
                    readOnly
                    value="구성품별 계산"
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={template.active ?? true}
                    onChange={(e) =>
                      setTemplate({ ...template, active: e.target.checked })
                    }
                  />
                  세트 활성
                </label>
              </div>
              <p>
                적용조건과 포함조건은 모두 일치할 때 적용합니다. 제외조건은
                하나라도 일치하면 제외합니다.
              </p>
              <WorkConditionsEditor
                label="세트 적용조건"
                value={template.conditions ?? []}
                onChange={(v) => setTemplate({ ...template, conditions: v })}
              />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>단가 품목</th>
                      <th>구성 구분</th>
                      <th>계산방식</th>
                      <th>기준값</th>
                      <th>길이 구분</th>
                      <th>재사용 시 제외</th>
                      <th>고객 묶음명</th>
                      <th>구성품 조건</th>
                      <th>순서</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {template.components.map((c, n) => {
                      const patch = (v: Partial<typeof c>) => {
                        setTemplate({
                          ...template,
                          components: template.components.map((x, j) =>
                            j === n ? { ...x, ...v } : x,
                          ),
                        });
                        setItems([]);
                      };
                      return (
                        <tr key={c.id}>
                          <td>
                            <select
                              value={c.priceId}
                              onChange={(e) =>
                                patch({
                                  priceId: e.target.value,
                                  ...(c.defaultVariant && c.variants
                                    ? {
                                        variants: {
                                          ...c.variants,
                                          [c.defaultVariant]: e.target.value,
                                        },
                                      }
                                    : {}),
                                })
                              }
                            >
                              {data.prices.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} / {p.specification} / {p.unit}
                                  {p.priceRegistered === false
                                    ? " · 단가 미등록"
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={c.role}
                              onChange={(e) =>
                                patch({ role: e.target.value as typeof c.role })
                              }
                            >
                              {WORK_COMPONENT_ROLES.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {template.integrated && (
                              <WorkCalculationEditor
                                component={c}
                                prices={data.prices}
                                onChange={patch}
                              />
                            )}
                            <select
                              disabled={template.integrated}
                              title={
                                template.integrated
                                  ? "산출·규격 연결 설정에서 실제 계산방식을 변경하세요."
                                  : undefined
                              }
                              value={c.mode}
                              onChange={(e) =>
                                patch({ mode: e.target.value as typeof c.mode })
                              }
                            >
                              {WORK_QUANTITY_MODES.filter(
                                (v) =>
                                  template.integrated ||
                                  [
                                    "작업수량에 비례",
                                    "고정수량",
                                    "길이기준",
                                    "1식",
                                    "관리자 직접입력",
                                  ].includes(v),
                              ).map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={c.factor}
                              onChange={(e) =>
                                patch({
                                  factor: Number(e.target.value),
                                  ...(c.quantityRule
                                    ? {
                                        quantityRule: {
                                          ...c.quantityRule,
                                          factor: Number(e.target.value),
                                        },
                                      }
                                    : {}),
                                })
                              }
                            />
                          </td>
                          <td>
                            <select
                              value={c.lengthKey}
                              onChange={(e) =>
                                patch({
                                  lengthKey: e.target
                                    .value as typeof c.lengthKey,
                                })
                              }
                            >
                              <option>배선</option>
                              <option>배관</option>
                            </select>
                          </td>
                          <td>
                            {WORK_REUSE_FLAGS.map((f) => (
                              <label key={f}>
                                <input
                                  type="checkbox"
                                  checked={c.omitWhen.includes(f)}
                                  onChange={(e) =>
                                    patch({
                                      omitWhen: e.target.checked
                                        ? [...c.omitWhen, f]
                                        : c.omitWhen.filter((x) => x !== f),
                                    })
                                  }
                                />
                                {f}
                              </label>
                            ))}
                          </td>
                          <td>
                            <input
                              value={c.customerGroup}
                              onChange={(e) =>
                                patch({ customerGroup: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <WorkConditionsEditor
                              label={`${n + 1}번 포함조건`}
                              value={c.includeWhen ?? []}
                              onChange={(v) => patch({ includeWhen: v })}
                            />
                            <WorkConditionsEditor
                              label={`${n + 1}번 제외조건`}
                              value={c.excludeWhen ?? []}
                              onChange={(v) => patch({ excludeWhen: v })}
                            />
                          </td>
                          <td>
                            {[-1, 1].map((offset) => (
                              <button
                                key={offset}
                                type="button"
                                aria-label={`${n + 1}번 구성품 ${offset < 0 ? "위로" : "아래로"}`}
                                disabled={
                                  n + offset < 0 ||
                                  n + offset >= template.components.length
                                }
                                onClick={() => {
                                  const next = [...template.components];
                                  [next[n], next[n + offset]] = [
                                    next[n + offset],
                                    next[n],
                                  ];
                                  setTemplate({
                                    ...template,
                                    components: next,
                                  });
                                  setItems([]);
                                }}
                              >
                                {offset < 0 ? "↑" : "↓"}
                              </button>
                            ))}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                setTemplate({
                                  ...template,
                                  components: template.components.filter(
                                    (_, j) => j !== n,
                                  ),
                                })
                              }
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() =>
                  setTemplate({
                    ...template,
                    components: [
                      ...template.components,
                      {
                        id: crypto.randomUUID(),
                        priceId: data.prices[0].id,
                        role: "기타",
                        mode: "고정수량",
                        factor: 1,
                        lengthKey: "배선",
                        omitWhen: [],
                        customerGroup: "",
                      },
                    ],
                  })
                }
              >
                구성품 추가
              </button>
              <label>
                변경 사유
                <input
                  value={template.reason}
                  onChange={(e) =>
                    setTemplate({ ...template, reason: e.target.value })
                  }
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { companyId: _companyId, ...body } = template;
                    const saved = await api<StandardWork>(
                      template.id ? `/${template.id}` : "",
                      body,
                      template.id ? "PUT" : "POST",
                    );
                    const d = await refresh();
                    setTemplate(d.templates.find((t) => t.id === saved.id)!);
                    setItems([]);
                    setNotice(
                      "새 템플릿 버전을 저장했습니다. 기존 견적은 유지됩니다.",
                    );
                  })
                }
              >
                템플릿 새 버전 저장
              </button>
              <button
                type="button"
                onClick={() =>
                  run(async () =>
                    setHistory(await api(`/${template.id}/history`)),
                  )
                }
              >
                버전 이력 조회
              </button>
              {history.map((h) => (
                <p key={h.version}>
                  v{h.version} · {h.updatedAt} · {h.updatedBy} · {h.reason} ·{" "}
                  {h.components.length}개 구성품
                </p>
              ))}
            </details>
          )}
          <details>
            <summary>자재·노무 단가 DB 관리</summary>
            <select
              aria-label="단가 품목 선택"
              value={price?.id ?? ""}
              onChange={(e) =>
                setPrice(
                  structuredClone(
                    data.prices.find((p) => p.id === e.target.value) ?? null,
                  ),
                )
              }
            >
              <option value="">품목 선택</option>
              {data.prices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.unit}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                setPrice({
                  id: "",
                  companyId: "",
                  name: "",
                  specification: "",
                  unit: "개",
                  category: "재료비",
                  cost: 0,
                  salePrice: 0,
                })
              }
            >
              새 단가 품목
            </button>
            {price && (
              <div className="form-grid">
                {(["name", "specification", "unit"] as const).map((k, n) => (
                  <label key={k}>
                    {["품명", "규격", "단위"][n]}
                    <input
                      value={price[k]}
                      onChange={(e) =>
                        setPrice({ ...price, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  분류
                  <select
                    value={price.category}
                    onChange={(e) =>
                      setPrice({
                        ...price,
                        category: e.target.value as WorkPrice["category"],
                      })
                    }
                  >
                    <option>재료비</option>
                    <option>노무비</option>
                    <option>경비</option>
                  </select>
                </label>
                {(["cost", "salePrice"] as const).map((k, n) => (
                  <label key={k}>
                    {["내부 원가", "고객 판매단가"][n]}
                    <input
                      type="number"
                      min="0"
                      value={price[k]}
                      onChange={(e) =>
                        setPrice({ ...price, [k]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const { companyId: _companyId, ...body } = price;
                      const saved = await api<WorkPrice>(
                        price.id ? `/prices/${price.id}` : "/prices",
                        body,
                        price.id ? "PUT" : "POST",
                      );
                      await refresh();
                      setPrice(saved);
                      setItems([]);
                      setNotice(
                        "단가를 저장했습니다. 기존 견적 단가는 유지됩니다.",
                      );
                    })
                  }
                >
                  단가 저장
                </button>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
