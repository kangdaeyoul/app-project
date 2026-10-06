import { EXPENSES_REPOSITORY, ExpensesRepository } from './expenses.repository';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DAILY_WORK_STATUSES,
  DailyWork,
  DailyWorkInput,
  DailyWorkRecord,
  DailyWorkStatus,
  MaterialUsageInput,
  SiteMaterials,
  workMinutes,
} from "@jongno/shared";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
  newDailyWorkId,
} from "./daily-work.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { validDate } from "./workers.service";
import { seoulToday } from "./date";
@Injectable()
export class DailyWorkService {
  constructor(
    @Inject(EXPENSES_REPOSITORY) private readonly expenses: ExpensesRepository,
    @Inject(DAILY_WORK_REPOSITORY)
    private readonly repository: DailyWorkRepository,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private readonly workers: WorkersRepository,
  ) {}
  list(siteId?: string, workerId?: string) {
    return this.repository
      .list()
      .filter(
        (r) =>
          (siteId === undefined || r.siteId === siteId) &&
          (workerId === undefined ||
            r.managerId === workerId ||
            r.participants.some((p) => p.workerId === workerId)),
      );
  }
  find(id: string) {
    const r = this.repository.find(id);
    if (!r) throw new NotFoundException("일일작업을 찾을 수 없습니다.");
    return r;
  }
  private save(body: unknown, existing?: DailyWork) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("입력값을 확인해 주세요.");
    const raw = body as Record<string, unknown>;
    const input: Record<string, unknown> = {};
    for (const key of [
      "workDate",
      "siteId",
      "managerId",
      "startTime",
      "endTime",
      "content",
      "notes",
    ]) {
      const value = raw[key] ?? "";
      if (
        typeof value !== "string" ||
        value.length > (["content", "notes"].includes(key) ? 5000 : 300)
      )
        throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
      input[key] = value.trim();
    }
    const value = input as unknown as DailyWorkInput;
    if (!validDate(value.workDate))
      throw new BadRequestException("유효한 작업일자가 필요합니다.");
    const site = this.sites.find(value.siteId);
    if (!site) throw new BadRequestException("현장을 선택해 주세요.");
    if (
      !Array.isArray(raw.participantIds) ||
      raw.participantIds.length > 100 ||
      raw.participantIds.some((id) => typeof id !== "string")
    )
      throw new BadRequestException("참여 작업자 목록을 확인해 주세요.");
    const ids = raw.participantIds as string[];
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException("참여 작업자가 중복되었습니다.");
    const lookup = (id: string, retained: boolean) => {
      const worker = this.workers.find(id);
      if (!worker || (worker.deletedAt && !retained))
        throw new BadRequestException(
          "존재하지 않거나 삭제된 작업진행자는 새로 배정할 수 없습니다.",
        );
      return worker;
    };
    const manager = lookup(
      value.managerId,
      existing?.managerId === value.managerId,
    );
    const participants = ids.map((id) =>
      lookup(
        id,
        existing?.participants.some((p) => p.workerId === id) ?? false,
      ),
    );
    for (const time of [value.startTime, value.endTime])
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
        throw new BadRequestException("시간은 HH:mm 형식이어야 합니다.");
    if (value.endTime && !value.startTime)
      throw new BadRequestException("종료시간 전에 시작시간을 입력해 주세요.");
    const minutes = workMinutes(value.startTime, value.endTime);
    if (minutes !== null && minutes < 0)
      throw new BadRequestException(
        "종료시간은 시작시간보다 빠를 수 없습니다. 날짜별 기록을 분리해 주세요.",
      );
    if (!DAILY_WORK_STATUSES.includes(raw.status as DailyWorkStatus))
      throw new BadRequestException("작업 상태를 확인해 주세요.");
    if (raw.status === "작업중" && (!value.startTime || value.endTime))
      throw new BadRequestException(
        "작업중 상태에는 시작시간만 입력해 주세요.",
      );
    if (
      ["작업완료", "관리자확인완료"].includes(raw.status as string) &&
      (!value.startTime || !value.endTime)
    )
      throw new BadRequestException(
        "완료 상태에는 시작시간과 종료시간이 필요합니다.",
      );
    if (existing && existing.siteId !== site.id && this.expenses.list().some(e => e.dailyWorkId === existing.id))
      throw new ConflictException('연결된 지출 기록이 있습니다. 지출의 일일작업 연결을 해제한 뒤 현장을 변경해 주세요.');
    const materials = this.validateMaterials(raw.materials, existing);
    const id = existing?.id ?? newDailyWorkId();
    const record: DailyWorkRecord = {
      ...value,
      id,
      status: raw.status as DailyWorkStatus,
      siteName: existing?.siteId === site.id ? existing.siteName : site.name,
      managerDisplayName:
        existing?.managerId === manager.id
          ? existing.managerDisplayName
          : manager.displayName,
    };
    return this.repository.save(
      record,
      participants.map((w) => ({
        dailyWorkId: id,
        workerId: w.id,
        displayName:
          existing?.participants.find((p) => p.workerId === w.id)
            ?.displayName ?? w.displayName,
      })),
      materials,
    );
  }
  private validateMaterials(
    raw: unknown,
    existing?: DailyWork,
  ): MaterialUsageInput[] | undefined {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.length > 200)
      throw new BadRequestException(
        "사용자재는 최대 200건의 목록으로 입력해 주세요.",
      );
    const ids = new Set<string>();
    return raw.map((row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new BadRequestException("사용자재 입력값을 확인해 주세요.");
      const input = row as Record<string, unknown>;
      const fields: Record<string, string> = {};
      for (const key of ["name", "specification", "unit", "notes"]) {
        const value = input[key] ?? "";
        if (
          typeof value !== "string" ||
          value.length > (key === "notes" ? 5000 : 300)
        )
          throw new BadRequestException(
            "자재명, 규격, 단위, 비고를 확인해 주세요.",
          );
        fields[key] = value.trim();
      }
      if (!fields.name || !fields.unit)
        throw new BadRequestException("자재명과 단위는 필수입니다.");
      const quantity = input.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > 1000000 ||
        Number(quantity.toFixed(3)) !== quantity
      )
        throw new BadRequestException(
          "수량은 0보다 크고 1,000,000 이하이며 소수점 3자리까지 입력할 수 있습니다.",
        );
      const id = input.id;
      if (
        id !== undefined &&
        (typeof id !== "string" ||
          ids.has(id) ||
          !existing?.materials.some((u) => u.id === id))
      )
        throw new BadRequestException(
          "해당 작업에 속하지 않거나 중복된 사용자재 ID입니다.",
        );
      if (typeof id === "string") ids.add(id);
      return {
        ...fields,
        quantity,
        ...(typeof id === "string" ? { id } : {}),
      } as MaterialUsageInput;
    });
  }
  siteMaterials(siteId: string): SiteMaterials {
    if (!this.sites.find(siteId))
      throw new NotFoundException("현장을 찾을 수 없습니다.");
    const usages = this.list(siteId)
      .flatMap((work) =>
        work.materials.map((usage) => ({
          ...usage,
          siteId: work.siteId,
          workDate: work.workDate,
          dailyWorkContent: work.content,
          managerDisplayName: work.managerDisplayName,
        })),
      )
      .sort(
        (a, b) =>
          a.workDate.localeCompare(b.workDate) || a.name.localeCompare(b.name),
      );
    const grouped = new Map<string, SiteMaterials["totals"][number]>();
    for (const usage of usages) {
      const key = JSON.stringify([usage.name, usage.specification, usage.unit]);
      const total = grouped.get(key) ?? {
        name: usage.name,
        specification: usage.specification,
        unit: usage.unit,
        quantity: 0,
      };
      total.quantity = Number((total.quantity + usage.quantity).toFixed(3));
      grouped.set(key, total);
    }
    return { usages, totals: [...grouped.values()] };
  }
  create(body: unknown) {
    return this.save(body);
  }
  update(id: string, body: unknown) {
    return this.save(body, this.find(id));
  }
  clock(id: string, action: "start" | "finish") {
    const work = this.find(id);
    if (work.workDate !== seoulToday())
      throw new ConflictException(
        "현재 시각 기록은 오늘 작업에서만 가능합니다. 다른 날짜는 시간을 직접 입력해 주세요.",
      );
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
    if (action === "start" && work.status !== "작업예정")
      throw new ConflictException("작업예정 상태에서만 시작할 수 있습니다.");
    if (action === "finish" && work.status !== "작업중")
      throw new ConflictException("작업중 상태에서만 종료할 수 있습니다.");
    return this.save(
      {
        ...work,
        participantIds: work.participants.map((p) => p.workerId),
        startTime: action === "start" ? time : work.startTime,
        endTime: action === "start" ? "" : time,
        status: action === "start" ? "작업중" : "작업완료",
      },
      work,
    );
  }
}
