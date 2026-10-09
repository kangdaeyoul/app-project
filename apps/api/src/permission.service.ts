import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { CompanyContext } from "./company-context";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import {
  AS_REPOSITORY,
  AfterServiceRepository,
} from "./after-service.repository";
@Injectable()
export class PermissionService {
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(DAILY_WORK_REPOSITORY) private daily: DailyWorkRepository,
    @Inject(AS_REPOSITORY) private as: AfterServiceRepository,
  ) {}
  get identity() {
    return this.company.identity;
  }
  get admin() {
    return !this.identity.authenticated || this.identity.appRole === "admin";
  }
  has(permission: string) {
    return (
      this.admin ||
      (this.identity.appRole === "staff" &&
        this.identity.permissions?.includes(permission) === true)
    );
  }
  allowedSite(id: string) {
    const i = this.identity;
    if (this.admin) return !!this.sites.find(id);
    if (i.workerId)
      return (
        this.sites.find(id)?.managerId === i.workerId ||
        this.daily
          .list()
          .some(
            (d) =>
              d.siteId === id &&
              (d.managerId === i.workerId ||
                d.participants.some((p) => p.workerId === i.workerId)),
          ) ||
        this.as
          .list()
          .some(
            (a) =>
              a.siteId === id &&
              !a.deletedAt &&
              (a.managerId === i.workerId ||
                a.participantIds.includes(i.workerId!)),
          )
      );
    return i.accessibleSiteIds?.includes(id) === true;
  }
  site(id: string) {
    if (!this.allowedSite(id))
      throw new ForbiddenException(
        "배정 또는 허용된 현장만 조회할 수 있습니다.",
      );
  }
  dailyWork(id: string) {
    const d = this.daily.find(id);
    if (!d) throw new ForbiddenException("접근할 수 없는 작업입니다.");
    this.site(d.siteId);
    if (
      this.identity.workerId &&
      d.managerId !== this.identity.workerId &&
      !d.participants.some((p) => p.workerId === this.identity.workerId)
    )
      throw new ForbiddenException("본인 배정 작업만 이용할 수 있습니다.");
    return d;
  }
  authorize(controller: string, method: string, req: any) {
    if (!this.identity.authenticated) return;
    if (this.identity.appRole === "customer")
      throw new ForbiddenException("고객 기능은 준비 중입니다.");
    if (this.admin) return;
    if (
      req.query?.workerId &&
      this.identity.workerId &&
      req.query.workerId !== this.identity.workerId
    )
      throw new ForbiddenException(
        "다른 작업진행자 정보는 조회할 수 없습니다.",
      );
    const permitted = [
      "AuthController",
      "OperationalController",
      "WorkInstructionController",
      "AfterServiceController",
      "WorkerScheduleController",
      "PhotoController",
    ];
    if (controller === "SitesController" && req.method === "GET")
      permitted.push(controller);
    if (controller === "DailyWorkController" && req.method === "GET")
      permitted.push(controller);
    if (controller === "CompanyController" && req.method === "GET")
      permitted.push(controller);
    if (
      this.identity.appRole === "staff" &&
      [
        "CompletionReportController",
        "PhotoReportController",
        "InspectionReportController",
      ].includes(controller)
    )
      permitted.push(controller);
    if (
      controller === "QuotesController" &&
      this.has("writeQuotes") &&
      !["remove", "convert"].includes(method)
    )
      permitted.push(controller);
    if (!permitted.includes(controller))
      throw new ForbiddenException("이 기능의 권한이 없습니다.");
    if (
      controller === "DailyWorkController" &&
      method === "materials" &&
      this.identity.workerId
    )
      throw new ForbiddenException("본인 작업의 사용자재를 확인해 주세요.");
    if (req.params?.siteId) this.site(req.params.siteId);
    if (controller === "SitesController" && req.params?.id)
      this.site(req.params.id);
    if (controller === "DailyWorkController" && req.params?.id)
      this.dailyWork(req.params.id);
    if (controller === "DailyWorkController" && req.query?.siteId)
      this.site(req.query.siteId);
  }
  siteView(value: any) {
    const result: any = {};
    for (const key of [
      "id",
      "companyId",
      "name",
      "client",
      "clientId",
      "address",
      "contactName",
      "phone",
      "description",
      "startDate",
      "endDate",
      "managerId",
      "manager",
      "status",
      "trades",
      "tradeNames",
    ])
      if (value[key] !== undefined) result[key] = value[key];
    if (this.has("siteFinance"))
      for (const key of ["contractAmount", "collectedAmount"])
        if (value[key] !== undefined) result[key] = value[key];
    if (this.has("workerPayments") && value.unpaidWorkerAmount !== undefined)
      result.unpaidWorkerAmount = value.unpaidWorkerAmount;
    return result;
  }
  redact(value: any): any {
    if (
      this.admin ||
      value === null ||
      typeof value !== "object" ||
      Buffer.isBuffer(value)
    )
      return value;
    if (Array.isArray(value)) return value.map((v) => this.redact(v));
    const hidden = new Set<string>();
    if (!this.has("internalCosts"))
      [
        "internal",
        "materialUnitCost",
        "laborUnitCost",
        "expenseUnitCost",
        "internalGeneralCost",
        "internalSupportCost",
        "materialCost",
        "laborCost",
        "expenseCost",
        "generalCost",
        "supportCost",
        "totalCost",
        "margin",
        "marginRate",
        "cost",
        "purchasePrice",
        "recentPurchasePrice",
        "baseCost",
        "standardCost",
        "internalCosts",
        "priceHistory",
        "totalExpenses",
      ].forEach((k) => hidden.add(k));
    if (!this.has("siteFinance"))
      [
        "contractAmount",
        "collectedAmount",
        "unpaidWorkerAmount",
        "margin",
        "marginRate",
        "siteProfit",
        "profit",
        "receivables",
        "originalContractAmount",
        "originalConstructionCost",
        "originalProfit",
        "totalSiteProfit",
        "chargeAmount",
        "finance",
        "expenses",
        "totalAmountReceived",
        "unpaidAmountReceived",
      ].forEach((k) => hidden.add(k));
    if (!this.has("workerPayments"))
      [
        "workerPayments",
        "settlements",
        "settlementItems",
        "paidAmount",
        "unpaidAmount",
        "payableAmount",
        "totalPayable",
        "unpaidWorkerAmount",
      ].forEach((k) => hidden.add(k));
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !hidden.has(k))
        .map(([k, v]) => [k, this.redact(v)]),
    );
  }
  project(controller: string, data: any) {
    if (this.admin) return data;
    if (Array.isArray(data) && controller === "SitesController")
      data = data
        .filter((s) => this.allowedSite(s.id))
        .map((s) => this.siteView(s));
    if (Array.isArray(data) && controller === "DailyWorkController")
      data = data.filter(
        (d) =>
          this.allowedSite(d.siteId) &&
          (!this.identity.workerId ||
            d.managerId === this.identity.workerId ||
            d.participants.some(
              (p: any) => p.workerId === this.identity.workerId,
            )),
      );
    if (controller === "SitesController" && !Array.isArray(data))
      data = this.siteView(data);
    return controller === "OperationalController" ? data : this.redact(data);
  }
}
