import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CompanyContext } from "./company-context";
import { PermissionService } from "./permission.service";
import { SitesRepository, SITES_REPOSITORY } from "./sites.repository";
import { DailyWorkService } from "./daily-work.service";
import { FinanceService } from "./finance.service";
import {
  CustomersRepository,
  CUSTOMERS_REPOSITORY,
} from "./customers.repository";
import { QuotesService } from "./quotes.service";
import { WorkersRepository, WORKERS_REPOSITORY } from "./workers.repository";
@Controller("operational")
export class OperationalController {
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(PermissionService) private policy: PermissionService,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(DailyWorkService) private work: DailyWorkService,
    @Inject(FinanceService) private finance: FinanceService,
    @Inject(CUSTOMERS_REPOSITORY) private customers: CustomersRepository,
    @Inject(QuotesService) private quotes: QuotesService,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
  ) {}
  @Get("sites") list() {
    return this.sites
      .list()
      .filter((s) => !s.deletedAt && this.policy.allowedSite(s.id))
      .map((s) => this.policy.siteView(s));
  }
  @Get("daily-work") daily() {
    const own = this.company.identity.workerId;
    return this.work
      .list()
      .filter(
        (w) =>
          this.policy.allowedSite(w.siteId) &&
          (!own ||
            w.managerId === own ||
            w.participants.some((p) => p.workerId === own)),
      )
      .map((w) => this.policy.redact(w));
  }
  @Put("daily-work/:id") update(@Param("id") id: string, @Body() body: any) {
    const d = this.policy.dailyWork(id);
    if (d.status === "관리자확인완료" && !this.policy.admin)
      throw new ForbiddenException("관리자가 확인한 작업입니다.");
    if (!["작업예정", "작업중", "작업완료"].includes(body?.status))
      throw new ForbiddenException("작업 상태를 확인해 주세요.");
    return this.company.withOperationalWrite(() =>
      this.policy.redact(
        this.work.update(id, {
          ...d,
          participantIds: d.participants.map((p) => p.workerId),
          content: body.content,
          notes: body.notes,
          startTime: body.startTime,
          endTime: body.endTime,
          status: body.status,
          materials: body.materials,
          verificationNotes:body.verificationNotes,
          operationConfirmed:body.operationConfirmed,
        }),
      ),
    );
  }
  @Post("daily-work/:id/:action") clock(
    @Param("id") id: string,
    @Param("action") action: string,
  ) {
    this.policy.dailyWork(id);
    if (!["start", "finish"].includes(action)) throw new ForbiddenException();
    return this.company.withOperationalWrite(() =>
      this.policy.redact(this.work.clock(id, action as "start" | "finish")),
    );
  }
  @Get("settlements") settlements(@Query("month") month?: string) {
    const workerId = this.company.identity.workerId;
    if (!workerId)
      throw new ForbiddenException(
        "본인 정산은 연결된 작업진행자 계정에서 확인하세요.",
      );
    return this.finance.settlements(undefined, workerId, month);
  }
  @Get("quote-options") quoteOptions() {
    if (!this.policy.has("writeQuotes")) throw new ForbiddenException();
    const sites = this.sites
      .list()
      .filter((s) => !s.deletedAt && this.policy.allowedSite(s.id));
    return {
      sites: sites.map((s) => ({
        id: s.id,
        name: s.name,
        clientId: s.clientId ?? null,
        client: s.client,
        address: s.address,
        description: s.description,
      })),
      customers: this.customers
        .list()
        .filter((c) =>
          sites.some((s) => s.clientId === c.id || s.client === c.name),
        ),
    };
  }
  @Post("quotes") createQuote(@Body() body: any) {
    if (!this.policy.has("writeQuotes")) throw new ForbiddenException();
    this.policy.site(body?.siteId);
    return this.policy.redact(this.quotes.save(body));
  }
  @Get("site-finance/:siteId") siteFinance(@Param("siteId") id: string) {
    this.policy.site(id);
    if (
      !["siteFinance", "internalCosts", "workerPayments"].some((p) =>
        this.policy.has(p),
      )
    )
      throw new ForbiddenException("금액 조회 권한이 없습니다.");
    const f = this.finance.siteFinance(id),
      result: Record<string, unknown> = { siteId: id };
    if (this.policy.has("siteFinance"))
      for (const k of [
        "contractAmount",
        "collectedAmount",
        "receivables",
        "siteProfit",
      ] as const)
        result[k] = f[k];
    if (this.policy.has("internalCosts"))
      for (const k of [
        "directMaterials",
        "materialAdvances",
        "labor",
        "other",
        "totalExpenses",
      ] as const)
        result[k] = f[k];
    if (this.policy.has("workerPayments"))
      result.unpaidWorkerAmount = f.unpaidWorkerAmount;
    return result;
  }
  @Get("site-settlements/:siteId") siteSettlements(
    @Param("siteId") id: string,
  ) {
    this.policy.site(id);
    if (!this.policy.has("workerPayments"))
      throw new ForbiddenException("지급액 조회 권한이 없습니다.");
    const r = this.finance.settlements(id);
    return {
      ...r,
      workers: r.workers.filter((w) =>
        r.rows.some((s) => s.workerId === w.workerId),
      ),
    };
  }
  @Get("workers") workerOptions() {
    const own = this.company.identity.workerId;
    return this.workers
      .list()
      .filter((w) => !w.deletedAt && (!own || w.id === own))
      .map((w) => ({ id: w.id, displayName: w.displayName }));
  }
}
