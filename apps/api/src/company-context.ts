import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { Company, CompanyMembership, DEFAULT_COMPANY } from "@jongno/shared";
export interface CompanyIdentity {
  companyId: string;
  userId: string;
  memberships: CompanyMembership[];
}
export const SAMPLE_IDENTITY: CompanyIdentity = {
  companyId: DEFAULT_COMPANY.id,
  userId: "sample-admin",
  memberships: [
    { companyId: DEFAULT_COMPANY.id, userId: "sample-admin", role: "admin" },
  ],
};
// Only trusted server authentication adapters may establish this context.
@Injectable()
export class CompanyContext {
  private readonly local = new AsyncLocalStorage<CompanyIdentity>();
  private readonly companies = new Map<string, Company>([
    [DEFAULT_COMPANY.id, structuredClone(DEFAULT_COMPANY)],
  ]);
  get identity() {
    return this.local.getStore() ?? SAMPLE_IDENTITY;
  }
  get companyId() {
    this.assertMember();
    return this.identity.companyId;
  }
  assertMember(admin = false) {
    const identity = this.identity;
    const membership = identity.memberships.find(
      (m) => m.companyId === identity.companyId && m.userId === identity.userId,
    );
    if (
      !this.companies.has(identity.companyId) ||
      !membership ||
      !["admin", "member", "viewer"].includes(membership.role) ||
      (admin && membership.role !== "admin")
    )
      throw new ForbiddenException("회사 접근 권한이 없습니다.");
  }
  settings() {
    this.assertMember();
    return structuredClone(this.companies.get(this.companyId)!);
  }
  run<T>(identity: CompanyIdentity, work: () => T): T {
    return this.local.run(structuredClone(identity), () => {
      this.assertMember();
      return work();
    });
  }
  configure(company: Company) {
    this.assertMember(true);
    if (company.id !== this.companyId)
      throw new ForbiddenException("현재 회사의 설정만 변경할 수 있습니다.");
    this.companies.set(company.id, structuredClone(company));
  }
  // Server-only provisioning port; deliberately has no public company-registration route.
  register(company: Company) {
    if (!/^[a-zA-Z0-9_-]+$/.test(company.id))
      throw new Error("Invalid company ID");
    if (this.companies.has(company.id))
      throw new Error("Company already exists");
    this.companies.set(company.id, structuredClone(company));
  }
}
