import { WorkPrice, MaterialPriceHistory } from "@jongno/shared";
import { randomUUID } from "node:crypto";
export function normalizedPrice(p: WorkPrice): WorkPrice {
  return {
    ...p,
    trade: p.trade ?? "",
    manufacturer: p.manufacturer ?? "",
    supplier: p.supplier ?? "",
    purchasePrice: p.purchasePrice ?? 0,
    vatIncluded: p.vatIncluded ?? false,
    effectiveDate: p.effectiveDate ?? "",
    notes: p.notes ?? "",
  };
}
export function equalPrice(a: WorkPrice, b: WorkPrice) {
  const x = normalizedPrice(a),
    y = normalizedPrice(b);
  return (Object.keys(x) as (keyof WorkPrice)[]).every((k) => x[k] === y[k]);
}
export function priceChange(
  p: WorkPrice,
  old: WorkPrice | undefined,
  method: MaterialPriceHistory["method"],
  userId: string,
): MaterialPriceHistory | undefined {
  if (
    old &&
    (old.purchasePrice ?? 0) === (p.purchasePrice ?? 0) &&
    old.cost === p.cost &&
    old.salePrice === p.salePrice
  )
    return undefined;
  return {
    id: randomUUID(),
    companyId: p.companyId,
    materialId: p.id,
    beforePurchasePrice: old ? (old.purchasePrice ?? 0) : null,
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
