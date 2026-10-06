import { FinanceService, sum } from "./finance.service";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  EVIDENCE_TYPES,
  EXPENSE_TYPES,
  Expense,
  ExpenseInput,
  ExpenseList,
  ExpenseRecord,
  PAYMENT_METHODS,
} from "@jongno/shared";
import {
  EXPENSES_REPOSITORY,
  ExpensesRepository,
  expenseTotals,
  workerExpenseTotals,
} from "./expenses.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import { validDate } from "./workers.service";
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(EXPENSES_REPOSITORY) private readonly repo: ExpensesRepository,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private readonly workers: WorkersRepository,
    @Inject(DAILY_WORK_REPOSITORY) private readonly daily: DailyWorkRepository,
  ) {}
  find(id: string) {
    const row = this.repo.find(id);
    if (!row) throw new NotFoundException("지출 기록을 찾을 수 없습니다.");
    return this.finance.expenseView(row);
  }
  list(siteId?: string, workerId?: string): ExpenseList {
    if (siteId !== undefined && !this.sites.find(siteId))
      throw new NotFoundException("현장을 찾을 수 없습니다.");
    if (workerId !== undefined && !this.workers.find(workerId))
      throw new NotFoundException("작업진행자를 찾을 수 없습니다.");
    const items = this.repo
      .list()
      .map((e) => this.finance.expenseView(e))
      .filter(
        (e) =>
          (siteId === undefined || e.siteId === siteId) &&
          (workerId === undefined || e.workerId === workerId),
      )
      .sort(
        (a, b) =>
          b.expenseDate.localeCompare(a.expenseDate) ||
          a.id.localeCompare(b.id),
      );
    return {
      items,
      totals: expenseTotals(items),
      workerTotals: workerExpenseTotals(
        items,
        new Map(items.map((e) => [e.id, this.finance.paid(e.id)])),
      ),
    };
  }
  private save(body: unknown, existing?: Expense) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("지출 입력값을 확인해 주세요.");
    const raw = body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const key of [
      "expenseDate",
      "siteId",
      "description",
      "vendor",
      "unit",
      "purchaser",
      "notes",
    ]) {
      const v = raw[key] ?? "";
      if (typeof v !== "string" || v.length > (key === "notes" ? 5000 : 300))
        throw new BadRequestException(
          "지출 입력값의 길이와 형식을 확인해 주세요.",
        );
      fields[key] = v.trim();
    }
    if (!validDate(fields.expenseDate) || !fields.description || !fields.unit)
      throw new BadRequestException("지출일자, 품목/내용, 단위는 필수입니다.");
    if (
      !EXPENSE_TYPES.includes(raw.type as ExpenseInput["type"]) ||
      !PAYMENT_METHODS.includes(
        raw.paymentMethod as ExpenseInput["paymentMethod"],
      ) ||
      !EVIDENCE_TYPES.includes(raw.evidenceType as ExpenseInput["evidenceType"])
    )
      throw new BadRequestException(
        "지출유형, 결제방법, 증빙유형을 확인해 주세요.",
      );
    const site = this.sites.find(fields.siteId);
    if (!site) throw new BadRequestException("등록된 현장이 필요합니다.");
    const dailyWorkId = raw.dailyWorkId ?? null;
    if (
      dailyWorkId !== null &&
      (typeof dailyWorkId !== "string" ||
        this.daily.find(dailyWorkId)?.siteId !== site.id)
    )
      throw new BadRequestException(
        "연결 일일작업은 선택한 현장의 작업이어야 합니다.",
      );
    const quantity = raw.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1000000 ||
      Number(quantity.toFixed(3)) !== quantity
    )
      throw new BadRequestException(
        "수량은 양수이며 소수점 3자리까지 입력할 수 있습니다.",
      );
    for (const key of ["supplyAmount", "vat"])
      if (
        typeof raw[key] !== "number" ||
        !Number.isSafeInteger(raw[key]) ||
        (raw[key] as number) < 0
      )
        throw new BadRequestException(
          "공급가액과 VAT는 0 이상 원 단위 정수여야 합니다.",
        );
    const supplyAmount = raw.supplyAmount as number;
    const vat = raw.vat as number;
    if (!Number.isSafeInteger(supplyAmount + vat))
      throw new BadRequestException("합계금액이 너무 큽니다.");
    // totalAmount is read-only and always derived from supplyAmount + vat.
    sum([...this.repo.list().filter(e=>e.id!==existing?.id).map(e=>e.totalAmount),supplyAmount+vat]);
    const isWorkerAdvance =
      raw.type === "작업진행자 대납 자재구매" ||
      raw.paymentMethod === "작업진행자 대납";
    if (
      typeof raw.isWorkerAdvance !== "boolean" ||
      raw.isWorkerAdvance !== isWorkerAdvance ||
      (raw.type === "회사 직접 자재구매" && isWorkerAdvance) ||
      (raw.type === "작업진행자 대납 자재구매" &&
        raw.paymentMethod !== "작업진행자 대납") ||
      (raw.type === "작업비" && isWorkerAdvance)
    )
      throw new BadRequestException(
        "대납 여부와 지출유형/결제방법이 일치해야 합니다. 작업비는 지급 대상으로 별도 관리합니다.",
      );
    const needsWorker = isWorkerAdvance || raw.type === "작업비";
    const workerId = raw.workerId ?? null;
    const worker =
      typeof workerId === "string" ? this.workers.find(workerId) : undefined;
    if (
      needsWorker
        ? !worker || (worker.deletedAt && existing?.workerId !== worker.id)
        : workerId !== null
    )
      throw new BadRequestException(
        "대납과 작업비는 작업진행자 ID가 필수입니다. 삭제된 작업진행자는 새로 선택할 수 없습니다.",
      );
    if (!needsWorker && !fields.purchaser)
      throw new BadRequestException("구매자 또는 지출자를 입력해 주세요.");
    if (typeof raw.settled !== "boolean")
      throw new BadRequestException("정산완료 여부를 확인해 주세요.");
    const settlementDate = raw.settlementDate ?? null;
    if (
      raw.settled
        ? typeof settlementDate !== "string" ||
          !validDate(settlementDate) ||
          settlementDate < fields.expenseDate
        : settlementDate !== null
    )
      throw new BadRequestException(
        "정산완료 기록에는 지출일 이후의 정산일이 필요하며 미정산 기록에는 정산일을 비워주세요.",
      );
    if (existing && this.finance.paid(existing.id) > 0) {
      const paid = this.finance.paid(existing.id);
      if (
        existing.siteId !== site.id ||
        existing.workerId !== workerId ||
        existing.type !== raw.type ||
        supplyAmount + vat < paid ||
        this.finance
          .paymentDates(existing.id)
          .some((date) => date < fields.expenseDate)
      )
        throw new ConflictException(
          "지급내역이 있는 지출은 현장/작업진행자/유형을 바꾸거나 지급액 미만으로 줄일 수 없습니다. 지급내역을 먼저 취소해 주세요.",
        );
      if (!raw.settled && paid >= supplyAmount + vat)
        throw new ConflictException(
          "지급완료 기록의 상태는 지급 원장에서 계산됩니다. 지급내역을 먼저 취소해 주세요.",
        );
    }
    const receiptFileKey =
      raw.receiptFileKey === undefined
        ? (existing?.receiptFileKey ?? null)
        : raw.receiptFileKey;
    if (
      receiptFileKey !== null &&
      (typeof receiptFileKey !== "string" || receiptFileKey.length > 1000)
    )
      throw new BadRequestException("증빙 파일 참조를 확인해 주세요.");
    const id = existing?.id ?? randomUUID();
    const now = new Date().toISOString();
    const record: ExpenseRecord = {
      ...fields,
      id,
      siteName: existing?.siteId === site.id ? existing.siteName : site.name,
      dailyWorkId,
      type: raw.type as ExpenseInput["type"],
      supplyAmount,
      vat,
      paymentMethod: raw.paymentMethod as ExpenseInput["paymentMethod"],
      evidenceType: raw.evidenceType as ExpenseInput["evidenceType"],
      purchaser: needsWorker
        ? existing?.workerId === worker!.id
          ? existing.purchaser
          : worker!.displayName
        : fields.purchaser,
      isWorkerAdvance,
      settled: raw.settled,
      settlementDate: raw.settled ? (settlementDate as string) : null,
      receiptFileKey: receiptFileKey as string | null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    } as ExpenseRecord;
    const saved = this.repo.save(
      record,
      { expenseId: id, quantity, unit: fields.unit },
      needsWorker
        ? {
            expenseId: id,
            workerId: worker!.id,
            displayName:
              existing?.workerId === worker!.id
                ? existing.workerDisplayName!
                : worker!.displayName,
          }
        : null,
    );
    if (needsWorker && raw.settled)
      this.finance.completeExpense(saved.id, settlementDate as string);
    return this.finance.expenseView(saved);
  }
  create(body: unknown) {
    return this.save(body);
  }
  update(id: string, body: unknown) {
    return this.save(body, this.find(id));
  }
  remove(id: string) {
    this.find(id);
    if (this.finance.paid(id) > 0)
      throw new ConflictException(
        "지급내역이 있는 지출은 지급내역을 먼저 취소해야 삭제할 수 있습니다.",
      );
    this.repo.remove(id);
    return { deleted: true };
  }
}
