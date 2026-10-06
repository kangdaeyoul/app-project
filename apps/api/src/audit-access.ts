import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { AuditValue } from "@jongno/shared";
import { CompanyContext } from "./company-context";
export const AUDIT_ACCESS = Symbol("AUDIT_ACCESS");
export interface AuditAccess {
  assertAll(): void;
  assertSite(siteId: string): void;
  snapshot(value: AuditValue): AuditValue;
}
const privateKeys = new Set([
  "materialUnitCost",
  "laborUnitCost",
  "expenseUnitCost",
  "internalGeneralCost",
  "internalSupportCost",
  "internal",
  "margin",
  "marginRate",
  "totalCost",
]);
@Injectable()
export class CompanyAuditAccess implements AuditAccess {
  constructor(
    @Inject(CompanyContext) private readonly company: CompanyContext,
  ) {}
  private get isAdmin() {
    return this.company.identity.memberships.some(
      (m) =>
        m.companyId === this.company.companyId &&
        m.userId === this.company.identity.userId &&
        m.role === "admin",
    );
  }
  assertAll() {
    this.company.assertMember(true);
  }
  assertSite(siteId: string) {
    this.company.assertMember();
    if (
      !this.isAdmin &&
      !this.company.identity.accessibleSiteIds?.includes(siteId)
    )
      throw new ForbiddenException(
        "이 현장의 변경이력을 조회할 권한이 없습니다.",
      );
  }
  snapshot(value: AuditValue): AuditValue {
    if (this.isAdmin) return structuredClone(value);
    const allowed = this.company.identity.accessibleSiteIds ?? [];
    if (
      value &&
      !Array.isArray(value) &&
      typeof value === "object" &&
      typeof value.siteId === "string" &&
      !allowed.includes(value.siteId)
    )
      return { restricted: true, message: "접근 범위 밖의 현장 정보" };
    const publicValue = (v: AuditValue): AuditValue =>
      Array.isArray(v)
        ? v.map(publicValue)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .filter(
                  ([k, x]) =>
                    !privateKeys.has(k) &&
                    !(
                      k === "convertedSiteId" &&
                      typeof x === "string" &&
                      !allowed.includes(x)
                    ),
                )
                .map(([k, x]) => [k, publicValue(x)]),
            )
          : v;
    return publicValue(value);
  }
}
