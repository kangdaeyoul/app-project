import {
  AS_REPOSITORY,
  AfterServiceRepository,
} from "./after-service.repository";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Post,
  Put,
  Param,
  Query,
} from "@nestjs/common";
import { ScheduleEvent, WorkerSchedule, WORKER_COLORS } from "@jongno/shared";
import { CompanyContext } from "./company-context";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { DailyWorkService } from "./daily-work.service";
import { validDate, seoulToday } from "./date";
@Injectable()
export class WorkerScheduleService {
  constructor(
    @Inject(AS_REPOSITORY) private asRepo: AfterServiceRepository,
    @Inject(CompanyContext) private context: CompanyContext,
    @Inject(DAILY_WORK_REPOSITORY) private daily: DailyWorkRepository,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(DailyWorkService) private work: DailyWorkService,
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
  private canEdit() {
    return (
      !this.context.identity.workerId &&
      (this.admin() ||
        (this.role() === "member" &&
          this.context.identity.canEditSchedule === true))
    );
  }
  private allowed(siteId: string) {
    return (
      this.admin() ||
      this.context.identity.accessibleSiteIds === undefined ||
      this.context.identity.accessibleSiteIds.includes(siteId)
    );
  }
  list(from = seoulToday(), to = from): WorkerSchedule {
    this.context.assertMember();
    if (
      !validDate(from) ||
      !validDate(to) ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 62 * 86400000
    )
      throw new BadRequestException("조회기간은 최대 63일입니다.");
    const identity = this.context.identity;
    const sites = this.sites
      .list()
      .filter((s) => !s.deletedAt && this.allowed(s.id));
    const source = this.daily
      .list()
      .filter((d) => sites.some((s) => s.id === d.siteId));
    const events: ScheduleEvent[] = source
      .filter((d) => d.workDate >= from && d.workDate <= to)
      .map((d) => ({
        id: d.id,
        dailyWorkId: d.id,
        siteId: d.siteId,
        siteName: d.siteName,
        date: d.workDate,
        start: d.plannedStartTime || d.startTime,
        end: d.plannedEndTime || d.endTime,
        status: d.urgent
          ? "긴급"
          : d.reviewRequired
            ? "확인필요"
            : d.scheduleKind && d.scheduleKind !== "작업"
              ? "견적방문·현장확인"
              : d.status === "작업중"
                ? "작업중"
                : d.status === "작업예정"
                  ? "배정완료"
                  : "완료",
        workStatus: d.status,
        urgent: !!d.urgent,
        content: d.content,
        trades: sites.find((s) => s.id === d.siteId)?.trades ?? [],
        managerId: d.managerId,
        workerIds: [
          ...new Set([d.managerId, ...d.participants.map((p) => p.workerId)]),
        ],
        kind: d.scheduleKind ?? "작업",
      }));
    // Sites are a fallback projection, never a second schedule collection.
    for (
      let day = from;
      day <= to;
      day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)
    )
      for (const s of sites) {
        if (
          day < s.startDate ||
          day > (s.endDate || s.startDate) ||
          source.some((d) => d.siteId === s.id && d.workDate === day)
        )
          continue;
        events.push({
          id: `site:${s.id}:${day}`,
          siteId: s.id,
          siteName: s.name,
          date: day,
          start: "",
          end: "",
          status: !s.managerId
            ? "미배정"
            : s.status === "완료"
              ? "완료"
              : "배정완료",
          workStatus: s.status,
          urgent: false,
          content: s.description,
          trades: s.trades ?? [],
          managerId: s.managerId ?? null,
          workerIds: s.managerId ? [s.managerId] : [],
          kind: "현장 예정",
        });
      }
    const asRows = this.asRepo
      .list()
      .filter((a) => !a.deletedAt && sites.some((s) => s.id === a.siteId));
    for (const e of events) {
      const a = asRows.find((a) => a.workIds.includes(e.dailyWorkId ?? ""));
      if (a) {
        e.asId = a.id;
        e.asNumber = a.number;
      }
    }
    for (const a of asRows.filter(
      (a) =>
        a.plannedDate >= from &&
        a.plannedDate <= to &&
        !a.workIds.some((id) =>
          source.some((d) => d.id === id && d.workDate === a.plannedDate),
        ),
    ))
      events.push({
        id: `as:${a.id}`,
        asId: a.id,
        asNumber: a.number,
        siteId: a.siteId,
        siteName: sites.find((s) => s.id === a.siteId)!.name,
        date: a.plannedDate,
        start: a.plannedStart,
        end: a.plannedEnd,
        status: a.urgent ? "긴급" : a.managerId ? "배정완료" : "미배정",
        urgent: a.urgent,
        content: a.request,
        trades: [],
        managerId: a.managerId || null,
        workerIds: [a.managerId, ...a.participantIds].filter(Boolean),
        kind: "A/S",
      });
    const visible = events.filter(
      (e) => !identity.workerId || e.workerIds.includes(identity.workerId),
    );
    const referenced = new Set(visible.flatMap((e) => e.workerIds));
    return {
      companyId: this.context.companyId,
      events: visible.sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
      ),
      workers: this.workers
        .list()
        .filter(
          (w) =>
            (!identity.workerId || w.id === identity.workerId) &&
            (!identity.accessibleSiteIds ||
              this.canEdit() ||
              referenced.has(w.id)) &&
            (!w.deletedAt || referenced.has(w.id)),
        )
        .map((w, i) => ({
          id: w.id,
          displayName: w.displayName,
          color: w.color ?? WORKER_COLORS[i % WORKER_COLORS.length],
          inactive: !!w.deletedAt,
          defaultAvailability: w.defaultAvailability,
          availability: this.workers
            .availability(w.id)
            .filter((a) => a.date >= from && a.date <= to),
        })),
      canEdit: this.canEdit(),
      canForce: this.admin(),
    };
  }
  private edit() {
    this.context.assertMember();
    if (!this.canEdit())
      throw new ForbiddenException("일정 배정 권한이 없습니다.");
  }
  color(id: string, body: { color?: unknown }) {
    this.context.assertMember(true);
    if (this.context.identity.workerId) throw new ForbiddenException();
    const worker = this.workers.find(id);
    if (
      !worker ||
      typeof body?.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(body.color)
    )
      throw new BadRequestException("작업진행자와 색상을 확인해 주세요.");
    return this.workers.update(id, { ...worker, color: body.color });
  }
  assign(body: Record<string, unknown>) {
    this.edit();
    if (!body || Array.isArray(body))
      throw new BadRequestException("입력값을 확인해 주세요.");
    const site = this.sites.find(String(body.siteId));
    if (!site || site.deletedAt || !this.allowed(site.id))
      throw new BadRequestException("배정 가능한 현장을 선택해 주세요.");
    const linkedAs = body.asId
      ? this.asRepo.find(String(body.asId))
      : undefined;
    if (
      body.asId &&
      (!linkedAs ||
        linkedAs.deletedAt ||
        linkedAs.siteId !== site.id ||
        linkedAs.status === "종결")
    )
      throw new BadRequestException("A/S 연결을 확인해 주세요.");
    const date = String(body.date),
      start = String(body.start ?? ""),
      end = String(body.end ?? "");
    if (
      !validDate(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      start >= end
    )
      throw new BadRequestException(
        "작업일자와 시작·종료 예정시간을 확인해 주세요.",
      );
    if (
      !Array.isArray(body.participantIds) ||
      body.participantIds.length > 100 ||
      body.participantIds.some((id) => typeof id !== "string")
    )
      throw new BadRequestException("참여 작업자를 확인해 주세요.");
    const managerId = String(body.managerId),
      ids = [...new Set([managerId, ...(body.participantIds as string[])])];
    if (
      ids.some(
        (id) => !this.workers.find(id) || this.workers.find(id)!.deletedAt,
      )
    )
      throw new BadRequestException("활성 작업진행자를 선택해 주세요.");
    const existing = body.dailyWorkId
      ? this.daily.find(String(body.dailyWorkId))
      : undefined;
    if (body.dailyWorkId && (!existing || existing.siteId !== site.id))
      throw new BadRequestException("일일작업 연결을 확인해 주세요.");
    if (linkedAs && existing && !linkedAs.workIds.includes(existing.id)) throw new BadRequestException("A/S에 연결된 처리작업을 선택해 주세요.");
    const warnings: string[] = [];
    // Use all company work for conflict detection, including work outside staff view scope.
    for (const id of ids) {
      const worker = this.workers.find(id)!;
      const availability =
        this.workers.availability(id).find((a) => a.date === date)?.status ??
        worker.defaultAvailability;
      if (
        availability === "휴무" ||
        (availability === "오전불가" && start < "12:00") ||
        (availability === "오후불가" && end > "12:00")
      )
        warnings.push(`${worker.displayName}: ${availability}와 충돌합니다.`);
      for (const d of this.daily
        .list()
        .filter(
          (d) =>
            d.id !== existing?.id &&
            d.workDate === date &&
            (d.managerId === id ||
              d.participants.some((p) => p.workerId === id)),
        )) {
        const s = d.plannedStartTime || d.startTime,
          e = d.plannedEndTime || d.endTime;
        if (!s || !e || (start < e && end > s))
          warnings.push(
            `${worker.displayName}: 다른 일정과 시간이 중복되거나 종료시간이 미정입니다.`,
          );
      }
      for (const s of this.sites
        .list()
        .filter(
          (s) =>
            s.id !== site.id &&
            s.managerId === id &&
            s.startDate <= date &&
            (s.endDate || s.startDate) >= date &&
            !this.daily
              .list()
              .some((d) => d.siteId === s.id && d.workDate === date),
        ))
        warnings.push(
          `${worker.displayName}: 시간이 미정인 현장 예정이 있습니다.`,
        );
    }
    if (body.force === true && !this.admin())
      throw new ForbiddenException(
        "관리자만 충돌을 확인하고 강제 저장할 수 있습니다.",
      );
    if (warnings.length && body.force !== true)
      throw new ConflictException({
        message: "배정 충돌을 확인해 주세요.",
        warnings,
      });
    const input = {
      ...existing,
      workDate: date,
      siteId: site.id,
      managerId,
      participantIds: (body.participantIds as string[]).filter(
        (id) => id !== managerId,
      ),
      plannedStartTime: start,
      plannedEndTime: end,
      content: String(body.content ?? existing?.content ?? site.description),
      notes:
        (existing?.notes ?? "") +
        (warnings.length && body.force === true
          ? "\n[관리자 충돌 확인 후 배정] " + warnings.join(" / ")
          : ""),
      startTime: existing?.startTime ?? "",
      endTime: existing?.endTime ?? "",
      status: existing?.status ?? "작업예정",
      urgent: body.urgent ?? existing?.urgent ?? false,
      scheduleKind: body.kind ?? existing?.scheduleKind ?? "작업",
      reviewRequired: body.reviewRequired ?? existing?.reviewRequired ?? false,
    };
    const saved = existing
      ? this.work.update(existing.id, input)
      : this.work.create(input);
    const asRecord =
      linkedAs ?? this.asRepo.list().find((a) => a.workIds.includes(saved.id));
    if (asRecord)
      this.asRepo.save({
        ...asRecord,
        workIds: [...new Set([...asRecord.workIds, saved.id])],
        status: asRecord.status === "접수" ? "일정예정" : asRecord.status,
        plannedDate: date,
        plannedStart: start,
        plannedEnd: end,
        managerId,
        participantIds: saved.participants.map((p) => p.workerId),
        urgent: !!saved.urgent,
        updatedAt: new Date().toISOString(),
      });
    if (!site.managerId)
      this.sites.update(site.id, {
        ...site,
        managerId,
        manager: this.workers.find(managerId)!.displayName,
        status: "진행중",
      });
    return { work: saved, warnings };
  }
}
@Controller("worker-schedule")
export class WorkerScheduleController {
  constructor(
    @Inject(WorkerScheduleService) private service: WorkerScheduleService,
  ) {}
  @Get() list(@Query("from") from?: string, @Query("to") to?: string) {
    return this.service.list(from, to);
  }
  @Post("assign") assign(@Body() body: Record<string, unknown>) {
    return this.service.assign(body);
  }
  @Put("workers/:id/color") color(
    @Param("id") id: string,
    @Body() body: { color?: unknown },
  ) {
    return this.service.color(id, body);
  }
}
