import { FinanceService } from "./finance.service";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AuditAction, AuditTarget, AuditValue } from "@jongno/shared";
import { CompanyContext } from "./company-context";
import { AUDIT_REPOSITORY, AuditRepository } from "./audit.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import { EXPENSES_REPOSITORY, ExpensesRepository } from "./expenses.repository";
interface Operation {
  action?: AuditAction;
  reason?: string;
  siteIds?: string[];
}
export interface AuditEvent {
  targetType: AuditTarget;
  targetId: string;
  action: AuditAction;
  before: unknown;
  after: unknown;
  siteIds?: string[];
  reason?: string;
}
export function auditValue(value: unknown): AuditValue {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return { size: value.length };
  if (Array.isArray(value)) return value.map(auditValue);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, auditValue(v)]),
    );
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  return String(value);
}
@Injectable()
export class AuditRecorder {
  private readonly operation = new AsyncLocalStorage<Operation>();
  private readonly sequences = new Map<string, number>();
  constructor(
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository,
    @Inject(ModuleRef) private readonly modules: ModuleRef,
  ) {}
  withOperation<T>(operation: Operation, work: () => T) {
    return this.operation.run(
      { ...this.operation.getStore(), ...operation },
      work,
    );
  }
  get reason() {
    return this.operation.getStore()?.reason ?? "";
  }
  get action() {
    return this.operation.getStore()?.action;
  }
  private get<T>(token: symbol): T {
    return this.modules.get<T>(token, { strict: false });
  }
  sitesFor(kind: AuditTarget, record: unknown): string[] {
    if (!record || typeof record !== "object") return [];
    const r = record as Record<string, unknown>;
    if (kind === "현장") return typeof r.id === "string" ? [r.id] : [];
    const ids = [r.siteId, r.convertedSiteId].filter(
      (id): id is string => typeof id === "string" && !!id,
    );
    if (typeof r.dailyWorkId === "string") {
      const work = this.get<DailyWorkRepository>(DAILY_WORK_REPOSITORY).find(
        r.dailyWorkId,
      );
      if (work) ids.push(work.siteId);
    }
    if (kind === "작업진행자" && typeof r.id === "string") {
      ids.push(
        ...this.get<SitesRepository>(SITES_REPOSITORY)
          .list()
          .filter((s) => s.managerId === r.id)
          .map((s) => s.id),
      );
      ids.push(
        ...this.get<DailyWorkRepository>(DAILY_WORK_REPOSITORY)
          .list()
          .filter(
            (w) =>
              w.managerId === r.id ||
              w.participants.some((p) => p.workerId === r.id),
          )
          .map((w) => w.siteId),
      );
      ids.push(
        ...this.get<ExpensesRepository>(EXPENSES_REPOSITORY)
          .list()
          .filter((e) => e.workerId === r.id)
          .map((e) => e.siteId),
      );
    }
    return [...new Set(ids)];
  }
  settlementState(siteId: string, workerId: string) {
    const rows = this.modules
      .get(FinanceService, { strict: false })
      .settlements(siteId, workerId).rows;
    const row = rows.find(
      (r) => r.siteId === siteId && r.workerId === workerId,
    );
    return {
      siteId,
      workerId,
      totalPayable: row?.totalPayable ?? 0,
      paidAmount: row?.paidAmount ?? 0,
      unpaidAmount: row?.unpaidAmount ?? 0,
      status: row?.status ?? "미지급",
    };
  }
  record(event: AuditEvent) {
    const identity = this.company.identity;
    const companyId = this.company.companyId;
    const sequence = (this.sequences.get(companyId) ?? 0) + 1;
    this.sequences.set(companyId, sequence);
    const siteIds = [
      ...new Set(
        (event.siteIds?.length
          ? event.siteIds
          : this.operation.getStore()?.siteIds) ?? [
          ...this.sitesFor(event.targetType, event.before),
          ...this.sitesFor(event.targetType, event.after),
        ],
      ),
    ];
    const sites = this.get<SitesRepository>(SITES_REPOSITORY);
    this.repository.append({
      id: randomUUID(),
      companyId,
      userId: identity.userId,
      userDisplayName:
        identity.userDisplayName ??
        (identity.userId === "sample-admin" ? "샘플 관리자" : identity.userId),
      targetType: event.targetType,
      targetId: event.targetId,
      action: event.action,
      before: auditValue(event.before),
      after: auditValue(event.after),
      changedAt: new Date().toISOString(),
      sequence,
      reason:
        this.reason || event.reason || `${event.targetType} ${event.action}`,
      siteIds,
      sites: siteIds.map((id) => ({ id, name: sites.find(id)?.name ?? id })),
    });
  }
}
