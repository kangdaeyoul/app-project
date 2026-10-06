import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Expense,
  PaymentReceived,
  PaymentReceivedInput,
  RECEIPT_METHODS,
  SettlementItem,
  SettlementList,
  SettlementSummary,
  SiteFinance,
  WorkerPaymentAllocation,
} from "@jongno/shared";
import { FINANCE_REPOSITORY, FinanceRepository } from "./finance.repository";
import { EXPENSES_REPOSITORY, ExpensesRepository } from "./expenses.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { seoulToday, validDate, validateMonth } from "./date";
function object(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("입력값을 확인해 주세요.");
  return body as Record<string, unknown>;
}
function text(body: Record<string, unknown>, key: string, required = false) {
  const v = body[key] ?? "";
  if (
    typeof v !== "string" ||
    v.length > (key === "notes" ? 5000 : 300) ||
    (required && !v.trim())
  )
    throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
  return v.trim();
}
function amount(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new BadRequestException(
      "금액은 0보다 큰 원 단위 안전한 정수여야 합니다.",
    );
  return value;
}
export function sum(values: number[]) {
  const n = values.reduce((n, v) => n + BigInt(v), 0n);
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new BadRequestException("집계금액이 안전한 정수 범위를 넘습니다.");
  return Number(n);
}
@Injectable()
export class FinanceService {
  constructor(
    @Inject(FINANCE_REPOSITORY) private readonly repo: FinanceRepository,
    @Inject(EXPENSES_REPOSITORY) private readonly expenses: ExpensesRepository,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private readonly workers: WorkersRepository,
  ) {}
  private site(id: string) {
    const site = this.sites.find(id);
    if (!site) throw new NotFoundException("현장을 찾을 수 없습니다.");
    return site;
  }
  receipts(siteId: string) {
    this.site(siteId);
    return this.repo
      .receipts()
      .filter((r) => r.siteId === siteId)
      .sort(
        (a, b) =>
          b.receivedDate.localeCompare(a.receivedDate) ||
          a.id.localeCompare(b.id),
      );
  }
  private receipt(id: string) {
    const r = this.repo.receipts().find((r) => r.id === id);
    if (!r) throw new NotFoundException("수금내역을 찾을 수 없습니다.");
    return r;
  }
  saveReceipt(body: unknown, id?: string) {
    const existing = id ? this.receipt(id) : undefined;
    const raw = object(body);
    const receivedDate = text(raw, "receivedDate", true);
    if (!validDate(receivedDate))
      throw new BadRequestException("입금일자를 확인해 주세요.");
    const siteId = text(raw, "siteId", true);
    this.site(siteId);
    const value = amount(raw.amount);
    if (!RECEIPT_METHODS.includes(raw.method as PaymentReceivedInput["method"]))
      throw new BadRequestException("결제방법을 확인해 주세요.");
    const payer = text(raw, "payer", true);
    const notes = text(raw, "notes");
    sum([
      ...this.repo
        .receipts()
        .filter((r) => r.id !== id)
        .map((r) => r.amount),
      value,
    ]);
    const record: PaymentReceived = {
      id: existing?.id ?? randomUUID(),
      siteId,
      amount: value,
      receivedDate,
      method: raw.method as PaymentReceivedInput["method"],
      payer,
      notes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.repo.saveReceipt(record);
    return record;
  }
  removeReceipt(id: string) {
    this.receipt(id);
    this.repo.removeReceipt(id);
    return { deleted: true };
  }
  paid(expenseId: string) {
    return sum(
      this.repo
        .allocations()
        .filter((a) => a.expenseId === expenseId)
        .map((a) => a.amount),
    );
  }
  expenseView(e: Expense): Expense {
    if (!e.workerId) return e;
    const paid = this.paid(e.id);
    const ids = new Set(
      this.repo
        .allocations()
        .filter((a) => a.expenseId === e.id)
        .map((a) => a.paymentId),
    );
    const dates = this.repo
      .payments()
      .filter((p) => ids.has(p.id))
      .map((p) => p.paymentDate)
      .sort();
    const settled = paid >= e.totalAmount;
    return {
      ...e,
      paidAmount: paid,
      payoutStatus: settled ? "지급완료" : paid > 0 ? "일부지급" : "미지급",
      settled,
      settlementDate: settled ? (dates.at(-1) ?? null) : null,
    };
  }
  items(): SettlementItem[] {
    return this.expenses
      .list()
      .filter((e) => e.workerId && (e.isWorkerAdvance || e.type === "작업비"))
      .map((e) => ({
        id: e.id,
        siteId: e.siteId,
        workerId: e.workerId!,
        workerDisplayName: e.workerDisplayName!,
        expenseDate: e.expenseDate,
        description: e.description,
        category:
          e.type === "작업비"
            ? "작업비"
            : e.type === "작업진행자 대납 자재구매"
              ? "자재대납"
              : "기타정산",
        amount: e.totalAmount,
        paidAmount: this.paid(e.id),
        unpaidAmount: e.totalAmount - this.paid(e.id),
      }));
  }
  settlements(
    siteId?: string,
    workerId?: string,
    month = seoulToday().slice(0, 7),
  ): SettlementList {
    validateMonth(month);
    if (siteId !== undefined) this.site(siteId);
    if (workerId !== undefined && !this.workers.find(workerId))
      throw new NotFoundException("작업진행자를 찾을 수 없습니다.");
    const items = this.items().filter(
      (i) =>
        (!siteId || i.siteId === siteId) &&
        (!workerId || i.workerId === workerId),
    );
    const payments = this.repo
      .payments()
      .filter(
        (p) =>
          (!siteId || p.siteId === siteId) &&
          (!workerId || p.workerId === workerId),
      );
    const grouped = new Map<string, SettlementItem[]>();
    for (const item of items) {
      const key = item.siteId + "|" + item.workerId;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    const rows: SettlementSummary[] = [...grouped.values()].map((group) => {
      const first = group[0];
      const totalPayable = sum(group.map((i) => i.amount));
      const paidAmount = sum(group.map((i) => i.paidAmount));
      return {
        siteId: first.siteId,
        siteName: this.site(first.siteId).name,
        workerId: first.workerId,
        workerDisplayName: first.workerDisplayName,
        labor: sum(
          group.filter((i) => i.category === "작업비").map((i) => i.amount),
        ),
        materialAdvances: sum(
          group.filter((i) => i.category === "자재대납").map((i) => i.amount),
        ),
        other: sum(
          group.filter((i) => i.category === "기타정산").map((i) => i.amount),
        ),
        totalPayable,
        paidAmount,
        unpaidAmount: totalPayable - paidAmount,
        status:
          paidAmount >= totalPayable
            ? "지급완료"
            : paidAmount > 0
              ? "일부지급"
              : "미지급",
        lastPaymentDate:
          payments
            .filter(
              (p) => p.siteId === first.siteId && p.workerId === first.workerId,
            )
            .map((p) => p.paymentDate)
            .sort()
            .at(-1) ?? null,
        items: group,
      };
    });
    const monthly = items.filter((i) => i.expenseDate.startsWith(month));
    return {
      workers: this.workers
        .list()
        .filter((w) => !workerId || w.id === workerId)
        .map((w) => {
          const related = rows.filter((r) => r.workerId === w.id);
          return {
            workerId: w.id,
            workerDisplayName: w.displayName,
            deletedAt: w.deletedAt,
            totalPayable: sum(related.map((r) => r.totalPayable)),
            paidAmount: sum(related.map((r) => r.paidAmount)),
            unpaidAmount: sum(related.map((r) => r.unpaidAmount)),
          };
        }),
      rows,
      payments: payments.sort((a, b) =>
        b.paymentDate.localeCompare(a.paymentDate),
      ),
      totals: {
        totalPayable: sum(items.map((i) => i.amount)),
        paidAmount: sum(items.map((i) => i.paidAmount)),
        unpaidAmount: sum(items.map((i) => i.unpaidAmount)),
      },
      monthly: {
        month,
        totalPayable: sum(monthly.map((i) => i.amount)),
        paidAmount: sum(
          payments
            .filter((p) => p.paymentDate.startsWith(month))
            .map((p) => p.amount),
        ),
        unpaidAmount: sum(monthly.map((i) => i.unpaidAmount)),
      },
    };
  }
  siteFinance(siteId: string): SiteFinance {
    const site = this.site(siteId);
    const rows = this.expenses.list().filter((e) => e.siteId === siteId);
    const collectedAmount = sum(this.receipts(siteId).map((r) => r.amount));
    const totalExpenses = sum(rows.map((e) => e.totalAmount));
    return {
      siteId,
      contractAmount: site.contractAmount,
      collectedAmount,
      receivables: site.contractAmount - collectedAmount,
      directMaterials: sum(
        rows
          .filter((e) => e.type === "회사 직접 자재구매")
          .map((e) => e.totalAmount),
      ),
      materialAdvances: sum(
        rows
          .filter((e) => e.type === "작업진행자 대납 자재구매")
          .map((e) => e.totalAmount),
      ),
      labor: sum(
        rows.filter((e) => e.type === "작업비").map((e) => e.totalAmount),
      ),
      other: sum(
        rows.filter((e) => e.type === "기타경비").map((e) => e.totalAmount),
      ),
      totalExpenses,
      siteProfit: site.contractAmount - totalExpenses,
      unpaidWorkerAmount: this.settlements(siteId).totals.unpaidAmount,
    };
  }
  pay(body: unknown) {
    const raw = object(body);
    const siteId = text(raw, "siteId", true);
    this.site(siteId);
    const workerId = text(raw, "workerId", true);
    if (!this.workers.find(workerId))
      throw new NotFoundException("작업진행자를 찾을 수 없습니다.");
    const date = text(raw, "paymentDate", true);
    if (!validDate(date))
      throw new BadRequestException("지급일을 확인해 주세요.");
    if (raw.fullPayment !== undefined && typeof raw.fullPayment !== "boolean")
      throw new BadRequestException("전액 지급 여부를 확인해 주세요.");
    const notes = text(raw, "notes");
    const items = this.items()
      .filter(
        (i) =>
          i.siteId === siteId && i.workerId === workerId && i.unpaidAmount > 0,
      )
      .sort(
        (a, b) =>
          a.expenseDate.localeCompare(b.expenseDate) ||
          a.id.localeCompare(b.id),
      );
    const unpaid = sum(items.map((i) => i.unpaidAmount));
    if (!unpaid) throw new ConflictException("지급할 잔액이 없습니다.");
    const value = raw.fullPayment === true ? unpaid : amount(raw.amount);
    if (value > unpaid)
      throw new BadRequestException("미지급액을 초과해 지급할 수 없습니다.");
    let remaining = value;
    const id = randomUUID();
    const allocations: WorkerPaymentAllocation[] = [];
    for (const item of items) {
      if (!remaining) break;
      if (item.expenseDate > date)
        throw new BadRequestException("지급일은 연결 지출일 이후여야 합니다.");
      const part = Math.min(remaining, item.unpaidAmount);
      allocations.push({ paymentId: id, expenseId: item.id, amount: part });
      remaining -= part;
    }
    const record = {
      id,
      siteId,
      workerId,
      paymentDate: date,
      amount: value,
      notes,
      createdAt: new Date().toISOString(),
    };
    this.repo.savePayment(record, allocations);
    return record;
  }
  paymentDates(expenseId: string) {
    const ids = new Set(
      this.repo
        .allocations()
        .filter((a) => a.expenseId === expenseId)
        .map((a) => a.paymentId),
    );
    return this.repo
      .payments()
      .filter((p) => ids.has(p.id))
      .map((p) => p.paymentDate);
  }
  completeExpense(expenseId: string, paymentDate: string) {
    const e = this.expenses.find(expenseId)!;
    const remaining = e.totalAmount - this.paid(expenseId);
    if (remaining <= 0) return;
    const id = randomUUID();
    this.repo.savePayment(
      {
        id,
        siteId: e.siteId,
        workerId: e.workerId!,
        paymentDate,
        amount: remaining,
        notes: "지출 정산완료 처리",
        createdAt: new Date().toISOString(),
      },
      [{ paymentId: id, expenseId, amount: remaining }],
    );
  }
  removePayment(id: string) {
    if (!this.repo.payments().some((p) => p.id === id))
      throw new NotFoundException("지급내역을 찾을 수 없습니다.");
    this.repo.removePayment(id);
    return { deleted: true };
  }
}
