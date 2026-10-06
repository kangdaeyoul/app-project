import {
  PaymentReceived,
  WorkerPayment,
  WorkerPaymentAllocation,
} from "@jongno/shared";
import { seoulToday } from "./date";
export const FINANCE_REPOSITORY = Symbol("FINANCE_REPOSITORY");
export interface FinanceRepository {
  receipts(): PaymentReceived[];
  saveReceipt(record: PaymentReceived): void;
  removeReceipt(id: string): void;
  payments(): WorkerPayment[];
  allocations(): WorkerPaymentAllocation[];
  savePayment(
    record: WorkerPayment,
    allocations: WorkerPaymentAllocation[],
  ): void;
  removePayment(id: string): void;
}
export class SampleFinanceRepository implements FinanceRepository {
  private received: PaymentReceived[] = [];
  private paid: WorkerPayment[] = [];
  private allocated: WorkerPaymentAllocation[] = [];
  constructor(today = seoulToday()) {
    for (const [i, siteId, amount] of [
      [1, "S001", 7000000],
      [2, "S001", 5000000],
      [3, "S002", 2500000],
      [4, "S002", 1500000],
      [5, "S003", 12000000],
      [6, "S004", 10000000],
    ] as const)
      this.received.push({
        id: "R00" + i,
        siteId,
        amount,
        receivedDate: today,
        method: "계좌이체",
        payer: "샘플 거래처",
        notes: "예시 수금",
        createdAt: new Date().toISOString(),
      });
  }
  receipts() {
    return this.received.map((r) => ({ ...r }));
  }
  saveReceipt(record: PaymentReceived) {
    const i = this.received.findIndex((r) => r.id === record.id);
    if (i < 0) this.received.push({ ...record });
    else this.received[i] = { ...record };
  }
  removeReceipt(id: string) {
    this.received = this.received.filter((r) => r.id !== id);
  }
  payments() {
    return this.paid.map((r) => ({ ...r }));
  }
  allocations() {
    return this.allocated.map((r) => ({ ...r }));
  }
  savePayment(record: WorkerPayment, allocations: WorkerPaymentAllocation[]) {
    this.paid.push({ ...record });
    this.allocated.push(...allocations.map((a) => ({ ...a })));
  }
  removePayment(id: string) {
    this.paid = this.paid.filter((p) => p.id !== id);
    this.allocated = this.allocated.filter((a) => a.paymentId !== id);
  }
}
