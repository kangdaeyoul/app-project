import { BadRequestException } from "@nestjs/common";
import {
  StandardWork,
  StandardWorkRequest,
  WorkEstimateOptions,
  WorkPrice,
  QuoteItemInput,
  WorkSiteConditions,
  WorkCondition,
} from "@jongno/shared";
export function validateEstimate(raw: unknown): WorkEstimateOptions {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new BadRequestException("현장산출 조건을 확인하세요.");
  const r = raw as Record<string, unknown>;
  const nums = [
    "routeLength",
    "wireLength",
    "wireStrands",
    "wireSlack",
    "conduitLength",
    "pipeLength",
    "locations",
    "connections",
    "couplings",
    "fixingInterval",
    "fixingPoints",
    "screwsPerFixing",
    "anchorsPerFixing",
    "circuits",
    "people",
    "days",
  ];
  const strings = [
    "batchId",
    "routeGroup",
    "wireSpec",
    "detectorSpec",
    "conduitType",
    "conduitSize",
    "headOrientation",
    "pipeType",
    "pipeSize",
    "jointMethod",
    "receiverType",
    "kitMode",
    "miscMode",
    "pumpCapacity",
    "pumpConnection",
    "escapeHeight",
  ];
  const bools = [
    "flexible",
    "reuseBox",
    "concealed",
    "wallEmbedded",
    "ceilingOpening",
    "highWork",
    "programming",
    "relaySetup",
    "communicationTest",
    "interlockTest",
  ];
  const numeric = (v: unknown) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= 0 &&
    v <= 1000000 &&
    Math.abs(v * 1000 - Math.round(v * 1000)) < 0.000001;
  for (const [key, v] of Object.entries(r)) {
    if (v === undefined) continue;
    if (nums.includes(key)) {
      if (!numeric(v))
        throw new BadRequestException(
          `${key}: 0 이상의 현장수량을 입력하세요.`,
        );
    } else if (strings.includes(key)) {
      if (typeof v !== "string" || v.length > 300 || /[\u0000-\u001f]/.test(v))
        throw new BadRequestException(`${key} 입력을 확인하세요.`);
    } else if (bools.includes(key)) {
      if (typeof v !== "boolean")
        throw new BadRequestException(`${key} 입력을 확인하세요.`);
    } else if (["manualQuantities", "materialSelections"].includes(key)) {
      if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        Object.keys(v).length > 1000
      )
        throw new BadRequestException("구성품 수정값을 확인하세요.");
      for (const x of Object.values(v))
        if (
          key === "manualQuantities"
            ? !numeric(x)
            : typeof x !== "string" || x.length > 100
        )
          throw new BadRequestException("구성품 수정값을 확인하세요.");
    } else if (key === "excludedComponents") {
      if (
        !Array.isArray(v) ||
        v.length > 1000 ||
        v.some((x) => typeof x !== "string" || x.length > 100)
      )
        throw new BadRequestException("구성품 제외값을 확인하세요.");
    } else throw new BadRequestException(`지원하지 않는 현장조건: ${key}`);
  }
  for (const [key, allowed] of Object.entries({
    conduitType: ["강재", "SF", "GW"],
    headOrientation: ["상향식", "하향식"],
    pipeType: ["백관", "CPVC", "동관"],
    jointMethod: ["나사식", "그루빙", "용접식", "CPVC"],
    receiverType: ["P형", "R형", "복합"],
    kitMode: ["individual", "complete"],
    miscMode: ["detail", "bundle"],
    detectorSpec: ["연기식", "차동식", "정온식"],
  }))
    if (r[key] !== undefined && !allowed.includes(r[key] as string))
      throw new BadRequestException(`${key} 선택을 확인하세요.`);
  if (r.concealed && r.wallEmbedded)
    throw new BadRequestException("천장 은폐와 벽체 매립은 하나만 선택하세요.");
  return r as WorkEstimateOptions;
}
export function calculateIntegrated(
  t: StandardWork,
  prices: WorkPrice[],
  r: StandardWorkRequest,
  autoPrice: boolean,
  conditions: WorkSiteConditions,
  matches: (rule: WorkCondition, c: WorkSiteConditions) => boolean,
) {
  const opt = validateEstimate(r.estimate),
    q = r.quantity,
    warnings: string[] = [];
  const method = opt.wallEmbedded
    ? "벽체 매립"
    : opt.concealed
      ? "천장 은폐"
      : conditions.installation === "매립"
        ? "벽체 매립"
        : "노출";
  const conduitType = opt.conduitType ?? "강재",
    conduitSize = opt.conduitSize ?? "16mm",
    pipeType = opt.pipeType ?? "백관",
    pipeSize = opt.pipeSize ?? "25A",
    joint =
      opt.jointMethod ??
      (pipeType === "CPVC"
        ? "CPVC"
        : pipeType === "동관"
          ? "용접식"
          : "나사식");
  const batch = opt.batchId || "현장 공통",
    route = opt.routeGroup || t.id;
  if (t.reviewStatus !== "사용승인")
    warnings.push(
      "검토필요: 예시수량 포함 / 현장확인 필요. 법정 표준 또는 확정 시공물량이 아닙니다.",
    );
  if (opt.flexible && (opt.headOrientation ?? "상향식") === "상향식")
    warnings.push("상향식 시공: 자바라와 고정브래킷은 제외했습니다.");
  if (
    (t.name.includes("펌프") && (!opt.pumpCapacity || !opt.pumpConnection)) ||
    ((t.name.includes("완강기") || t.name.includes("구조대")) &&
      !opt.escapeHeight)
  )
    warnings.push("제품 용량·접속규격 또는 설치높이 현장확인 필요");
  const items: QuoteItemInput[] = [];
  for (const c of t.components) {
    if (
      opt.excludedComponents?.includes(c.id) ||
      c.omitWhen.some((f) => r.reuse.includes(f)) ||
      (c.includeWhen ?? []).some((rule) => !matches(rule, conditions)) ||
      (c.excludeWhen ?? []).some((rule) => matches(rule, conditions))
    )
      continue;
    if (
      (conditions.reuseEquipment && c.role === "주자재") ||
      (conditions.reuseWiring && ["배선", "전선"].includes(c.role)) ||
      (conditions.reusePiping && ["배관", "전선관"].includes(c.role)) ||
      (!conditions.demolition && c.role === "철거노무")
    )
      continue;
    const selector = c.selector ?? "";
    if (
      (selector === "kit-complete" && opt.kitMode !== "complete") ||
      (selector.startsWith("kit-") &&
        selector !== "kit-complete" &&
        opt.kitMode === "complete") ||
      (selector === "kit-box" && opt.reuseBox)
    )
      continue;
    if (
      selector === "flexible" &&
      (!opt.flexible || (opt.headOrientation ?? "상향식") === "상향식")
    )
      continue;
    if (
      (selector === "misc-bundle" && opt.miscMode === "detail") ||
      (selector === "misc-detail" && opt.miscMode !== "detail")
    )
      continue;
    if (
      [
        "programming",
        "relaySetup",
        "communicationTest",
        "interlockTest",
        "ceilingOpening",
        "highWork",
      ].includes(selector) &&
      !opt[selector as keyof WorkEstimateOptions]
    )
      continue;
    if (selector === "exposed" && (method !== "노출" || conditions.reusePiping))
      continue;
    if (selector.startsWith("electrical-accessory:")) {
      const n = selector.split(":")[1];
      if (conditions.reusePiping && !["전선관 커넥터"].includes(n)) continue;
      if (method !== "노출" && ["새들", "전선관 커플링"].includes(n)) continue;
    }
    if (selector.startsWith("pipe-accessory:")) {
      const n = selector.split(":")[1];
      const allowed =
        joint === "CPVC"
          ? ["티", "엘보", "소켓", "전용 접합재"]
          : joint === "그루빙"
            ? ["티", "엘보", "커플링", "가스켓"]
            : joint === "용접식"
              ? ["용접 이음쇠"]
              : ["티", "엘보", "소켓", "니플", "레듀샤"];
      if (!allowed.includes(n)) continue;
    }
    let variant =
      selector === "detector"
        ? (opt.detectorSpec ?? "연기식")
        : selector === "wire"
          ? (opt.wireSpec ?? "HFIX 1.5SQ")
          : selector === "conduit" ||
              selector.startsWith("electrical-accessory:")
            ? `${conduitType}|${conduitSize}`
            : selector === "pipe" || selector.startsWith("pipe-accessory:")
              ? `${pipeType}|${pipeSize}|${joint}`
              : selector === "head"
                ? (opt.headOrientation ?? "상향식")
                : selector === "receiver"
                  ? (opt.receiverType ?? "P형")
                  : undefined;
    const selectedId =
      opt.materialSelections?.[c.id] ??
      opt.materialSelections?.[selector] ??
      (variant ? c.variants?.[variant] : undefined) ??
      c.priceId;
    let p = prices.find((p) => p.id === selectedId);
    let missingVariant =
      !!variant &&
      !!c.variants &&
      !c.variants[variant] &&
      !opt.materialSelections?.[c.id];
    if (!p)
      throw new BadRequestException("선택한 자재가 현재 회사 DB에 없습니다.");
    if (missingVariant) {
      warnings.push(`${p.name}: ${variant} 자재 연결 및 규격 확인 필요`);
      p = {
        ...p,
        id: "",
        specification: variant!,
        cost: 0,
        salePrice: 0,
        priceRegistered: false,
      };
    }
    if (
      !p.compatibility &&
      (opt.materialSelections?.[c.id] || opt.materialSelections?.[selector]) &&
      (selector === "conduit" ||
        selector.startsWith("electrical-accessory:") ||
        selector.startsWith("pipe"))
    )
      warnings.push(`${p.name}: 부속 호환정보 미등록, 종류·규격을 확인하세요.`);
    if (
      p.compatibility &&
      (((selector === "conduit" ||
        selector.startsWith("electrical-accessory:")) &&
        (p.compatibility.family !== conduitType ||
          p.compatibility.size !== conduitSize)) ||
        (selector.startsWith("pipe") &&
          (p.compatibility.family !== pipeType ||
            p.compatibility.size !== pipeSize ||
            p.compatibility.method !== joint)))
    )
      warnings.push(
        `${p.name}: 전선관/배관 및 부속 규격이 서로 맞지 않습니다. 관리자 확인 필요`,
      );
    let quantity = 0,
      pending = false,
      basis = "",
      source =
        c.quantityRule?.source ??
        (["고정수량", "1식", "작업묶음 고정수량"].includes(c.mode)
          ? "fixed"
          : ["관리자 직접입력", "수동수량"].includes(c.mode)
            ? "manual"
            : ["길이기준", "현장거리 직접입력"].includes(c.mode)
              ? c.role === "배관"
                ? "pipe"
                : c.role === "전선관"
                  ? "conduit"
                  : "wire"
              : "quantity");
    const f = c.quantityRule?.factor ?? c.factor;
    const manual =
      opt.manualQuantities?.[c.id] ??
      opt.manualQuantities?.[c.quantityRule?.inputKey ?? p.name] ??
      r.overrides[c.id];
    const input = (v: number | undefined, description: string) => {
      if (v === undefined) {
        pending = true;
        basis = description + " 미입력: 현장산출 필요";
        return 0;
      }
      basis = description;
      return v;
    };
    if (manual !== undefined) {
      quantity = manual;
      basis = "관리자 직접 산출/수정";
    } else if (source === "quantity") {
      quantity = q * f;
      basis = `작업수량 ${q} × ${f}`;
    } else if (source === "fixed") {
      quantity = f;
      basis = "동일 작업묶음 공통 1회 적용";
    } else if (source === "wire") {
      if (opt.wireLength !== undefined) {
        quantity = opt.wireLength;
        basis = "규격별 실제 전선 산출길이";
      } else if (
        opt.routeLength !== undefined &&
        opt.wireStrands !== undefined
      ) {
        quantity = opt.routeLength * opt.wireStrands + (opt.wireSlack ?? 0);
        basis = `경로 ${opt.routeLength}m × ${opt.wireStrands}가닥 + 여유 ${opt.wireSlack ?? 0}m`;
      } else {
        quantity = input(undefined, "배선 경로·가닥 수");
      }
    } else if (source === "conduit") {
      quantity = input(
        opt.conduitLength ?? opt.routeLength,
        "전선관 실제 경로길이",
      );
    } else if (source === "pipe") {
      quantity = input(opt.pipeLength, "배관 실제 산출길이");
    } else if (source === "locations") {
      quantity = input(opt.locations, "설치 개소") * f;
    } else if (source === "connections") {
      quantity = input(opt.connections, "접속 개소") * f;
    } else if (source === "couplings") {
      quantity = input(opt.couplings, "연결 개소") * f;
    } else if (source === "supports") {
      if (opt.fixingPoints !== undefined) {
        quantity = opt.fixingPoints * f;
        basis = "실제 고정 개소";
      } else {
        const length =
          t.section === "전기"
            ? (opt.conduitLength ?? opt.routeLength)
            : opt.pipeLength;
        if (
          length !== undefined &&
          opt.fixingInterval &&
          opt.fixingInterval > 0
        ) {
          quantity = Math.ceil(length / opt.fixingInterval) * f;
          basis = `실제 길이 ${length}m ÷ 고정간격 ${opt.fixingInterval}m (올림)`;
        } else quantity = input(undefined, "배관 길이 및 고정 간격");
      }
    } else if (source === "screws" || source === "anchors") {
      const length = opt.conduitLength ?? opt.routeLength;
      const supports =
        opt.fixingPoints ??
        (length !== undefined && opt.fixingInterval
          ? Math.ceil(length / opt.fixingInterval)
          : undefined);
      const per =
        source === "screws" ? opt.screwsPerFixing : opt.anchorsPerFixing;
      if (supports === undefined || per === undefined) {
        quantity = input(undefined, "고정 개소 및 개소당 피스/앵커 수");
      } else {
        quantity = supports * per * f;
        basis = `고정 ${supports}개소 × 개소당 ${per}`;
      }
    } else if (source === "circuits") {
      quantity = input(opt.circuits, "수신반 회로수") * f;
    } else if (source === "peopleDays") {
      if (opt.people === undefined || opt.days === undefined)
        quantity = input(undefined, "투입 인원과 작업일수");
      else {
        quantity = opt.people * opt.days * f;
        basis = `${opt.people}인 × ${opt.days}일`;
      }
    } else if (source === "baseAdditional") {
      quantity =
        (c.quantityRule?.base ?? 0) +
        Math.max(q - 1, 0) * (c.quantityRule?.extra ?? 0);
      basis = `예시 기본노무 ${c.quantityRule?.base ?? 0} + 추가 ${Math.max(q - 1, 0)} × ${c.quantityRule?.extra ?? 0}; 현장검토 필요`;
    } else quantity = input(undefined, p.name + " 수동수량");
    quantity = Math.round(quantity * 1000) / 1000;
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1000000)
      throw new BadRequestException("산출 수량 범위를 확인하세요.");
    if (quantity === 0 && !pending) continue;
    if (pending) warnings.push(`${p.name}: 현장산출 필요`);
    const priceMissing = p.priceRegistered === false || missingVariant;
    const priceEnabled = autoPrice && !priceMissing;
    const common =
      c.commonKey || source === "fixed" ? (c.commonKey ?? p.id) : undefined;
    const shared =
      [
        "wire",
        "conduit",
        "pipe",
        "supports",
        "screws",
        "anchors",
        "locations",
        "connections",
        "couplings",
      ].includes(source) && !!opt.routeGroup;
    const physical = common
      ? "공통"
      : selector === "receiver"
        ? `${opt.receiverType ?? "P형"}|${opt.circuits ?? "미확정"}`
        : c.role === "전선" ||
            c.role === "전선관" ||
            selector.startsWith("electrical-accessory:")
          ? `${method}|${conduitType}|${conduitSize}`
          : c.role === "배관" || c.role === "배관부속"
            ? `${pipeType}|${pipeSize}|${joint}`
            : c.role === "주자재"
              ? `${p.specification}|${opt.pumpCapacity ?? ""}|${opt.pumpConnection ?? ""}|${opt.escapeHeight ?? ""}`
              : source === "baseAdditional"
                ? `${method}|노무:${t.id}`
                : method;
    items.push({
      materialCode: p.id,
      entrySources: ["standard"],
      trade: t.name,
      name: p.name,
      specification: p.specification,
      quantity,
      unit: p.unit,
      materialUnitCost: priceEnabled && p.category === "재료비" ? p.cost : 0,
      laborUnitCost: priceEnabled && p.category === "노무비" ? p.cost : 0,
      expenseUnitCost: priceEnabled && p.category === "경비" ? p.cost : 0,
      saleUnitPrice: priceEnabled ? p.salePrice : 0,
      pricePending: !priceEnabled,
      quantityPending: pending,
      priceCategory: p.category,
      notes: priceMissing ? "단가 미등록" : "",
      laborBasis:
        source === "baseAdditional"
          ? {
              templateId: t.id,
              base: c.quantityRule?.base ?? 0,
              extra: c.quantityRule?.extra ?? 0,
              workQuantity: q,
            }
          : undefined,
      calculationBasis: basis,
      constructionKey: physical,
      accumulation: common || shared ? "max" : "sum",
      accumulationScope: common
        ? `${batch}|${common}`
        : shared
          ? `${batch}|경로:${route}`
          : undefined,
      autoGenerated: true,
      manualQuantity: manual !== undefined,
      reviewNotice:
        t.reviewStatus !== "사용승인" ? "예시수량 포함 / 현장확인 필요" : "",
      customerGroup: c.customerGroup,
      standardSource: {
        templateId: t.id,
        version: t.version,
        componentId: c.id,
      },
    });
  }
  return {
    templateId: t.id,
    version: t.version,
    section: t.section,
    items,
    warnings: [...new Set(warnings)],
    reviewStatus: t.reviewStatus ?? "검토필요",
  };
}
