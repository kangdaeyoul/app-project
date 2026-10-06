import {
  Expense,
  ExpenseRecord,
  ExpenseTotals,
  ExpenseLineItem,
  WorkerExpenseTotals,
  WorkerSettlement,
} from "@jongno/shared";
import { seoulToday } from "./date";
export const EXPENSES_REPOSITORY = Symbol("EXPENSES_REPOSITORY");
export interface ExpensesRepository {
  list(): Expense[];
  find(id: string): Expense | undefined;
  save(
    record: ExpenseRecord,
    purchase: ExpenseLineItem,
    settlement: WorkerSettlement | null,
  ): Expense;
  remove(id: string): void;
}
export function expenseTotals(rows: Expense[]): ExpenseTotals {
  return {
    directMaterials: rows
      .filter((e) => e.type === "회사 직접 자재구매")
      .reduce((n, e) => n + e.totalAmount, 0),
    workerAdvances: rows
      .filter((e) => e.isWorkerAdvance)
      .reduce((n, e) => n + e.totalAmount, 0),
    labor: rows
      .filter((e) => e.type === "작업비")
      .reduce((n, e) => n + e.totalAmount, 0),
    other: rows
      .filter((e) => e.type === "기타경비")
      .reduce((n, e) => n + e.totalAmount, 0),
    total: rows.reduce((n, e) => n + e.totalAmount, 0),
  };
}
export function workerExpenseTotals(
  rows: Expense[],
  paid?: Map<string, number>,
): WorkerExpenseTotals {
  const payable = rows.filter(
    (e) => e.workerId && (e.isWorkerAdvance || e.type === "작업비"),
  );
  const sum = (items: Expense[]) =>
    items.reduce((n, e) => n + e.totalAmount, 0);
  return {
    labor: sum(payable.filter((e) => e.type === "작업비")),
    advances: sum(payable.filter((e) => e.isWorkerAdvance)),
    totalPayable: sum(payable),
    settledAmount: payable.reduce(
      (n, e) => n + (paid?.get(e.id) ?? (e.settled ? e.totalAmount : 0)),
      0,
    ),
    unpaidAmount: payable.reduce(
      (n, e) =>
        n +
        e.totalAmount -
        (paid?.get(e.id) ?? (e.settled ? e.totalAmount : 0)),
      0,
    ),
  };
}
export class SampleExpensesRepository implements ExpensesRepository {
  private records: ExpenseRecord[] = [];
  private lineItems: ExpenseLineItem[] = [];
  private settlements: WorkerSettlement[] = [];
  constructor() {
    const date = seoulToday();
    const seeds = [
      {
        id: "E001",
        type: "회사 직접 자재구매" as const,
        description: "백관 25A 구매 (샘플)",
        supplyAmount: 100000,
        vat: 10000,
        paymentMethod: "법인카드" as const,
        worker: false,
        settled: true,
      },
      {
        id: "E002",
        type: "작업진행자 대납 자재구매" as const,
        description: "스프링클러헤드 구매 (샘플)",
        supplyAmount: 170000,
        vat: 17000,
        paymentMethod: "작업진행자 대납" as const,
        worker: true,
        settled: false,
      },
      {
        id: "E003",
        type: "작업비" as const,
        description: "배관 시공 작업비 (샘플)",
        supplyAmount: 350000,
        vat: 0,
        paymentMethod: "회사계좌이체" as const,
        worker: true,
        settled: false,
      },
      {
        id: "E004",
        type: "기타경비" as const,
        description: "주차비 (샘플)",
        supplyAmount: 22000,
        vat: 0,
        paymentMethod: "회사현금" as const,
        worker: false,
        settled: true,
      },
    ];
    for (const seed of seeds) {
      const now = new Date().toISOString();
      this.save(
        {
          id: seed.id,
          expenseDate: date,
          siteId: "S001",
          siteName: "종로 오피스 소방시설 개선",
          dailyWorkId: "D001",
          type: seed.type,
          description: seed.description,
          vendor: "샘플 거래처",
          supplyAmount: seed.supplyAmount,
          vat: seed.vat,
          paymentMethod: seed.paymentMethod,
          evidenceType: seed.type === "기타경비" ? "간이영수증" : "세금계산서",
          purchaser: seed.worker ? "김현장 소장" : "회사",
          isWorkerAdvance: seed.type === "작업진행자 대납 자재구매",
          settled: seed.settled,
          settlementDate: seed.settled ? date : null,
          notes: "예시 기록",
          receiptFileKey: null,
          createdAt: now,
          updatedAt: now,
        },
        { expenseId: seed.id, quantity: 1, unit: "건" },
        seed.worker
          ? { expenseId: seed.id, workerId: "W001", displayName: "김현장 소장" }
          : null,
      );
    }
    for (const [index, amount] of [820000, 310000, 1200000, 120000].entries()) {
      const template = this.find("E00" + (index + 1))!;
      const id = "E10" + (index + 1);
      const {
        quantity,
        unit,
        workerId,
        workerDisplayName,
        totalAmount,
        ...record
      } = template;
      this.save(
        {
          ...record,
          id,
          siteId: "S002",
          siteName: "혜화 상가 감지기 교체",
          dailyWorkId: null,
          supplyAmount: amount,
          vat: 0,
          purchaser: workerId ? "이소방 기사" : "회사",
        },
        { expenseId: id, quantity, unit },
        workerId
          ? { expenseId: id, workerId: "W003", displayName: "이소방 기사" }
          : null,
      );
    }
  }
  private view(record: ExpenseRecord): Expense {
    const p = this.lineItems.find((p) => p.expenseId === record.id)!;
    const w = this.settlements.find((w) => w.expenseId === record.id);
    return {
      ...record,
      quantity: p.quantity,
      unit: p.unit,
      workerId: w?.workerId ?? null,
      workerDisplayName: w?.displayName ?? null,
      totalAmount: record.supplyAmount + record.vat,
    };
  }
  list() {
    return this.records.map((r) => this.view(r));
  }
  find(id: string) {
    const r = this.records.find((r) => r.id === id);
    return r && this.view(r);
  }
  save(
    record: ExpenseRecord,
    purchase: ExpenseLineItem,
    settlement: WorkerSettlement | null,
  ) {
    const i = this.records.findIndex((r) => r.id === record.id);
    if (i < 0) this.records.push({ ...record });
    else this.records[i] = { ...record };
    this.lineItems = this.lineItems.filter((p) => p.expenseId !== record.id);
    this.lineItems.push({ ...purchase });
    this.settlements = this.settlements.filter(
      (w) => w.expenseId !== record.id,
    );
    if (settlement) this.settlements.push({ ...settlement });
    return this.view(record);
  }
  remove(id: string) {
    this.records = this.records.filter((r) => r.id !== id);
    this.lineItems = this.lineItems.filter((p) => p.expenseId !== id);
    this.settlements = this.settlements.filter((w) => w.expenseId !== id);
  }
}
