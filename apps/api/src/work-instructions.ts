import {
  Body,
  Controller,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Get,
  Post,
  Param,
  Query,
  Inject,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CompanyContext } from "./company-context";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import {
  AS_REPOSITORY,
  AfterServiceRepository,
} from "./after-service.repository";
export interface WorkInstruction {
  id: string;
  companyId: string;
  siteId: string;
  asId: string;
  senderId: string;
  senderName: string;
  title: string;
  content: string;
  sentAt: string;
  important: boolean;
  attachments: { fileKey: string; name: string }[];
  recipients: {
    workerId: string;
    displayName: string;
    readAt: string | null;
    readByUserId: string | null;
  }[];
  // Replies, approval and completion can become separate entities without changing delivery receipts.
}
export interface NotificationEvent {
  id: string;
  companyId: string;
  instructionId: string;
  recipientWorkerId: string;
  kind: "work_instruction";
  createdAt: string;
  deliveryStatus: "pending";
}
export const INSTRUCTION_REPOSITORY = Symbol("INSTRUCTION_REPOSITORY");
export interface InstructionRepository {
  messages(): WorkInstruction[];
  events(): NotificationEvent[];
  save(message: WorkInstruction): void;
  enqueue(event: NotificationEvent): void;
}
@Injectable()
export class MemoryInstructionRepository implements InstructionRepository {
  constructor(@Inject(CompanyContext) private context: CompanyContext) {}
  private companies = new Map<
    string,
    { messages: WorkInstruction[]; events: NotificationEvent[] }
  >();
  private partition() {
    const id = this.context.companyId;
    if (!this.companies.has(id))
      this.companies.set(id, { messages: [], events: [] });
    return this.companies.get(id)!;
  }
  messages() {
    return structuredClone(this.partition().messages);
  }
  events() {
    return structuredClone(this.partition().events);
  }
  save(row: WorkInstruction) {
    if (row.companyId !== this.context.companyId)
      throw new ForbiddenException();
    const rows = this.partition().messages;
    const i = rows.findIndex((r) => r.id === row.id);
    if (i < 0) rows.push(structuredClone(row));
    else rows[i] = structuredClone(row);
  }
  enqueue(row: NotificationEvent) {
    if (row.companyId !== this.context.companyId)
      throw new ForbiddenException();
    this.partition().events.push(structuredClone(row));
  }
}
@Injectable()
export class WorkInstructionService {
  constructor(
    @Inject(INSTRUCTION_REPOSITORY) private repo: InstructionRepository,
    @Inject(CompanyContext) private context: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
    @Inject(DAILY_WORK_REPOSITORY) private daily: DailyWorkRepository,
    @Inject(AS_REPOSITORY) private asRepo: AfterServiceRepository,
  ) {}
  private admin() {
    this.context.assertMember();
    return (
      !this.context.identity.workerId &&
      this.context.identity.memberships.some(
        (m) =>
          m.companyId === this.context.companyId &&
          m.userId === this.context.identity.userId &&
          m.role === "admin",
      )
    );
  }
  private scope(siteId: string) {
    return (
      this.admin() ||
      this.context.identity.accessibleSiteIds === undefined ||
      this.context.identity.accessibleSiteIds.includes(siteId)
    );
  }
  private target(siteId: string, asId = "") {
    const site = this.sites.find(siteId);
    if (!site || site.deletedAt)
      throw new BadRequestException("현장을 확인해 주세요.");
    const as = asId ? this.asRepo.find(asId) : undefined;
    if (asId && (!as || as.deletedAt || as.siteId !== siteId))
      throw new BadRequestException("A/S 연결을 확인해 주세요.");
    return { site, as };
  }
  private participants(siteId: string, asId = "") {
    const { site, as } = this.target(siteId, asId);
    return [
      ...new Set(
        as
          ? [as.managerId, ...as.participantIds]
          : [
              site.managerId,
              ...this.daily
                .list()
                .filter((d) => d.siteId === siteId)
                .flatMap((d) => [
                  d.managerId,
                  ...d.participants.map((p) => p.workerId),
                ]),
              ...this.asRepo
                .list()
                .filter((a) => !a.deletedAt && a.siteId === siteId)
                .flatMap((a) => [a.managerId, ...a.participantIds]),
            ],
      ),
    ].filter((id): id is string => !!id);
  }
  options(siteId: string, asId = "") {
    this.context.assertMember();
    if (!this.admin() || !this.scope(siteId))
      throw new ForbiddenException("관리자만 작업지시를 발송할 수 있습니다.");
    const ids = this.participants(siteId, asId);
    return this.workers
      .list()
      .filter((w) => (!asId || ids.includes(w.id)) && !w.deletedAt)
      .map((w) => ({
        id: w.id,
        name: w.displayName,
        participating: ids.includes(w.id),
      }));
  }
  private visible(row: WorkInstruction) {
    this.context.assertMember();
    return this.admin()
      ? this.scope(row.siteId)
      : !!this.context.identity.workerId &&
          row.recipients.some(
            (r) => r.workerId === this.context.identity.workerId,
          );
  }
  private view(row: WorkInstruction) {
    const site = this.sites.find(row.siteId);
    const recipients = this.admin()
      ? row.recipients
      : row.recipients.filter(
          (r) => r.workerId === this.context.identity.workerId,
        );
    return {
      ...row,
      recipients,
      siteName: site?.name ?? "삭제된 현장",
      address: site?.address ?? "",
      phone: site?.phone ?? "",
      asNumber: row.asId ? this.asRepo.find(row.asId)?.number : "",
      hasAttachments: row.attachments.length > 0,
      canSend: this.admin(),
      unread: recipients.some((r) => !r.readAt),
    };
  }
  list(siteId?: string, asId?: string) {
    this.context.assertMember();
    return this.repo
      .messages()
      .filter(
        (r) =>
          this.visible(r) &&
          (!siteId || r.siteId === siteId) &&
          (!asId || r.asId === asId),
      )
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
      .map((r) => this.view(r));
  }
  send(raw: Record<string, unknown>) {
    if (!this.admin())
      throw new ForbiddenException("관리자만 작업지시를 발송할 수 있습니다.");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new BadRequestException();
    const text = (key: string, max: number, required = false) => {
      const v = raw[key] ?? "";
      if (typeof v !== "string" || v.length > max || (required && !v.trim()))
        throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
      return v.trim().normalize("NFC");
    };
    const siteId = text("siteId", 100, true),
      asId = text("asId", 100),
      title = text("title", 200, true),
      content = text("content", 5000, true);
    if (raw.important !== undefined && typeof raw.important !== "boolean")
      throw new BadRequestException("중요 여부를 확인해 주세요.");
    const options = this.options(siteId, asId),
      allowed = new Set(options.map((w) => w.id));
    let ids: string[];
    if (raw.mode === "all")
      ids = options.filter((w) => w.participating).map((w) => w.id);
    else if (raw.mode === "as") {
      if (!asId) throw new BadRequestException("A/S를 선택해 주세요.");
      const a = this.target(siteId, asId).as!;
      ids = [a.managerId].filter(Boolean);
    } else if (raw.mode === "single" && typeof raw.workerId === "string")
      ids = [raw.workerId];
    else throw new BadRequestException("수신 방법을 확인해 주세요.");
    if (!ids.length || ids.some((id) => !allowed.has(id)))
      throw new BadRequestException(
        "해당 현장에 참여하는 활성 작업진행자를 선택해 주세요.",
      );
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const existing = this.repo
      .messages()
      .filter(
        (r) =>
          r.siteId === siteId &&
          r.asId === asId &&
          normalize(r.title) === normalize(title) &&
          normalize(r.content) === normalize(content),
      );
    const delivered = new Set(
      existing.flatMap((r) => r.recipients.map((p) => p.workerId)),
    );
    const newIds = ids.filter((id) => !delivered.has(id));
    if (!newIds.length)
      return { duplicate: true, sentCount: 0, message: this.view(existing[0]) };
    const sentAt = new Date().toISOString();
    const row: WorkInstruction = {
      id: randomUUID(),
      companyId: this.context.companyId,
      siteId,
      asId,
      senderId: this.context.identity.userId,
      senderName:
        this.context.identity.userDisplayName ?? this.context.identity.userId,
      title,
      content,
      sentAt,
      important: raw.important === true,
      attachments: [],
      recipients: newIds.map((workerId) => ({
        workerId,
        displayName: options.find((w) => w.id === workerId)!.name,
        readAt: null,
        readByUserId: null,
      })),
    };
    this.repo.save(row);
    for (const workerId of newIds)
      this.repo.enqueue({
        id: randomUUID(),
        companyId: row.companyId,
        instructionId: row.id,
        recipientWorkerId: workerId,
        kind: "work_instruction",
        createdAt: sentAt,
        deliveryStatus: "pending",
      });
    return {
      duplicate: false,
      sentCount: newIds.length,
      message: this.view(row),
    };
  }
  read(id: string) {
    this.context.assertMember();
    const row = this.repo.messages().find((r) => r.id === id);
    if (!row) throw new NotFoundException();
    const workerId = this.context.identity.workerId;
    if (!workerId || !row.recipients.some((r) => r.workerId === workerId))
      throw new ForbiddenException(
        "본인의 작업지시만 읽음 처리할 수 있습니다.",
      );
    const receipt = row.recipients.find((r) => r.workerId === workerId)!;
    if (!receipt.readAt) {
      receipt.readAt = new Date().toISOString();
      receipt.readByUserId = this.context.identity.userId;
      this.repo.save(row);
    }
    return this.view(row);
  }
  siteContext(siteId: string) {
    this.context.assertMember();
    if (!this.list(siteId).length && !this.admin())
      throw new ForbiddenException("배정 작업지시가 없는 현장입니다.");
    const site = this.sites.find(siteId);
    if (!site) throw new NotFoundException();
    return {
      id: site.id,
      name: site.name,
      address: site.address,
      phone: site.phone,
      contactName: site.contactName,
      description: site.description,
      works: this.daily
        .list()
        .filter(
          (d) =>
            d.siteId === siteId &&
            (this.admin() ||
              d.managerId === this.context.identity.workerId ||
              d.participants.some(
                (p) => p.workerId === this.context.identity.workerId,
              )),
        )
        .map((d) => ({
          id: d.id,
          date: d.workDate,
          content: d.content,
          status: d.status,
        })),
    };
  }
  notifications() {
    const workerId = this.context.identity.workerId;
    return this.list().flatMap((m) =>
      this.repo
        .events()
        .filter(
          (e) =>
            e.instructionId === m.id &&
            (!workerId || e.recipientWorkerId === workerId),
        )
        .map((e) => ({
          ...e,
          title: m.title,
          siteId: m.siteId,
          asId: m.asId,
          important: m.important,
          readAt:
            m.recipients.find((r) => r.workerId === e.recipientWorkerId)
              ?.readAt ?? null,
        })),
    );
  }
}
@Controller("work-instructions")
export class WorkInstructionController {
  constructor(
    @Inject(WorkInstructionService) private service: WorkInstructionService,
  ) {}
  @Get() list(@Query("siteId") siteId?: string, @Query("asId") asId?: string) {
    return this.service.list(siteId, asId);
  }
  @Get("options") options(
    @Query("siteId") siteId: string,
    @Query("asId") asId?: string,
  ) {
    return this.service.options(siteId, asId);
  }
  @Get("site/:id") site(@Param("id") id: string) {
    return this.service.siteContext(id);
  }
  @Get("notifications") notifications() {
    return this.service.notifications();
  }
  @Post() send(@Body() body: Record<string, unknown>) {
    return this.service.send(body);
  }
  @Post(":id/read") read(@Param("id") id: string) {
    return this.service.read(id);
  }
}
