import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AVAILABILITY_STATUSES,
  AvailabilityStatus,
  Worker,
  WorkerDetail,
  WorkerInput,
  WorkerSummary,
  isSiteOnDate,
} from "@jongno/shared";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { DAILY_WORK_REPOSITORY, DailyWorkRepository } from "./daily-work.repository";
import { seoulToday, validateMonth } from "./date";
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith("0000") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("입력값을 확인해 주세요.");
  return body as Record<string, unknown>;
}
function status(value: unknown): AvailabilityStatus {
  if (!AVAILABILITY_STATUSES.includes(value as AvailabilityStatus))
    throw new BadRequestException("작업 가능 상태를 확인해 주세요.");
  return value as AvailabilityStatus;
}
function input(body: unknown): WorkerInput {
  const raw = object(body);
  const fields: Record<string, string> = {};
  for (const key of ["name", "displayName", "phone", "role", "memo"]) {
    const v = raw[key] ?? "";
    if (typeof v !== "string" || v.length > (key === "memo" ? 5000 : 300))
      throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
    fields[key] = v.trim();
  }
  if (!fields.name || !fields.displayName)
    throw new BadRequestException("이름과 표시명은 필수입니다.");
  return {
    ...fields,
    defaultAvailability: status(raw.defaultAvailability),
  } as WorkerInput;
}
@Injectable()
export class WorkersService {
  constructor(
    @Inject(WORKERS_REPOSITORY) private readonly repository: WorkersRepository,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(DAILY_WORK_REPOSITORY) private readonly daily: DailyWorkRepository,
  ) {}
  find(id: string) {
    const w = this.repository.find(id);
    if (!w) throw new NotFoundException("작업진행자를 찾을 수 없습니다.");
    return w;
  }
  private active(id: string) {
    const w = this.find(id);
    if (w.deletedAt)
      throw new ConflictException(
        "삭제된 작업진행자는 수정하거나 새로 배정할 수 없습니다.",
      );
    return w;
  }
  private summary(w: Worker, month: string): WorkerSummary {
    const today = seoulToday();
    const work = this.repository.work(w.id);
    const monthly = work.filter((t) => t.date.startsWith(month));
    return {
      ...w,
      availability:
        this.repository.availability(w.id).find((a) => a.date === today)
          ?.status ?? w.defaultAvailability,
      todaySiteCount: this.sites
        .list()
        .filter((s) => s.managerId === w.id && isSiteOnDate(s, today)).length,
      monthlyWorkDays: new Set(
        this.daily.list().filter(t => (t.managerId === w.id || t.participants.some(p => p.workerId === w.id)) && t.workDate.startsWith(month) && t.workDate <= today && ["작업완료", "관리자확인완료"].includes(t.status)).map(t => t.workDate),
      ).size,
      monthlyPayable: monthly.reduce((n, t) => n + t.scheduledAmount, 0),
      unpaidAmount: work.reduce(
        (n, t) => n + t.scheduledAmount - t.paidAmount,
        0,
      ),
    };
  }
  list(month = seoulToday().slice(0, 7), includeDeleted = false) {
    validateMonth(month);
    return this.repository
      .list()
      .filter((w) => includeDeleted || !w.deletedAt)
      .map((w) => this.summary(w, month));
  }
  detail(id: string, month = seoulToday().slice(0, 7)): WorkerDetail {
    validateMonth(month);
    const w = this.find(id);
    const work = this.repository.work(id);
    return {
      ...this.summary(w, month),
      month,
      work,
      sites: this.sites
        .list()
        .filter(
          (s) => s.managerId === id || work.some((t) => t.siteId === s.id) || this.daily.list().some(t => t.siteId === s.id && (t.managerId === id || t.participants.some(p => p.workerId === id))),
        ),
      availabilityDates: this.repository.availability(id),
    };
  }
  create(body: unknown) {
    return this.repository.create(input(body));
  }
  update(id: string, body: unknown) {
    this.active(id);
    return this.repository.update(id, input(body))!;
  }
  archive(id: string) {
    this.find(id);
    return this.repository.archive(id)!;
  }
  setAvailability(id: string, date: string, body: unknown) {
    this.active(id);
    if (!validDate(date))
      throw new BadRequestException("유효한 날짜가 필요합니다.");
    const entry = { date, status: status(object(body).status) };
    this.repository.setAvailability(id, entry);
    return entry;
  }
}
