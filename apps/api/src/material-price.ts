import { BadRequestException } from "@nestjs/common";
import {
  WorkPrice,
  MaterialPriceHistory,
  MATERIAL_EXCEL_COLUMNS,
} from "@jongro/shared";
import { randomUUID } from "node:crypto";
import { validDate } from "./date";
export const materialIdentity = (
  p: Pick<WorkPrice, "name" | "specification" | "unit">,
) => JSON.stringify([p.name.trim(), p.specification.trim(), p.unit.trim()]);
export const materialCode = (p: WorkPrice) => p.materialCode ?? p.id;
export function normalizedPrice(p: WorkPrice): WorkPrice {
  return {
    ...p,
    materialCode: materialCode(p),
    active: p.active ?? true,
    priceRegistered: p.priceRegistered ?? true,
    purchasePriceRegistered:
      p.purchasePriceRegistered ?? p.purchasePrice !== undefined,
    costRegistered: p.costRegistered ?? p.priceRegistered !== false,
    trade: p.trade ?? "",
    manufacturer: p.manufacturer ?? "",
    supplier: p.supplier ?? "",
    purchasePrice: p.purchasePrice ?? 0,
    vatIncluded: p.vatIncluded ?? false,
    costVatIncluded: p.costVatIncluded ?? p.vatIncluded ?? false,
    saleVatIncluded: p.saleVatIncluded ?? p.vatIncluded ?? false,
    salePriceSource: p.salePriceSource ?? "직접입력",
    markupPercent: p.markupPercent ?? 30,
    effectiveDate: p.effectiveDate ?? "",
    notes: p.notes ?? "",
  };
}
export function equalPrice(a: WorkPrice, b: WorkPrice) {
  const x = normalizedPrice(a),
    y = normalizedPrice(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])]
    .filter((k) => k !== "revision")
    .every(
      (k) => JSON.stringify((x as any)[k]) === JSON.stringify((y as any)[k]),
    );
}
export function materialValues(p: WorkPrice): (string | number)[] {
  const v = normalizedPrice(p);
  return [
    materialCode(v),
    v.name,
    v.specification,
    v.unit,
    v.trade!,
    v.manufacturer!,
    v.supplier!,
    v.purchasePriceRegistered ? v.purchasePrice! : "",
    v.costRegistered ? v.cost : "",
    v.priceRegistered ? v.salePrice : "",
    v.vatIncluded ? "포함" : "미포함",
    v.effectiveDate!,
    v.notes!,
  ];
}
export function parseAmount(
  value: unknown,
  label: string,
): { value: number; registered: boolean } {
  if (value === null || value === undefined || value === "")
    return { value: 0, registered: false };
  const s =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (s === "") return { value: 0, registered: false };
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(s))
    throw new BadRequestException(
      `${label}: 쉼표를 포함한 0 이상의 정수 금액을 입력하세요.`,
    );
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isSafeInteger(n) || n > 1000000000)
    throw new BadRequestException(`${label}: 최대 10억 원까지 입력하세요.`);
  return { value: n, registered: true };
}
const str = (v: unknown, label: string, max = 300) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number")
    throw new BadRequestException(`${label}: 텍스트를 입력하세요.`);
  const s = String(v).trim();
  if (s.length > max || /[\u0000-\u001f]/.test(s))
    throw new BadRequestException(`${label}: 길이 또는 제어문자 오류`);
  return s;
};
export function validateMaterial(
  raw: any,
  companyId: string,
  id: string,
  old?: WorkPrice,
): WorkPrice {
  if (!raw || typeof raw !== "object")
    throw new BadRequestException("자재정보를 입력하세요.");
  const name = str(raw.name, "자재명"),
    unit = str(raw.unit, "단위");
  if (!name || !unit)
    throw new BadRequestException("자재명과 단위는 필수입니다.");
  const purchase = parseAmount(raw.purchasePrice, "최근매입가"),
    cost = parseAmount(raw.cost, "기준원가"),
    sale = parseAmount(raw.salePrice, "기준판매단가");
  const code =
    str(raw.materialCode ?? old?.materialCode ?? id, "자재코드", 100) || id;
  const date = str(raw.effectiveDate, "적용일");
  if (date && !validDate(date))
    throw new BadRequestException("잘못된 적용일 (YYYY-MM-DD)");
  if (
    !["재료비", "노무비", "경비"].includes(
      raw.category ?? old?.category ?? "재료비",
    )
  )
    throw new BadRequestException("금액 분류를 확인하세요.");
  for (const k of [
    "vatIncluded",
    "costVatIncluded",
    "saleVatIncluded",
    "active",
    "purchasePriceRegistered",
    "costRegistered",
    "priceRegistered",
  ])
    if (raw[k] !== undefined && typeof raw[k] !== "boolean")
      throw new BadRequestException(`${k}: 참/거짓을 선택하세요.`);
  const source = raw.salePriceSource ?? old?.salePriceSource ?? "직접입력";
  if (!["직접입력", "원가가산", "소매가격"].includes(source))
    throw new BadRequestException("판매가격 방식을 확인하세요.");
  const markup = Number(raw.markupPercent ?? old?.markupPercent ?? 30);
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000)
    throw new BadRequestException("가산율은 0~1000%로 입력하세요.");
  const registeredCost =
    raw.costRegistered === false && cost.value !== old?.cost
      ? cost.registered
      : (raw.costRegistered ?? cost.registered);
  const costVat =
    raw.costVatIncluded ??
    raw.vatIncluded ??
    old?.costVatIncluded ??
    old?.vatIncluded ??
    false;
  const saleVat =
    raw.saleVatIncluded ??
    raw.vatIncluded ??
    old?.saleVatIncluded ??
    old?.vatIncluded ??
    false;
  const computed = Math.round(
    (cost.value / (costVat ? 1.1 : 1)) *
      (1 + markup / 100) *
      (saleVat ? 1.1 : 1),
  );
  if (source === "원가가산" && computed > 1000000000)
    throw new BadRequestException("계산된 판매단가는 최대 10억 원까지입니다.");
  return {
    id,
    companyId,
    revision: (old?.revision ?? 0) + 1,
    materialCode: code,
    name,
    unit,
    specification: str(raw.specification, "규격"),
    category: raw.category ?? old?.category ?? "재료비",
    compatibility: old?.compatibility,
    active: raw.active ?? old?.active ?? true,
    trade: str(raw.trade, "공종"),
    manufacturer: str(raw.manufacturer, "제조사"),
    supplier: str(raw.supplier, "공급업체"),
    purchasePrice: purchase.value,
    purchasePriceRegistered:
      raw.purchasePriceRegistered === false &&
      purchase.value !== old?.purchasePrice
        ? purchase.registered
        : (raw.purchasePriceRegistered ?? purchase.registered),
    cost: cost.value,
    costRegistered: registeredCost,
    salePrice: source === "원가가산" && registeredCost ? computed : sale.value,
    priceRegistered:
      source === "원가가산"
        ? registeredCost
        : raw.priceRegistered === false && sale.value !== old?.salePrice
          ? sale.registered
          : (raw.priceRegistered ?? sale.registered),
    salePriceSource: source,
    markupPercent: markup,
    vatIncluded: raw.vatIncluded ?? old?.vatIncluded ?? false,
    costVatIncluded:
      raw.costVatIncluded ??
      raw.vatIncluded ??
      old?.costVatIncluded ??
      old?.vatIncluded ??
      false,
    saleVatIncluded:
      raw.saleVatIncluded ??
      raw.vatIncluded ??
      old?.saleVatIncluded ??
      old?.vatIncluded ??
      false,
    effectiveDate: date,
    notes: str(raw.notes, "비고", 1000),
  };
}
export function materialFromValues(
  values: (string | number)[],
  companyId: string,
  id: string,
  old?: WorkPrice,
): WorkPrice {
  if (values.length !== MATERIAL_EXCEL_COLUMNS.length)
    throw new BadRequestException("표준 양식은 13개 컬럼입니다.");
  const vat = String(values[10]).trim();
  if (
    ![
      "",
      "포함",
      "미포함",
      "Y",
      "N",
      "TRUE",
      "FALSE",
      "true",
      "false",
    ].includes(vat)
  )
    throw new BadRequestException("부가세 포함여부: 포함/미포함 입력");
  let date = values[11];
  if (typeof date === "number")
    date =
      date >= 1 && date <= 2958465
        ? new Date(Date.UTC(1899, 11, 30) + Math.floor(date) * 86400000)
            .toISOString()
            .slice(0, 10)
        : "잘못된 날짜";
  const vatIncluded = ["포함", "Y", "TRUE", "true"].includes(vat);
  const sale = parseAmount(values[9], "기준판매단가");
  return validateMaterial(
    {
      salePriceSource:
        old?.salePriceSource === "원가가산" && sale.value !== old.salePrice
          ? "직접입력"
          : old?.salePriceSource,
      costVatIncluded:
        old && old.vatIncluded === vatIncluded
          ? (old.costVatIncluded ?? vatIncluded)
          : vatIncluded,
      saleVatIncluded:
        old && old.vatIncluded === vatIncluded
          ? (old.saleVatIncluded ?? vatIncluded)
          : vatIncluded,
      materialCode: String(values[0]).trim() || old?.materialCode || id,
      name: values[1],
      specification: values[2],
      unit: values[3],
      trade: values[4],
      manufacturer: values[5],
      supplier: values[6],
      purchasePrice: values[7],
      cost: values[8],
      salePrice: values[9],
      vatIncluded: ["포함", "Y", "TRUE", "true"].includes(vat),
      effectiveDate: date,
      notes: values[12],
      category: old?.category ?? "재료비",
    },
    companyId,
    id,
    old,
  );
}
export function priceChange(
  p: WorkPrice,
  old: WorkPrice | undefined,
  method: MaterialPriceHistory["method"],
  userId: string,
): MaterialPriceHistory | undefined {
  const x = old ? normalizedPrice(old) : undefined,
    y = normalizedPrice(p);
  const keys = [
    ...new Set([...Object.keys(x ?? {}), ...Object.keys(y)]),
  ].filter(
    (k) => !["id", "companyId", "compatibility", "revision"].includes(k),
  );
  const value = (p: WorkPrice | undefined, k: string): unknown => {
    if (!p) return null;
    if (k === "purchasePrice" && p.purchasePriceRegistered === false)
      return null;
    if (k === "cost" && p.costRegistered === false) return null;
    if (k === "salePrice" && p.priceRegistered === false) return null;
    return (p as any)[k] ?? null;
  };
  const changes = keys
    .filter((k) => JSON.stringify(value(x, k)) !== JSON.stringify(value(y, k)))
    .map((k) => ({ field: k, before: value(x, k), after: value(y, k) }));
  if (!changes.length) return;
  return {
    id: randomUUID(),
    companyId: p.companyId,
    materialId: p.id,
    materialCode: materialCode(p),
    materialName: p.name,
    changes,
    beforePurchasePrice: old?.purchasePrice ?? null,
    afterPurchasePrice: p.purchasePrice ?? 0,
    beforeCost: old?.cost ?? null,
    afterCost: p.cost,
    beforeSalePrice: old?.salePrice ?? null,
    afterSalePrice: p.salePrice,
    effectiveDate: p.effectiveDate ?? "",
    changedAt: new Date().toISOString(),
    method,
    userId,
  };
}
