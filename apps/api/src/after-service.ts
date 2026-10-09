import { WorkInstructionService } from "./work-instructions";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  Inject,
  Injectable,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { PDFDocument as MergePdf } from "pdf-lib";
import {
  AfterService,
  AfterServiceInput,
  AfterServiceView,
  AS_STATUSES,
  AS_TYPES,
  AS_PHOTO_PHASES,
} from "@jongno/shared";
import {
  AS_REPOSITORY,
  AfterServiceRepository,
} from "./after-service.repository";
import { CompanyContext } from "./company-context";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import { EXPENSES_REPOSITORY, ExpensesRepository } from "./expenses.repository";
import { QUOTES_REPOSITORY, QuotesRepository } from "./quotes.repository";
import {
  INSPECTION_REPORT_REPOSITORY,
  InspectionReportRepository,
} from "./inspection-report.repository";
import {
  COMPLETION_REPORT_STORAGE,
  CompletionReportStorage,
} from "./completion-report-storage";
import { FILE_STORAGE, FileStorage } from "./file-storage";
import { PhotoService, UploadFile } from "./photo.service";
import { PhotoReportService } from "./photo-report.service";
import { WorkerScheduleService } from "./worker-schedule";
import { DailyWorkService } from "./daily-work.service";
import { FinanceService } from "./finance.service";
import { QuotesService } from "./quotes.service";
import { AuditRecorder } from "./audit-recorder";
import { seoulToday, validDate } from "./date";
@Injectable()
export class AfterServiceService {
  constructor(
    @Inject(AS_REPOSITORY) private repo: AfterServiceRepository,
    @Inject(CompanyContext) private context: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
    @Inject(DAILY_WORK_REPOSITORY) private daily: DailyWorkRepository,
    @Inject(EXPENSES_REPOSITORY) private expenses: ExpensesRepository,
    @Inject(QUOTES_REPOSITORY) private quoteRepo: QuotesRepository,
    @Inject(INSPECTION_REPORT_REPOSITORY)
    private inspections: InspectionReportRepository,
    @Inject(COMPLETION_REPORT_STORAGE) private reports: CompletionReportStorage,
    @Inject(FILE_STORAGE) private files: FileStorage,
    @Inject(PhotoService) private photos: PhotoService,
    @Inject(PhotoReportService) private photoReports: PhotoReportService,
    @Inject(WorkerScheduleService) private schedule: WorkerScheduleService,
    @Inject(DailyWorkService) private work: DailyWorkService,
    @Inject(FinanceService) private finance: FinanceService,
    @Inject(QuotesService) private quotes: QuotesService,
    @Inject(AuditRecorder) private audit: AuditRecorder,
    @Inject(WorkInstructionService)
    private notifications: WorkInstructionService,
  ) {}
  private role() {
    return this.context.identity.memberships.find(
      (m) =>
        m.companyId === this.context.companyId &&
        m.userId === this.context.identity.userId,
    )?.role;
  }
  private admin() {
    return this.role() === "admin" && !this.context.identity.workerId;
  }
  private administrator() {
    this.context.assertMember(true);
    if (!this.admin()) throw new ForbiddenException();
  }
  private allowed(r: {
    siteId: string;
    managerId?: string;
    participantIds?: string[];
  }) {
    this.context.assertMember();
    const i = this.context.identity;
    return i.workerId
      ? r.managerId === i.workerId || r.participantIds?.includes(i.workerId)
      : this.admin() ||
          i.accessibleSiteIds === undefined ||
          i.accessibleSiteIds.includes(r.siteId);
  }
  private row(id: string) {
    const r = this.repo.find(id);
    if (!r || r.deletedAt)
      throw new NotFoundException("A/S를 찾을 수 없습니다.");
    if (!this.allowed(r))
      throw new ForbiddenException("이 A/S의 접근 권한이 없습니다.");
    return r;
  }
  private editor(r?: AfterService) {
    if (
      this.context.identity.workerId ||
      !["admin", "member"].includes(this.role() ?? "") ||
      (r && !this.allowed(r))
    )
      throw new ForbiddenException("A/S 관리 권한이 없습니다.");
  }
  private operator(r: AfterService) {
    if (!this.context.identity.workerId) this.editor(r);
  }
  private store(
    row: AfterService,
    before?: AfterService,
    action: "생성" | "수정" | "삭제" = "수정",
  ) {
    const saved = this.repo.save({
      ...row,
      statusHistory: [
        ...(before?.statusHistory ?? row.statusHistory ?? []),
        ...(before?.status !== row.status
          ? [
              {
                from: before?.status ?? "",
                to: row.status,
                changedAt: new Date().toISOString(),
                actorId: this.context.identity.userId,
                actorName:
                  this.context.identity.userDisplayName ??
                  this.context.identity.userId,
              },
            ]
          : []),
      ],
      updatedAt: new Date().toISOString(),
    });
    this.audit.record({
      targetType: "A/S",
      targetId: row.id,
      action,
      before: before ?? null,
      after: saved,
      siteIds: [row.siteId],
    });
    this.notifications.emitAfterService(saved, before);
    return saved;
  }
  settings() {
    return this.repo.settings();
  }
  configure(body: { states?: unknown }) {
    this.administrator();
    if (!Array.isArray(body?.states) || body.states.length > 40)
      throw new BadRequestException("상태 목록을 확인해 주세요.");
    const states = body.states as { key: string; label: string }[];
    if (
      states.some(
        (s) =>
          typeof s.key !== "string" ||
          !s.key ||
          s.key.length > 50 ||
          typeof s.label !== "string" ||
          !s.label ||
          s.label.length > 50,
      ) ||
      new Set(states.map((s) => s.key)).size !== states.length ||
      AS_STATUSES.some((key) => !states.some((s) => s.key === key))
    )
      throw new BadRequestException(
        "기본 상태 코드를 유지하고 표시명을 변경해 주세요.",
      );
    this.repo.configure(states);
    return states;
  }
  options() {
    const own = this.context.identity.workerId;
    const sites = this.sites
      .list()
      .filter(
        (s) =>
          !s.deletedAt &&
          (own
            ? this.repo
                .list()
                .some(
                  (a) => !a.deletedAt && a.siteId === s.id && this.allowed(a),
                )
            : this.allowed({ siteId: s.id })),
      );
    const ids = new Set(sites.map((s) => s.id));
    return {
      states: this.settings(),
      types: AS_TYPES,
      isWorker: !!own,
      canCreate: !own && ["admin", "member"].includes(this.role() ?? ""),
      canAssign:
        this.admin() ||
        (this.role() === "member" &&
          this.context.identity.canEditSchedule === true),
      canFinance: this.admin(),
      sites: sites.map((s) => ({
        id: s.id,
        name: s.name,
        client: s.client,
        address: s.address,
        phone: s.phone,
      })),
      workers: this.workers
        .list()
        .filter((w) => !w.deletedAt && (!own || w.id === own))
        .map((w) => ({ id: w.id, displayName: w.displayName })),
      works: this.daily
        .list()
        .filter(
          (w) =>
            ids.has(w.siteId) &&
            (!own ||
              w.managerId === own ||
              w.participants.some((p) => p.workerId === own)),
        )
        .map((w) => ({
          id: w.id,
          siteId: w.siteId,
          workDate: w.workDate,
          content: w.content,
          materials: w.materials,
        })),
      quotes: this.admin()
        ? this.quoteRepo
            .list()
            .filter((q) => q.siteId && ids.has(q.siteId))
            .map((q) => ({
              id: q.id,
              siteId: q.siteId,
              name: q.siteName,
              status: q.status,
            }))
        : [],
      inspections: sites.flatMap((s) =>
        this.inspections
          .list(s.id)
          .map((r) => ({ id: r.id, siteId: s.id, items: r.items })),
      ),
      previous: this.repo
        .list()
        .filter((r) => !r.deletedAt && this.allowed(r))
        .map((r) => ({
          id: r.id,
          siteId: r.siteId,
          number: r.number,
          location: r.location,
          equipment: r.equipment,
        })),
    };
  }
  list(siteId?: string) {
    return this.repo
      .list()
      .filter(
        (r) =>
          !r.deletedAt && (!siteId || r.siteId === siteId) && this.allowed(r),
      )
      .sort(
        (a, b) =>
          b.receivedDate.localeCompare(a.receivedDate) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .map((r) => this.view(r));
  }
  detail(id: string) {
    return this.view(this.row(id));
  }
  private view(r: AfterService): AfterServiceView {
    const site = this.sites.find(r.siteId)!;
    const own = !!this.context.identity.workerId;
    const { chargeAmount, ...publicRecord } = r;
    const expenses = this.expenses
      .list()
      .filter(
        (e) =>
          e.siteId === r.siteId &&
          !!e.dailyWorkId &&
          r.workIds.includes(e.dailyWorkId),
      );
    const f = this.admin() ? this.finance.siteFinance(r.siteId) : undefined;
    return {
      ...publicRecord,
      generatedQuoteIds: own ? [] : r.generatedQuoteIds,
      ...(this.admin() ? { chargeAmount } : {}),
      quoteIds: own ? [] : r.quoteIds,
      siteName: site.name,
      customerName: site.client,
      address: site.address,
      contactName: site.contactName,
      phone: site.phone,
      managerName: this.workers.find(r.managerId)?.displayName ?? "미배정",
      recurrenceCount: this.repo
        .list()
        .filter(
          (a) =>
            a.siteId === r.siteId &&
            a.location === r.location &&
            a.equipment === r.equipment &&
            !a.deletedAt,
        ).length,
      delayed:
        !!r.plannedDate &&
        r.plannedDate < seoulToday() &&
        !["처리완료", "종결"].includes(r.status),
      canEdit: !own && ["admin", "member"].includes(this.role() ?? ""),
      canFinance: this.admin(),
      canClose: this.admin(),
      photos: this.photos.list(r.siteId).filter((p) => p.asRequestId === r.id),
      relatedPhotos: this.photos
        .list(r.siteId)
        .filter((p) => r.originalPhotoIds.includes(p.id)),
      relatedMaterials: this.daily
        .list()
        .filter(
          (w) =>
            w.siteId === r.siteId &&
            (!own ||
              w.managerId === this.context.identity.workerId ||
              w.participants.some((p) => p.workerId === this.context.identity.workerId)),
        )
        .flatMap((w) => w.materials)
        .filter((m) => r.materialUsageIds.includes(m.id)),
      works: r.workIds
        .map((id) => this.daily.find(id))
        .filter((w): w is NonNullable<typeof w> => !!w),
      ...(f
        ? {
            expenses,
            financial: {
              originalRevenue: f.originalRevenue ?? f.contractAmount,
              originalCost: f.originalCost ?? f.totalExpenses,
              asCost: expenses.reduce((n, e) => n + e.totalAmount, 0),
              asRevenue: chargeAmount,
              totalProfit: f.siteProfit,
            },
          }
        : {}),
    };
  }
  save(body: unknown, id?: string) {
    const old = id ? this.row(id) : undefined;
    this.editor(old);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("입력값을 확인해 주세요.");
    const raw = body as Record<string, unknown>;
    const r: Record<string, unknown> = {};
    for (const key of [
      "siteId",
      "receivedDate",
      "receivedBy",
      "request",
      "location",
      "equipment",
      "type",
      "priority",
      "billing",
      "plannedDate",
      "plannedStart",
      "plannedEnd",
      "managerId",
      "status",
      "notes",
      "previousId",
      "cause",
      "action",
      "testResult",
      "completedDate",
      "result",
      "finalAction",
    ]) {
      const v = raw[key] ?? old?.[key as keyof AfterService] ?? "";
      if (typeof v !== "string" || v.length > 5000)
        throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
      r[key] = v.trim();
    }
    for (const key of [
      "urgent",
      "normalOperation",
      "needsVisit",
      "needsQuote",
      "resultConfirmed",
    ]) {
      const v = raw[key] ?? old?.[key as keyof AfterService] ?? false;
      if (typeof v !== "boolean")
        throw new BadRequestException("선택값을 확인해 주세요.");
      r[key] = v;
    }
    for (const key of [
      "participantIds",
      "quoteIds",
      "originalWorkIds",
      "inspectionIds",
      "originalPhotoIds",
      "materialUsageIds",
      "completionFileKeys",
      "workIds",
    ]) {
      const v = raw[key] ?? old?.[key as keyof AfterService] ?? [];
      if (
        !Array.isArray(v) ||
        v.length > 100 ||
        v.some((x) => typeof x !== "string") ||
        new Set(v).size !== v.length
      )
        throw new BadRequestException("연결 목록을 확인해 주세요.");
      r[key] = v;
    }
    const value = r as unknown as AfterServiceInput;
    const site = this.sites.find(value.siteId);
    if (!site || site.deletedAt || !this.allowed({ siteId: site.id }))
      throw new BadRequestException("접근 가능한 현장을 선택해 주세요.");
    if (old && old.siteId !== site.id)
      throw new BadRequestException("기존 A/S의 현장은 변경할 수 없습니다.");
    if (
      !validDate(value.receivedDate) ||
      !value.receivedBy ||
      !value.request ||
      !AS_TYPES.includes(value.type as (typeof AS_TYPES)[number]) ||
      !["무상", "유상", "판단보류"].includes(value.billing) ||
      !["일반", "높음", "긴급"].includes(value.priority) ||
      !this.settings().some((s) => s.key === value.status)
    )
      throw new BadRequestException(
        "접수일·접수자·요청내용·유형·상태를 확인해 주세요.",
      );
    for (const t of [value.plannedStart, value.plannedEnd])
      if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
        throw new BadRequestException("예정시간을 확인해 주세요.");
    for (const d of [value.plannedDate, value.completedDate])
      if (d && !validDate(d))
        throw new BadRequestException("날짜를 확인해 주세요.");
    const ids = [value.managerId, ...value.participantIds].filter(Boolean);
    if (
      ids.some(
        (id) =>
          !this.workers.find(id) ||
          (this.workers.find(id)!.deletedAt &&
            !old?.participantIds.includes(id) &&
            old?.managerId !== id),
      )
    )
      throw new BadRequestException("작업진행자를 확인해 주세요.");
    for (const id of [...value.originalWorkIds, ...value.workIds])
      if (this.daily.find(id)?.siteId !== site.id)
        throw new BadRequestException(
          "다른 현장의 일일작업은 연결할 수 없습니다.",
        );
    if (
      value.workIds.some((id) =>
        this.repo
          .list()
          .some((a) => a.id !== old?.id && a.workIds.includes(id)),
      )
    )
      throw new BadRequestException(
        "다른 A/S의 처리작업은 원작업으로만 참조할 수 있습니다.",
      );
    for (const id of value.quoteIds)
      if (this.quoteRepo.find(id)?.siteId !== site.id)
        throw new BadRequestException("견적 연결을 확인해 주세요.");
    for (const id of value.inspectionIds) {
      if (
        !this.inspections
          .list(site.id)
          .some((a) => a.id === id || a.items.some((i) => i.id === id))
      )
        throw new BadRequestException("점검지적 연결을 확인해 주세요.");
    }
    for (const id of value.originalPhotoIds)
      if (!this.photos.list(site.id).some((p) => p.id === id))
        throw new BadRequestException("사진 연결을 확인해 주세요.");
    for (const id of value.materialUsageIds)
      if (
        !this.daily
          .list()
          .filter((w) => w.siteId === site.id)
          .some((w) => w.materials.some((m) => m.id === id))
      )
        throw new BadRequestException("사용자재 연결을 확인해 주세요.");
    for (const key of value.completionFileKeys)
      if (
        !key.startsWith(`companies/${this.context.companyId}/${site.id}/`) ||
        !this.reports.get(key)
      )
        throw new BadRequestException("완료보고서 파일 연결을 확인해 주세요.");
    let parent = value.previousId;
    const seen = new Set([old?.id]);
    while (parent) {
      const p = this.repo.find(parent);
      if (!p || p.siteId !== site.id || seen.has(parent))
        throw new BadRequestException("이전 A/S 연결을 확인해 주세요.");
      seen.add(parent);
      parent = p.previousId;
    }
    const charge = raw.chargeAmount ?? old?.chargeAmount ?? 0;
    if (
      typeof charge !== "number" ||
      !Number.isSafeInteger(charge) ||
      charge < 0 ||
      (value.billing !== "유상" && charge !== 0)
    )
      throw new BadRequestException("확정 유상매출을 확인해 주세요.");
    if (
      !this.admin() &&
      (charge !== (old?.chargeAmount ?? 0) ||
        (old && value.billing !== old.billing))
    )
      throw new ForbiddenException(
        "유상/무상 변경과 매출 확정은 관리자 권한입니다.",
      );
    value.chargeAmount = charge;
    if (
      ["처리완료", "종결"].includes(value.status) &&
      (!value.completedDate || !value.result || !value.finalAction)
    )
      throw new BadRequestException(
        "완료일·처리결과·최종 조치내용을 입력해 주세요.",
      );
    if (
      !this.admin() &&
      value.resultConfirmed !== (old?.resultConfirmed ?? false)
    )
      throw new ForbiddenException("결과확인은 관리자 권한입니다.");
    if (
      value.status === "종결" &&
      (!this.admin() ||
        !old ||
        !["처리완료", "재확인필요", "종결"].includes(old.status) ||
        !value.resultConfirmed)
    )
      throw new ConflictException(
        "처리완료 후 관리자가 결과를 확인해야 종결할 수 있습니다.",
      );
    if (old?.status === "종결" && !this.admin())
      throw new ForbiddenException("종결된 A/S는 관리자가 수정합니다.");
    if (
      value.managerId &&
      value.plannedDate &&
      (!old ||
        !old.workIds.length ||
        [
          "plannedDate",
          "plannedStart",
          "plannedEnd",
          "managerId",
          "urgent",
        ].some(
          (k) =>
            value[k as keyof AfterServiceInput] !==
            old[k as keyof AfterService],
        ) ||
        JSON.stringify(value.participantIds) !==
          JSON.stringify(old.participantIds))
    ) {
      const current = old?.workIds
        .map((id) => this.daily.find(id))
        .find((w) => w?.status === "작업예정");
      const assigned = this.schedule.assign({
        siteId: site.id,
        dailyWorkId: current?.id,
        date: value.plannedDate,
        managerId: value.managerId,
        participantIds: value.participantIds,
        start: value.plannedStart,
        end: value.plannedEnd,
        kind: "작업",
        urgent: value.urgent,
        force: raw.force,
      },false);
      value.workIds = [...new Set([...value.workIds, assigned.work.id])];
      if (["접수", "확인중"].includes(value.status)) value.status = "일정예정";
    }
    const now = new Date().toISOString();
    const row: AfterService = {
      ...value,
      id: old?.id ?? randomUUID(),
      number:
        old?.number ??
        `AS-${seoulToday().replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      companyId: this.context.companyId,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      attachments: old?.attachments ?? [],
      generatedQuoteIds: old?.generatedQuoteIds ?? [],
    };
    this.store(row, old, old ? "수정" : "생성");
    if (value.workIds.length)
      this.photos.attachAsWork(row.id, value.workIds.at(-1)!);
    return this.detail(row.id);
  }
  remove(id: string) {
    this.administrator();
    const r = this.row(id);
    this.store({ ...r, deletedAt: new Date().toISOString() }, r, "삭제");
    return { deleted: true };
  }
  workUpdate(id: string, body: Record<string, unknown>) {
    const r = this.row(id);
    this.operator(r);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException();
    for (const key of ["cause", "action", "testResult", "notes"])
      if (
        body[key] !== undefined &&
        (typeof body[key] !== "string" || (body[key] as string).length > 5000)
      )
        throw new BadRequestException("처리 내용을 확인해 주세요.");
    const workId = String(body.dailyWorkId ?? r.workIds.at(-1) ?? "");
    if (!r.workIds.includes(workId))
      throw new BadRequestException("연결된 처리작업을 선택해 주세요.");
    if (r.status === "종결") throw new ConflictException("종결된 A/S입니다.");
    const w = this.work.find(workId);
    const own = this.context.identity.workerId;
    if(own&&body.status==="관리자확인완료")throw new ForbiddenException("관리자 확인은 관리자가 처리합니다.");
    if (
      own &&
      w.managerId !== own &&
      !w.participants.some((p) => p.workerId === own)
    )
      throw new ForbiddenException();
    const allowed = [
      "content",
      "notes",
      "startTime",
      "endTime",
      "status",
      "materials",
    ];
    const input = {
      ...w,
      participantIds: w.participants.map((p) => p.workerId),
      ...Object.fromEntries(
        allowed.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
      ),
    };
    this.context.withOperationalWrite(() => this.work.update(workId, input));
    const updated = { ...r };
    for (const key of ["cause", "action", "testResult", "notes"] as const)
      if (body[key] !== undefined) {
        if (typeof body[key] !== "string" || body[key].length > 5000)
          throw new BadRequestException("처리 내용을 확인해 주세요.");
        updated[key] = body[key] as string;
      }
    this.store(updated, r);
    return this.detail(id);
  }
  clock(id: string, action: "start" | "finish") {
    const r = this.row(id);
    this.operator(r);
    if (r.status === "종결") throw new ConflictException("종결된 A/S입니다.");
    const idWork = r.workIds.at(-1);
    if (!idWork) throw new BadRequestException("일정을 먼저 배정해 주세요.");
    const w = this.work.find(idWork);
    const own = this.context.identity.workerId;
    if (
      own &&
      w.managerId !== own &&
      !w.participants.some((p) => p.workerId === own)
    )
      throw new ForbiddenException();
    this.context.withOperationalWrite(() => this.work.clock(idWork, action));
    this.store({ ...r, status: action === "start" ? "작업중" : "확인중" }, r);
    return this.detail(id);
  }
  requestCompletion(id: string, raw: Record<string, unknown>) {
    const r = this.row(id);
    this.operator(r);
    if (r.status === "종결") throw new ConflictException("종결된 A/S입니다.");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new BadRequestException();
    const w = r.workIds.at(-1) ? this.daily.find(r.workIds.at(-1)!) : undefined;
    if (!w || (w.status !== "작업완료" && w.status !== "관리자확인완료"))
      throw new BadRequestException("처리작업을 먼저 완료해 주세요.");
    const own = this.context.identity.workerId;
    if (
      own &&
      w.managerId !== own &&
      !w.participants.some((p) => p.workerId === own)
    )
      throw new ForbiddenException();
    const read = (
      key: "cause" | "finalAction" | "testResult" | "result" | "notes",
      required = true,
    ) => {
      const v = raw[key] ?? r[key];
      if (typeof v !== "string" || v.length > 5000 || (required && !v.trim()))
        throw new BadRequestException(
          "원인, 최종 조치, 시험결과와 처리결과를 입력해 주세요.",
        );
      return v.trim();
    };
    const flags = {
      normalOperation: raw.normalOperation ?? r.normalOperation,
      needsVisit: raw.needsVisit ?? r.needsVisit,
      needsQuote: raw.needsQuote ?? r.needsQuote,
    };
    if (Object.values(flags).some((v) => typeof v !== "boolean"))
      throw new BadRequestException();
    const completedDate = raw.completedDate ?? seoulToday();
    if (typeof completedDate !== "string" || !validDate(completedDate))
      throw new BadRequestException("완료일을 확인해 주세요.");
    this.store(
      {
        ...r,
        cause: read("cause"),
        finalAction: read("finalAction"),
        testResult: read("testResult"),
        result: read("result"),
        notes: read("notes", false),
        normalOperation: flags.normalOperation === true,
        needsVisit: flags.needsVisit === true,
        needsQuote: flags.needsQuote === true,
        completedDate,
        status: "처리완료",
        resultConfirmed: false,
      },
      r,
    );
    return this.detail(id);
  }
  addPhotos(
    id: string,
    phase: string,
    body: Record<string, unknown>,
    files: UploadFile[],
  ) {
    const r = this.row(id);
    this.operator(r);
    if (!AS_PHOTO_PHASES.includes(phase as (typeof AS_PHOTO_PHASES)[number]))
      throw new BadRequestException("사진 구분을 확인해 주세요.");
    const workId = ["작업 전", "작업 후"].includes(phase)
      ? (r.workIds.at(-1) ?? "")
      : "";
    return this.context.withOperationalWrite(() =>
      this.photos.create(
        workId,
        phase === "작업 후" ? "작업 후" : "작업 전",
        {
          ...body,
          uploadedBy:
            this.context.identity.userDisplayName ??
            this.context.identity.userId,
          capturedAt: body.capturedAt ?? new Date().toISOString(),
        },
        files,
        { id: r.id, siteId: r.siteId, phase },
      ),
    );
  }
  photoFile(id: string, photoId: string) {
    const r = this.row(id);
    if (
      !this.photos
        .list(r.siteId)
        .some((p) => p.id === photoId && p.asRequestId === r.id)
    )
      throw new NotFoundException();
    return this.photos.file(photoId);
  }
  deletePhoto(id: string, photoId: string) {
    this.operator(this.row(id));
    this.photoFile(id, photoId);
    return this.context.withOperationalWrite(() => this.photos.remove(photoId));
  }
  attachments(id: string, files: UploadFile[]) {
    const r = this.row(id);
    this.operator(r);
    if (
      !files?.length ||
      files.some(
        (f) =>
          f.buffer.length > 10 * 1024 * 1024 ||
          ![
            "application/pdf",
            "image/png",
            "image/jpeg",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/x-hwp",
          ].includes(f.mimetype),
      )
    )
      throw new BadRequestException(
        "허용된 문서/사진을 파일당 10MB까지 등록해 주세요.",
      );
    const added = files.map((f) => {
      const idFile = randomUUID(),
        key = `companies/${this.context.companyId}/${r.siteId}/AS/${r.id}/attachments/${idFile}`;
      this.context.withOperationalWrite(() =>
        this.files.put(key, {
          buffer: f.buffer,
          mimeType: f.mimetype,
          originalFilename: f.originalname,
        }),
      );
      return {
        id: idFile,
        key,
        name: f.originalname.split(/[\\/]/).at(-1)!,
        size: f.buffer.length,
        mimeType: f.mimetype,
      };
    });
    this.store({ ...r, attachments: [...r.attachments, ...added] }, r);
    return this.detail(id);
  }
  attachment(id: string, fileId: string) {
    const r = this.row(id),
      meta = r.attachments.find((a) => a.id === fileId);
    if (!meta) throw new NotFoundException();
    const file = this.files.get(meta.key);
    if (!file) throw new NotFoundException();
    return { ...file, filename: meta.name };
  }
  createQuote(id: string) {
    this.administrator();
    const r = this.row(id);
    if (r.billing !== "유상")
      throw new BadRequestException("유상 A/S만 견적을 생성합니다.");
    const site = this.sites.find(r.siteId)!;
    const customer =
      this.quotes
        .customersList()
        .find((c) => c.id === site.clientId || c.name === site.client) ??
      this.quotes.createCustomer({
        name: site.client,
        address: site.address,
        contactName: site.contactName,
        phone: site.phone,
      });
    const q = this.quotes.save({
      customerId: customer.id,
      siteId: site.id,
      siteName: site.name,
      address: site.address,
      workContent: `[${r.number}] ${r.request}`,
      quoteDate: seoulToday(),
      validUntil: seoulToday(),
      status: "작성중",
      notes: "A/S 견적: 현장 확인 후 품목과 단가를 입력하세요.",
      generalFee: 0,
      supportFee: 0,
      internalGeneralCost: 0,
      internalSupportCost: 0,
      rounding: "천원 반올림",
      displayUnit: "만원",
      sections: [
        {
          kind: "전기",
          items: [
            {
              trade: "A/S",
              name: r.equipment || "A/S 보수",
              specification: r.location,
              quantity: 1,
              unit: "식",
              materialUnitCost: 0,
              laborUnitCost: 0,
              expenseUnitCost: 0,
              saleUnitPrice: 0,
              pricePending: true,
              priceCategory: "재료비",
              notes: "단가 확인 필요",
            },
          ],
        },
      ],
    });
    this.store(
      {
        ...r,
        quoteIds: [...r.quoteIds, q.id],
        generatedQuoteIds: [...r.generatedQuoteIds, q.id],
      },
      r,
    );
    return q;
  }
  async pdf(
    id: string,
    body: { mode?: string; date?: string; save?: boolean },
  ) {
    const r = this.row(id),
      v = this.detail(id);
    const mode = body.mode === "처리결과만" ? "처리결과 내역만" : body.mode ?? "처리결과 + 전후사진",
      date = body.date ?? seoulToday();
    if (
      !["처리결과 + 전후사진", "사진대지만", "처리결과 내역만"].includes(
        mode,
      ) ||
      !validDate(date)
    )
      throw new BadRequestException("출력 옵션을 확인해 주세요.");
    const selected = v.photos.filter((p) =>
      ["작업 전", "작업 후"].includes(p.asPhase ?? p.type),
    );
    if (mode === "사진대지만" && !selected.length)
      throw new BadRequestException("출력할 작업 전후사진이 없습니다.");
    const parts: Buffer[] = [];
    if (mode !== "사진대지만") {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const main = new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on("data", (b) => chunks.push(b));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });
      doc
        .registerFont(
          "Korean",
          join(__dirname, "../fixtures/fonts/NanumGothic-Regular.ttf"),
        )
        .font("Korean");
      doc.fontSize(20).text("A/S 처리결과 보고서", { align: "center" });
      doc
        .moveDown()
        .fontSize(11)
        .text(this.context.settings().name, { align: "right" });
      for (const [label, value] of [
        ["현장명", v.siteName],
        ["주소", v.address],
        ["A/S 번호", r.number],
        ["접수일", r.receivedDate],
        ["작업일", v.works.map((w) => w.workDate).join(", ")],
        ["요청내용", r.request],
        ["발생 위치", r.location],
        ["관련 설비", r.equipment],
        ["원인", r.cause],
        ["조치내용", r.action || r.finalAction],
        [
          "사용자재",
          v.works
            .flatMap((w) =>
              w.materials.map(
                (m) => `${m.name} ${m.specification} ${m.quantity}${m.unit}`,
              ),
            )
            .join("\n"),
        ],
        [
          "작업진행자",
          [
            v.managerName,
            ...r.participantIds.map((id) => this.workers.find(id)?.displayName),
          ].join(", "),
        ],
        ["시험 및 확인내용", r.testResult],
        ["정상작동 확인", r.normalOperation ? "확인" : "미확인"],
        ["완료일", r.completedDate],
        ["처리결과", r.result],
        ["최종 조치내용", r.finalAction],
        [
          "추가방문 / 추가견적",
          `${r.needsVisit ? "필요" : "없음"} / ${r.needsQuote ? "필요" : "없음"}`,
        ],
        ["작성일", date],
      ]) {
        doc.moveDown(0.7).fontSize(11).fillColor("#243d53").text(label);
        doc
          .fontSize(10)
          .fillColor("#405464")
          .text(value || "—", { width: 510 });
      }
      doc.end();
      parts.push(await main);
    }
    if (mode !== "처리결과 내역만" && selected.length) {
      const appendix = await this.photoReports.render(
        r.siteId,
        {
          selection: "선택한 사진만",
          photoIds: selected.map((p) => p.id),
          type: "",
          layout: "작업 전/후 비교형",
          createdDate: date,
          periodStart: v.works[0]?.workDate ?? r.receivedDate,
          periodEnd: v.works.at(-1)?.workDate ?? (r.completedDate || date),
          title: "A/S 전후 사진대지",
          companyName: this.context.settings().name,
          workContent: r.request,
          showNumber: true,
        },
        false,
      );
      parts.push(appendix.buffer);
    }
    const merged = await MergePdf.create();
    for (const part of parts) {
      const pdf = await MergePdf.load(part);
      for (const p of await merged.copyPages(pdf, pdf.getPageIndices()))
        merged.addPage(p);
    }
    const buffer = Buffer.from(await merged.save());
    const filename = `${v.siteName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")}_AS처리결과_${date}.pdf`;
    const key = `companies/${this.context.companyId}/${r.siteId}/07 AS/${r.id}/${randomUUID()}/${filename}`;
    if (body.save) {
      this.context.withOperationalWrite(() =>
        this.files.put(key, {
          buffer,
          mimeType: "application/pdf",
          originalFilename: filename,
        }),
      );
      this.audit.record({
        targetType: "파일",
        targetId: key,
        action: "생성",
        before: null,
        after: { filename, size: buffer.length },
        siteIds: [r.siteId],
      });
    }
    return { buffer, filename };
  }
}
@Controller("after-service")
export class AfterServiceController {
  constructor(
    @Inject(AfterServiceService) private service: AfterServiceService,
  ) {}
  @Get("options") options() {
    return this.service.options();
  }
  @Put("settings") settings(@Body() b: { states?: unknown }) {
    return this.service.configure(b);
  }
  @Get() list(@Query("siteId") s?: string) {
    return this.service.list(s);
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.service.detail(id);
  }
  @Post() create(@Body() b: unknown) {
    return this.service.save(b);
  }
  @Put(":id") update(@Param("id") id: string, @Body() b: unknown) {
    return this.service.save(b, id);
  }
  @Delete(":id") remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
  @Put(":id/work") work(
    @Param("id") id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.workUpdate(id, b);
  }
  @Post(":id/start") start(@Param("id") id: string) {
    return this.service.clock(id, "start");
  }
  @Post(":id/complete-request") complete(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.requestCompletion(id, body);
  }
  @Post(":id/finish") finish(@Param("id") id: string) {
    return this.service.clock(id, "finish");
  }
  @Post(":id/quote") quote(@Param("id") id: string) {
    return this.service.createQuote(id);
  }
  @Post(":id/photos/:phase")
  @UseInterceptors(
    FilesInterceptor("files", 20, { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  photos(
    @Param("id") id: string,
    @Param("phase") phase: string,
    @Body() b: Record<string, unknown>,
    @UploadedFiles() files: UploadFile[],
  ) {
    return this.service.addPhotos(id, phase, b, files);
  }
  @Delete(":id/photos/:photo") removePhoto(
    @Param("id") id: string,
    @Param("photo") p: string,
  ) {
    return this.service.deletePhoto(id, p);
  }
  @Get(":id/photos/:photo/file") photoFile(
    @Param("id") id: string,
    @Param("photo") p: string,
    @Res() res: any,
  ) {
    const f = this.service.photoFile(id, p);
    res.type(f.mimeType).send(f.buffer);
  }
  @Post(":id/attachments")
  @UseInterceptors(
    FilesInterceptor("files", 10, { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  attach(@Param("id") id: string, @UploadedFiles() f: UploadFile[]) {
    return this.service.attachments(id, f);
  }
  @Get(":id/attachments/:file") file(
    @Param("id") id: string,
    @Param("file") f: string,
    @Res() res: any,
  ) {
    const file = this.service.attachment(id, f);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.type(file.mimeType).send(file.buffer);
  }
  @Post(":id/report") async report(
    @Param("id") id: string,
    @Body() b: any,
    @Res() res: any,
  ) {
    const f = await this.service.pdf(id, b ?? {});
    res.setHeader(
      "Content-Disposition",
      `${b?.save ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    );
    res.type("application/pdf").send(f.buffer);
  }
}
