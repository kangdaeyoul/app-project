import { ForbiddenException } from "@nestjs/common";
import { CompanyOwned, DEFAULT_COMPANY } from "@jongno/shared";
import { CompanyContext } from "./company-context";
/** Adapter instances (including child collections) are owned by exactly one company.
 * PostgreSQL adapters must use company_id predicates and composite foreign keys.
 */
export function companyRepository<T extends object>(
  context: CompanyContext,
  create: (seed: boolean) => T,
): T {
  const sample = create(true);
  const methods = new Set(
    Object.getOwnPropertyNames(Object.getPrototypeOf(sample)).filter(
      (k) =>
        k !== "constructor" && typeof Reflect.get(sample, k) === "function",
    ),
  );
  const partitions = new Map<string, CompanyOwned<{ adapter: T }>>([
    [DEFAULT_COMPANY.id, { companyId: DEFAULT_COMPANY.id, adapter: sample }],
  ]);
  const check = (value: unknown, companyId: string): void => {
    if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return;
    if (
      "companyId" in value &&
      (value as { companyId: unknown }).companyId !== companyId
    )
      throw new ForbiddenException("다른 회사의 데이터는 저장할 수 없습니다.");
    for (const child of Object.values(value)) check(child, companyId);
  };
  return new Proxy({} as T, {
    get(_target, property) {
      // Never look like a promise to Nest dependency resolution.
      if (property === "then") return undefined;
      if (property === "companyId") return context.companyId;
      if (typeof property !== "string" || !methods.has(property))
        return undefined;
      return (...args: unknown[]) => {
        const companyId = context.companyId;
        const reads = new Set([
          "list",
          "favorites",
          "priceHistory",
          "getImport",
          "find",
          "receipts",
          "payments",
          "allocations",
          "sale",
          "purchase",
          "worker",
          "availability",
          "work",
          "get",
        ]);
        if (
          !reads.has(property) &&
          context.identity.memberships.find(
            (m) =>
              m.companyId === companyId && m.userId === context.identity.userId,
          )?.role === "viewer"
        )
          throw new ForbiddenException("읽기 전용 회사 권한입니다.");
        args.forEach((arg) => check(arg, companyId));
        let partition = partitions.get(companyId);
        if (!partition) {
          partition = { companyId, adapter: create(false) };
          partitions.set(companyId, partition);
        }
        const adapter = partition.adapter;
        const method = Reflect.get(adapter, property);
        if (typeof method !== "function")
          throw new Error(`Unknown repository method: ${String(property)}`);
        return method.apply(adapter, args);
      };
    },
  });
}
