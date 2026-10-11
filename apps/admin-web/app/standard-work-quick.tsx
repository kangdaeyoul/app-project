"use client";
import { useEffect, useRef, useState } from "react";
import {
  StandardWork,
  QuoteItemInput,
  WorkEstimateOptions,
  WorkSiteConditions,
} from "@jongro/shared";
type Task = { id: string; templateId: string; quantity: number; route: string };
type Section = { kind: "기계" | "전기"; items: QuoteItemInput[] };
const numericFields: [keyof WorkEstimateOptions, string][] = [
  ["routeLength", "배선 경로길이(m)"],
  ["wireStrands", "전선 가닥 수"],
  ["wireSlack", "전선 여유분(m)"],
  ["wireLength", "전선 직접 산출길이(m)"],
  ["conduitLength", "전선관 길이(m)"],
  ["pipeLength", "소방배관 길이(m)"],
  ["locations", "설치 개소"],
  ["connections", "접속 개소"],
  ["couplings", "연결 개소"],
  ["fixingInterval", "고정 간격(m)"],
  ["fixingPoints", "고정 개소 직접입력"],
  ["screwsPerFixing", "고정 개소당 피스 수"],
  ["anchorsPerFixing", "고정 개소당 앵커 수"],
  ["circuits", "수신반 회로수"],
  ["people", "투입 인원"],
  ["days", "작업일수"],
];
const selects: [keyof WorkEstimateOptions, string, string[]][] = [
  ["detectorSpec", "감지기 종류", ["연기식", "차동식", "정온식"]],
  [
    "wireSpec",
    "전선 규격",
    ["HFIX 1.5SQ", "HFIX 2.5SQ", "제어선 / 회로별 선정"],
  ],
  ["conduitType", "전선관 종류", ["강재", "SF", "GW"]],
  ["conduitSize", "전선관 규격", ["16mm", "22mm", "28mm", "36mm"]],
  ["headOrientation", "헤드 방향", ["상향식", "하향식"]],
  ["pipeType", "소방배관 종류", ["백관", "CPVC", "동관"]],
  ["pipeSize", "배관 규격", ["25A", "32A", "40A", "50A", "65A", "80A", "100A"]],
  ["jointMethod", "접합방식", ["나사식", "그루빙", "용접식", "CPVC"]],
  ["receiverType", "수신반 형식", ["P형", "R형", "복합"]],
  ["kitMode", "발신기세트 구성", ["individual", "complete"]],
  ["miscMode", "잡자재 입력", ["bundle", "detail"]],
];
export default function StandardWorkQuick({
  autoPrice,
  section,
  allTrades,
  onAllTradesChange,
  onAdd,
}: {
  autoPrice: boolean;
  section: "기계" | "전기";
  allTrades: boolean;
  onAllTradesChange: (value: boolean) => void;
  onAdd: (items: QuoteItemInput[], section: "기계" | "전기") => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState(false),
    [accessories, setAccessories] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const generation = useRef(0);
  const [templates, setTemplates] = useState<StandardWork[]>([]),
    [search, setSearch] = useState(""),
    [tasks, setTasks] = useState<Task[]>([]),
    [options, setOptions] = useState<WorkEstimateOptions>({
      detectorSpec: "연기식",
      wireSpec: "HFIX 1.5SQ",
      conduitType: "강재",
      conduitSize: "16mm",
      headOrientation: "상향식",
      pipeType: "백관",
      pipeSize: "25A",
      jointMethod: "나사식",
      receiverType: "P형",
      kitMode: "individual",
      miscMode: "bundle",
    }),
    [routes, setRoutes] = useState<
      { id: string; options: WorkEstimateOptions }[]
    >([]),
    [batch, setBatch] = useState("현장 공통"),
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
    [preview, setPreview] = useState<Section[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
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
      .then((v) =>
        setTemplates(
          v.templates.filter((t: StandardWork) => t.active !== false),
        ),
      )
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    generation.current++;
    setBusy(false);
    setPreview([]);
  }, [autoPrice]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const invalidate = () => {
    generation.current++;
    setBusy(false);
    setPreview([]);
    setNotice("");
  };
  const patch = (key: keyof WorkEstimateOptions, value: unknown) => {
    invalidate();
    setOptions((o) => {
      const next = { ...o, [key]: value };
      if (value === undefined) delete next[key];
      if (key === "pipeType")
        next.jointMethod =
          value === "CPVC" ? "CPVC" : value === "동관" ? "용접식" : "나사식";
      return next;
    });
  };
  async function calculate(selectedTasks = tasks) {
    const requestId = ++generation.current;
    setExcluded(new Set());
    setBusy(true);
    setError("");
    setPreview([]);
    try {
      const r = await fetch("/api/standard-work/composite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: batch,
          autoPrice,
          routes,
          tasks: selectedTasks.map((t) => ({
            id: t.id,
            templateId: t.templateId,
            request: {
              quantity: t.quantity,
              lengths: { 배선: 0, 배관: 0 },
              reuse: [],
              overrides: {},
              conditions: {
                ...conditions,
                workType:
                  templates.find((x) => x.id === t.templateId)?.workType ??
                  "신설",
              },
              estimate: {
                ...options,
                ...(t.route ? { routeGroup: t.route } : {}),
              },
            },
          })),
        }),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.message || "구성품 계산 실패");
      if (requestId !== generation.current) return;
      setPreview(v.sections);
      setWarnings(v.warnings || []);
    } catch (e) {
      if (requestId === generation.current) setError((e as Error).message);
    } finally {
      if (requestId === generation.current) setBusy(false);
    }
  }
  const edit = (s: number, n: number, p: Partial<QuoteItemInput>) =>
    setPreview((v) =>
      v.map((section, j) =>
        j === s
          ? {
              ...section,
              items: section.items.map((item, i) =>
                i === n ? { ...item, ...p } : item,
              ),
            }
          : section,
      ),
    );
  const isAccessory = (item: QuoteItemInput) => {
    const source = item.standardSource ?? item.standardSources?.[0];
    const component =
      source &&
      templates
        .find((t) => t.id === source.templateId)
        ?.components.find((c) => c.id === source.componentId);
    return component
      ? [
          "부속자재",
          "배선",
          "전선",
          "전선관",
          "배관",
          "배관부속",
          "잡자재",
          "기타",
        ].includes(component.role)
      : !!item.customerGroup &&
          /부속|잡자재|배관|배선/.test(item.customerGroup);
  };
  return (
    <div
      className={`standard-work-quick ${detail ? "composition-detail" : "composition-simple"} ${tasks.length ? "has-selection" : ""} ${searchOpen ? "search-open" : ""}`}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="quote-compose-grid">
        <div className="quote-search-pane">
          <div
            className="quote-mode-picker"
            role="group"
            aria-label="입력 모드"
          >
            <button
              type="button"
              aria-pressed={!detail}
              onClick={() => setDetail(false)}
            >
              간편모드
            </button>
            <button
              type="button"
              aria-pressed={detail}
              onClick={() => setDetail(true)}
            >
              상세모드
            </button>
          </div>
          <p className="quote-review-notice">
            예시수량 · 현장확인 필요. 미등록 단가는 직접 입력하세요.
          </p>

          {tasks.length > 0 && (
            <button
              type="button"
              className="quote-search-toggle"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              작업 추가·변경 {searchOpen ? "▲" : "▼"}
            </button>
          )}
          <div className="quote-search-fields">
            <label className="quote-all-trades">
              <input
                type="checkbox"
                checked={allTrades}
                onChange={(e) => onAllTradesChange(e.target.checked)}
              />
              전체 공종 검색
            </label>
            <label>
              표준작업 검색
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="작업명 또는 공종"
              />
            </label>
            <div
              className="favorite-items"
              style={{ maxHeight: 220, overflowY: "auto" }}
            >
              {templates
                .filter(
                  (t) =>
                    (allTrades || t.section === section) &&
                    (t.name + t.section)
                      .replaceAll(" ", "")
                      .includes(search.replaceAll(" ", "")),
                )
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={`표준작업 선택 ${t.name}`}
                    onClick={() => {
                      invalidate();
                      const next = [
                        ...tasks,
                        {
                          id: crypto.randomUUID(),
                          templateId: t.id,
                          quantity: t.baseQuantity ?? 1,
                          route: "",
                        },
                      ];
                      setTasks(next);
                      setSearchOpen(false);
                      void calculate(next);
                    }}
                  >
                    {t.name} · {t.reviewStatus ?? "검토필요"}
                  </button>
                ))}
            </div>
          </div>
        </div>
        <div className="quote-review-pane">
          {!tasks.length && (
            <p className="empty">
              왼쪽에서 작업을 선택하세요. 구성품이 여기에 바로 표시됩니다.
            </p>
          )}
          {tasks.length > 0 && (
            <>
              <h3>선택한 작업</h3>
              <div className="table-scroll quote-selected-tasks">
                <table>
                  <thead>
                    <tr>
                      <th>작업명</th>
                      <th>작업수량</th>
                      <th>공유 경로</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t, n) => (
                      <tr key={t.id}>
                        <td>
                          {templates.find((x) => x.id === t.templateId)?.name}
                        </td>
                        <td>
                          <input
                            aria-label={`작업 ${n + 1} 수량`}
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={t.quantity}
                            onChange={(e) => {
                              invalidate();
                              setTasks((v) =>
                                v.map((x) =>
                                  x.id === t.id
                                    ? { ...x, quantity: Number(e.target.value) }
                                    : x,
                                ),
                              );
                            }}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`작업 ${n + 1} 공유 경로`}
                            value={t.route}
                            onChange={(e) => {
                              invalidate();
                              setTasks((v) =>
                                v.map((x) =>
                                  x.id === t.id
                                    ? { ...x, route: e.target.value }
                                    : x,
                                ),
                              );
                            }}
                          >
                            <option value="">독립 경로</option>
                            {routes.map((r) => (
                              <option key={r.id}>{r.id}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => {
                              invalidate();
                              setTasks((v) => v.filter((x) => x.id !== t.id));
                            }}
                          >
                            작업 제거
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="quote-essential-fields form-grid">
                {selects
                  .filter(([key]) => {
                    const names = tasks
                      .map(
                        (t) =>
                          templates.find((x) => x.id === t.templateId)?.name ??
                          "",
                      )
                      .join(" ");
                    return section === "전기"
                      ? (key === "detectorSpec" && names.includes("감지기")) ||
                          (key === "kitMode" && names.includes("발신기세트")) ||
                          (key === "receiverType" && names.includes("수신반"))
                      : key === "pipeSize" ||
                          (key === "headOrientation" && names.includes("헤드"));
                  })
                  .map(([key, label, values]) => (
                    <label key={key}>
                      {label}
                      <select
                        aria-label={`간편 ${label}`}
                        value={String(options[key] ?? values[0])}
                        onChange={(e) => patch(key, e.target.value)}
                      >
                        {values.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                {(section === "전기"
                  ? numericFields.filter(([k]) =>
                      ["routeLength", "conduitLength"].includes(k),
                    )
                  : numericFields.filter(([k]) => k === "pipeLength")
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      aria-label={`간편 ${label}`}
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="현장산출 필요"
                      value={
                        options[key] === undefined ? "" : Number(options[key])
                      }
                      onChange={(e) =>
                        patch(
                          key,
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <details className="quote-settings">
                <summary>시공조건 · 세부 산출 · 공유 경로</summary>
                <div className="form-grid">
                  <label>
                    작업묶음
                    <input
                      value={batch}
                      onChange={(e) => {
                        invalidate();
                        setBatch(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    시공방법
                    <select
                      aria-label="시공방법"
                      value={
                        options.concealed
                          ? "천장 내부 은폐시공"
                          : options.wallEmbedded
                            ? "벽체 매립시공"
                            : "노출시공"
                      }
                      onChange={(e) => {
                        invalidate();
                        setOptions((o) => ({
                          ...o,
                          concealed: e.target.value === "천장 내부 은폐시공",
                          wallEmbedded: e.target.value === "벽체 매립시공",
                        }));
                      }}
                    >
                      {["노출시공", "천장 내부 은폐시공", "벽체 매립시공"].map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </select>
                  </label>
                  {selects.map(([key, label, values]) => (
                    <label key={key}>
                      {label}
                      <select
                        aria-label={label}
                        value={String(options[key] ?? values[0])}
                        onChange={(e) => patch(key, e.target.value)}
                      >
                        {values.map((v) => (
                          <option key={v} value={v}>
                            {v === "individual"
                              ? "개별 구성품"
                              : v === "complete"
                                ? "완제품 (개별 자재 제외)"
                                : v === "bundle"
                                  ? "공통 잡자재 1식"
                                  : v === "detail"
                                    ? "세부 품목"
                                    : v}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {numericFields.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        aria-label={label}
                        placeholder="미입력 = 현장산출 필요"
                        value={
                          options[key] === undefined ? "" : Number(options[key])
                        }
                        onChange={(e) =>
                          patch(
                            key,
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                          )
                        }
                      />
                    </label>
                  ))}
                  {(
                    [
                      ["pumpCapacity", "펌프 용량"],
                      ["pumpConnection", "펌프 접속규격"],
                      ["escapeHeight", "피난기구 설치높이·층수"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        value={String(options[key] ?? "")}
                        onChange={(e) => patch(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <p>
                  신규 배관·배선은 기본 포함됩니다. 재사용 조건을 함께 선택하면
                  해당 신규 자재를 제외하고 접속부속과 노무를 유지합니다.
                </p>
                {(
                  [
                    ["reuseWiring", "기존 배선 활용"],
                    ["reusePiping", "기존 배관 활용"],
                    ["reuseEquipment", "기존 기구 재사용"],
                    ["demolition", "철거 포함"],
                    ["night", "야간작업"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ marginRight: 16 }}>
                    <input
                      type="checkbox"
                      checked={conditions[key]}
                      onChange={(e) => {
                        invalidate();
                        setConditions((c) => ({
                          ...c,
                          [key]: e.target.checked,
                        }));
                      }}
                    />
                    {label}
                  </label>
                ))}
                {(
                  [
                    ["flexible", "자바라 사용"],
                    ["reuseBox", "기존 발신기함 재사용"],
                    ["ceilingOpening", "천장 타공"],
                    ["highWork", "고소작업"],
                    ["programming", "프로그램 수정"],
                    ["relaySetup", "중계기 설정"],
                    ["communicationTest", "통신 확인"],
                    ["interlockTest", "연동 시험"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ marginRight: 16 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(options[key])}
                      onChange={(e) => patch(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
                <details>
                  <summary>공유 배관·배선 경로 관리</summary>
                  <p>
                    같은 경로를 지정한 작업은 여기 입력한 실제 총길이·개소를
                    공유합니다. 독립 경로와 공통 작업비는 서로 다른 작업묶음으로
                    구분할 수 있습니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      invalidate();
                      setRoutes((v) => [
                        ...v,
                        {
                          id: `공유경로 ${v.length + 1}`,
                          options: { ...options },
                        },
                      ]);
                    }}
                  >
                    현재 산출값으로 공유 경로 추가
                  </button>
                  {routes.map((r, n) => (
                    <fieldset key={r.id}>
                      <legend>{r.id}</legend>
                      <div className="form-grid">
                        {numericFields.map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={
                                r.options[key] === undefined
                                  ? ""
                                  : Number(r.options[key])
                              }
                              onChange={(e) => {
                                invalidate();
                                setRoutes((v) =>
                                  v.map((x, j) => {
                                    if (j !== n) return x;
                                    const next = {
                                      ...x.options,
                                      [key]:
                                        e.target.value === ""
                                          ? undefined
                                          : Number(e.target.value),
                                    };
                                    return { ...x, options: next };
                                  }),
                                );
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </details>
              </details>
              <button
                className="secondary-button quote-calculate"
                type="button"
                disabled={busy}
                onClick={() => void calculate()}
              >
                {busy ? "계산 중…" : "구성품 자동계산 · 미리보기"}
              </button>
            </>
          )}
          {preview.length > 0 && (
            <>
              <div className="panel-title">
                <h3>구성품 미리보기</h3>
                <strong>
                  {preview
                    .flatMap((s, j) =>
                      s.items.filter((i, n) => !excluded.has(`${j}:${n}`)),
                    )
                    .filter((i) => !i.pricePending && !i.quantityPending)
                    .reduce(
                      (n, i) => n + Math.round(i.quantity * i.saleUnitPrice),
                      0,
                    )
                    .toLocaleString()}
                  원
                </strong>
              </div>
              <button
                className="primary-button quote-apply"
                type="button"
                onClick={() => {
                  for (const [s, section] of preview.entries())
                    onAdd(
                      section.items.filter(
                        (i, n) =>
                          !excluded.has(`${s}:${n}`) &&
                          (i.quantity > 0 || i.quantityPending),
                      ),
                      section.kind,
                    );
                  setPreview([]);
                  setTasks([]);
                  setNotice(
                    "검토한 구성품을 견적에 반영했습니다. 기존 수정단가를 유지합니다.",
                  );
                }}
              >
                견적서에 반영
              </button>
              {!detail && (
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={accessories}
                  onClick={() => setAccessories((v) => !v)}
                >
                  부속자재·잡자재{" "}
                  {
                    preview
                      .flatMap((s) => s.items)
                      .filter((i) => isAccessory(i)).length
                  }
                  종 {accessories ? "▲" : "▼"}
                </button>
              )}
              <p>
                단가 미등록·현장산출 필요 항목은 초안으로 보관할 수 있습니다.
                제출 전에 실제 수량을 확인하세요. 모든 수량·단가는 수정 또는
                삭제할 수 있습니다.
              </p>
              <details>
                <summary>검토 안내 {warnings.length}건</summary>
                {warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
              {preview.map((section, s) => (
                <div key={section.kind} className="table-scroll">
                  <h4>{section.kind}</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>품목명</th>
                        <th>규격</th>
                        <th>단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>금액</th>
                        {detail && <th>계산근거 · 내부원가</th>}
                        {detail && <th>입력</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {section.items.map((item, n) => (
                        <tr
                          key={n}
                          hidden={!detail && !accessories && isAccessory(item)}
                          className={
                            excluded.has(`${s}:${n}`) ? "quote-excluded" : ""
                          }
                        >
                          <td>{item.name}</td>
                          <td>{item.specification}</td>
                          <td>{item.unit}</td>
                          <td>
                            <input
                              aria-label={`미리보기 ${section.kind} ${n + 1} 수량`}
                              type="number"
                              min="0"
                              step="0.001"
                              value={
                                item.quantityPending && item.quantity === 0
                                  ? ""
                                  : item.quantity
                              }
                              placeholder="현장산출 필요"
                              onChange={(e) =>
                                edit(s, n, {
                                  quantity: Number(e.target.value),
                                  quantityPending: e.target.value === "",
                                  manualQuantity: true,
                                  calculationBasis: "관리자 수동 수정",
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`미리보기 ${section.kind} ${n + 1} 단가`}
                              type="number"
                              min="0"
                              step="1"
                              value={
                                item.pricePending && item.saleUnitPrice === 0
                                  ? ""
                                  : item.saleUnitPrice
                              }
                              placeholder={
                                autoPrice ? "단가 미등록" : "직접 입력"
                              }
                              onChange={(e) =>
                                edit(s, n, {
                                  saleUnitPrice: Number(e.target.value),
                                  pricePending: e.target.value === "",
                                })
                              }
                            />
                          </td>
                          <td>
                            {item.pricePending || item.quantityPending
                              ? "미확정"
                              : Math.round(
                                  item.quantity * item.saleUnitPrice,
                                ).toLocaleString() + "원"}
                          </td>
                          {detail && (
                            <td>
                              {item.calculationBasis}
                              <small>
                                내부원가{" "}
                                {Math.round(
                                  item.quantity *
                                    (item.materialUnitCost +
                                      item.laborUnitCost +
                                      item.expenseUnitCost),
                                ).toLocaleString()}
                                원
                              </small>
                            </td>
                          )}
                          {detail && (
                            <td>
                              {item.manualQuantity ? "수동수정" : "자동추가"}
                            </td>
                          )}
                          <td>
                            <label>
                              <input
                                type="checkbox"
                                aria-label={`포함 ${section.kind} ${n + 1}`}
                                checked={!excluded.has(`${s}:${n}`)}
                                onChange={(e) =>
                                  setExcluded((v) => {
                                    const next = new Set(v);
                                    if (e.target.checked)
                                      next.delete(`${s}:${n}`);
                                    else next.add(`${s}:${n}`);
                                    return next;
                                  })
                                }
                              />
                              포함
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setExcluded(
                                  (v) =>
                                    new Set(
                                      [...v].flatMap((key) => {
                                        const [j, i] = key
                                          .split(":")
                                          .map(Number);
                                        return j !== s
                                          ? [key]
                                          : i === n
                                            ? []
                                            : [`${j}:${i > n ? i - 1 : i}`];
                                      }),
                                    ),
                                );
                                setPreview((v) =>
                                  v.map((x, j) =>
                                    j === s
                                      ? {
                                          ...x,
                                          items: x.items.filter(
                                            (_, i) => i !== n,
                                          ),
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            >
                              구성품 삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
