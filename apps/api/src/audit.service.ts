import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AUDIT_ACTIONS, AUDIT_TARGETS, AuditPage } from "@jongno/shared";
import { CompanyContext } from "./company-context";
import { AUDIT_REPOSITORY, AuditRepository } from "./audit.repository";
import { AUDIT_ACCESS, AuditAccess } from "./audit-access";
import { validDate } from "./date";
@Injectable()
export class AuditService {
  constructor(
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository,
    @Inject(AUDIT_ACCESS) private readonly access: AuditAccess,
  ) {}
  list(query: Record<string, unknown> = {}, siteId?: string): AuditPage {
    if (siteId) this.access.assertSite(siteId);
    else this.access.assertAll();
    const allowed = new Set([
      "from",
      "to",
      "userId",
      "siteId",
      "action",
      "targetType",
      "page",
      "pageSize",
    ]);
    if (Object.keys(query).some((k) => !allowed.has(k)))
      throw new BadRequestException("알 수 없는 조회 필터입니다.");
    if (
      ["page", "pageSize"].some(
        (k) =>
          query[k] !== undefined &&
          typeof query[k] !== "string" &&
          typeof query[k] !== "number",
      )
    )
      throw new BadRequestException("조회 페이지를 확인해 주세요.");
    const str = (key: string) => {
      const v = query[key] ?? "";
      if (typeof v !== "string" || v.length > 300)
        throw new BadRequestException("조회 필터를 확인해 주세요.");
      return v;
    };
    const from = str("from"),
      to = str("to"),
      userId = str("userId"),
      site = str("siteId"),
      action = str("action"),
      target = str("targetType");
    if (
      (from && !validDate(from)) ||
      (to && !validDate(to)) ||
      (from && to && from > to) ||
      (action && !AUDIT_ACTIONS.includes(action as never)) ||
      (target && !AUDIT_TARGETS.includes(target as never))
    )
      throw new BadRequestException("조회 필터를 확인해 주세요.");
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 25);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException("조회 페이지를 확인해 주세요.");
    if (siteId && site && site !== siteId)
      throw new BadRequestException("현장 조회 범위가 다릅니다.");
    const all = this.repository
      .list(this.company.companyId)
      .filter((r) => !siteId || r.siteIds.includes(siteId));
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });
    const rows = all
      .filter((r) => {
        const day = date.format(new Date(r.changedAt));
        return (
          (!from || day >= from) &&
          (!to || day <= to) &&
          (!userId || r.userId === userId) &&
          (!(siteId || site) || r.siteIds.includes(siteId || site)) &&
          (!action || r.action === action) &&
          (!target || r.targetType === target)
        );
      })
      .sort((a, b) => b.sequence - a.sequence);
    const users = new Map(
      all.map((r) => [r.userId, { id: r.userId, name: r.userDisplayName }]),
    );
    const sites = new Map(
      all
        .flatMap((r) => r.sites)
        .filter((s) => !siteId || s.id === siteId)
        .map((s) => [s.id, s]),
    );
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
        ...r,
        siteIds: siteId ? [siteId] : r.siteIds,
        sites: siteId ? r.sites.filter((s) => s.id === siteId) : r.sites,
        before: this.access.snapshot(r.before),
        after: this.access.snapshot(r.after),
      })),
      total: rows.length,
      page,
      pageSize,
      users: [...users.values()],
      sites: [...sites.values()],
    };
  }
}
