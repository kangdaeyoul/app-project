import {
  BusinessParty,
  PurchaseInvoice,
  SalesInvoice,
  WorkerInvoice,
} from "@jongno/shared";
import { seoulToday } from "./date";
export const INVOICES_REPOSITORY = Symbol("INVOICES_REPOSITORY");
export const emptyParty = (): BusinessParty => ({
  registrationNumber: "",
  name: "",
  representative: "",
  address: "",
  businessType: "",
  businessItem: "",
  email: "",
});
export interface InvoicesRepository {
  sale(siteId: string): SalesInvoice | undefined;
  saveSale(record: SalesInvoice): void;
  purchase(expenseId: string): PurchaseInvoice | undefined;
  savePurchase(record: PurchaseInvoice): void;
  worker(siteId: string, workerId: string): WorkerInvoice | undefined;
  saveWorker(record: WorkerInvoice): void;
}
export class SampleInvoicesRepository implements InvoicesRepository {
  private sales = new Map<string, SalesInvoice>();
  private purchases = new Map<string, PurchaseInvoice>();
  private workers = new Map<string, WorkerInvoice>();
  constructor(seed = true) {
    if (!seed) return;
    this.saveSale({
      siteId: "S003",
      counterparty: "광화문 빌딩",
      supplyAmount: 10909091,
      vat: 1090909,
      status: "발행완료",
      date: seoulToday(),
      approvalNumber: "SAMPLE-SALES-003",
      notes: "예시 승인번호 · 실제 발행 아님",
      receiptIds: ["R005"],
      supplier: emptyParty(),
      recipient: emptyParty(),
    });
    this.savePurchase({
      expenseId: "E001",
      siteId: "S001",
      counterparty: "샘플 거래처",
      supplyAmount: 100000,
      vat: 10000,
      status: "수취완료",
      date: seoulToday(),
      approvalNumber: "SAMPLE-PURCHASE-001",
      notes: "예시 수취 기록",
      supplier: emptyParty(),
      recipient: emptyParty(),
    });
  }
  sale(siteId: string) {
    const r = this.sales.get(siteId);
    return r && structuredClone(r);
  }
  saveSale(r: SalesInvoice) {
    this.sales.set(r.siteId, structuredClone(r));
  }
  purchase(expenseId: string) {
    const r = this.purchases.get(expenseId);
    return r && structuredClone(r);
  }
  savePurchase(r: PurchaseInvoice) {
    this.purchases.set(r.expenseId, structuredClone(r));
  }
  worker(siteId: string, workerId: string) {
    const r = this.workers.get(siteId + "|" + workerId);
    return r && { ...r };
  }
  saveWorker(r: WorkerInvoice) {
    this.workers.set(r.siteId + "|" + r.workerId, { ...r });
  }
}
