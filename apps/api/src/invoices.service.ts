import { CompanyContext } from './company-context';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BusinessParty,
  InvoiceList,
  InvoiceMetadata,
  PURCHASE_INVOICE_STATUSES,
  PurchaseInvoiceView,
  SALES_INVOICE_STATUSES,
  SalesInvoiceView,
  WORKER_INVOICE_STATUSES,
  WorkerInvoiceView,
} from "@jongno/shared";
import {
  INVOICES_REPOSITORY,
  InvoicesRepository,
  emptyParty,
} from "./invoices.repository";
import { EXPENSES_REPOSITORY, ExpensesRepository } from "./expenses.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { FinanceService, sum } from "./finance.service";
import { validDate } from "./date";
function raw(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("계산서 입력값을 확인해 주세요.");
  return body as Record<string, unknown>;
}
function text(body: Record<string, unknown>, key: string) {
  const v = body[key] ?? "";
  if (typeof v !== "string" || v.length > (key === "notes" ? 5000 : 300))
    throw new BadRequestException("계산서 입력 길이와 형식을 확인해 주세요.");
  return v.trim();
}
function party(body: unknown): BusinessParty {
  if (body === undefined) return emptyParty();
  const value = raw(body);
  const result = emptyParty();
  for (const key of Object.keys(result) as (keyof BusinessParty)[])
    result[key] = text(value, key);
  return result;
}
function metadata(
  body: Record<string, unknown>,
  complete: boolean,
): InvoiceMetadata {
  const supplyAmount = body.supplyAmount;
  const vat = body.vat;
  for (const v of [supplyAmount, vat])
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
      throw new BadRequestException(
        "공급가액/VAT는 0 이상 원 단위 정수여야 합니다.",
      );
  sum([supplyAmount as number, vat as number]);
  const date = body.date ?? null;
  if (date !== null && (typeof date !== "string" || !validDate(date)))
    throw new BadRequestException("계산서 날짜를 확인해 주세요.");
  const approvalNumber = text(body, "approvalNumber");
  if (complete && (!date || !approvalNumber))
    throw new BadRequestException(
      "완료 상태에는 날짜와 승인번호가 필요합니다.",
    );
  return {
    counterparty: text(body, "counterparty"),
    supplyAmount: supplyAmount as number,
    vat: vat as number,
    date: date as string | null,
    approvalNumber,
    notes: text(body, "notes"),
    supplier: party(body.supplier),
    recipient: party(body.recipient),
  };
}
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(INVOICES_REPOSITORY) private readonly repo: InvoicesRepository,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(EXPENSES_REPOSITORY) private readonly expenses: ExpensesRepository,
    @Inject(WORKERS_REPOSITORY) private readonly workers: WorkersRepository,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(CompanyContext) private readonly company: CompanyContext,
  ) {}
  private site(id: string) {
    const s = this.sites.find(id);
    if (!s) throw new NotFoundException("현장을 찾을 수 없습니다.");
    return s;
  }
  sale(siteId: string): SalesInvoiceView {
    const site = this.site(siteId);
    const supplyAmount = Number((BigInt(site.contractAmount) * 10n) / 11n);
    const r = this.repo.sale(siteId) ?? {
      siteId,
      counterparty: site.client,
      supplyAmount,
      vat: site.contractAmount - supplyAmount,
      status: "미발행" as const,
      date: null,
      approvalNumber: "",
      notes: "",
      supplier: this.company.settings().business,
      recipient: emptyParty(),
      receiptIds: [],
    };
    return {
      ...r,
      siteName: site.name,
      totalAmount: r.supplyAmount + r.vat,
      collectedAmount: this.finance.siteFinance(siteId).collectedAmount,
    };
  }
  purchase(expenseId: string): PurchaseInvoiceView {
    const e = this.expenses.find(expenseId);
    if (!e) throw new NotFoundException("지출을 찾을 수 없습니다.");
    if (e.evidenceType !== "세금계산서")
      throw new ConflictException(
        "세금계산서 증빙유형인 지출만 매입 계산서를 관리할 수 있습니다.",
      );
    const r = this.repo.purchase(expenseId) ?? {
      expenseId,
      siteId: e.siteId,
      counterparty: e.vendor,
      supplyAmount: e.supplyAmount,
      vat: e.vat,
      status: "미수취" as const,
      date: null,
      approvalNumber: "",
      notes: "",
      supplier: emptyParty(),
      recipient: this.company.settings().business,
    };
    return {
      ...r,
      siteId: e.siteId,
      siteName: this.site(e.siteId).name,
      counterparty: r.counterparty || e.vendor,
      supplyAmount: e.supplyAmount,
      vat: e.vat,
      totalAmount: e.totalAmount,
      expenseDescription: e.description,
      workerId: e.workerId,
    };
  }
  worker(siteId: string, workerId: string): WorkerInvoiceView {
    const row = this.finance.settlements(siteId, workerId).rows[0];
    if (!row)
      throw new NotFoundException(
        "해당 현장의 작업진행자 정산대상을 찾을 수 없습니다.",
      );
    return {
      ...(this.repo.worker(siteId, workerId) ?? {
        siteId,
        workerId,
        status: "미발행" as const,
        date: null,
        approvalNumber: "",
        notes: "",
      }),
      siteName: row.siteName,
      workerDisplayName: row.workerDisplayName,
      totalPayable: row.totalPayable,
    };
  }
  list(siteId?: string, workerId?: string): InvoiceList {
    if (siteId !== undefined) this.site(siteId);
    if (workerId !== undefined && !this.workers.find(workerId))
      throw new NotFoundException("작업진행자를 찾을 수 없습니다.");
    const group = this.finance.settlements(siteId, workerId).rows;
    const siteIds = new Set(group.map((g) => g.siteId));
    const sales = this.sites
      .list()
      .filter(
        (s) =>
          (siteId === undefined || s.id === siteId) &&
          (workerId === undefined || siteIds.has(s.id)),
      )
      .map((s) => this.sale(s.id));
    const expenses = this.expenses
      .list()
      .filter(
        (e) =>
          (siteId === undefined || e.siteId === siteId) &&
          (workerId === undefined || e.workerId === workerId),
      )
      .map((e) => ({
        id: e.id,
        siteId: e.siteId,
        siteName: this.site(e.siteId).name,
        description: e.description,
        evidenceType: e.evidenceType,
        receiptStatus:
          e.evidenceType === "세금계산서"
            ? this.purchase(e.id).status
            : ("해당없음" as const),
        totalAmount: e.totalAmount,
        workerId: e.workerId,
      }));
    const purchases = expenses
      .filter((e) => e.evidenceType === "세금계산서")
      .map((e) => this.purchase(e.id));
    const workers = group.map((g) => this.worker(g.siteId, g.workerId));
    return {
      sales,
      purchases,
      expenses,
      workers,
      warnings: {
        salesUnissued: sales.filter((r) => r.status === "미발행").length,
        purchasesUnreceived: purchases.filter((r) => r.status === "미수취")
          .length,
        noEvidence: expenses.filter((e) => e.evidenceType === "증빙없음")
          .length,
        workerUnreceived: workers.filter((r) => r.status === "미발행").length,
      },
    };
  }
  warnings(siteIds: string[]) {
    const data = this.list();
    const set = new Set(siteIds);
    return {
      salesUnissued: data.sales.filter(
        (r) => set.has(r.siteId) && r.status === "미발행",
      ).length,
      purchasesUnreceived: data.purchases.filter(
        (r) => set.has(r.siteId) && r.status === "미수취",
      ).length,
      noEvidence: data.expenses.filter(
        (r) => set.has(r.siteId) && r.evidenceType === "증빙없음",
      ).length,
      workerUnreceived: data.workers.filter(
        (r) => set.has(r.siteId) && r.status === "미발행",
      ).length,
    };
  }
  saveSale(siteId: string, body: unknown) {
    this.site(siteId);
    const value = raw(body);
    if (
      !SALES_INVOICE_STATUSES.includes(
        value.status as SalesInvoiceView["status"],
      )
    )
      throw new BadRequestException("발행상태를 확인해 주세요.");
    const fields = metadata(value, value.status === "발행완료");
    if (!fields.counterparty)
      throw new BadRequestException("거래처는 필수입니다.");
    const receiptIds = value.receiptIds ?? [];
    if (
      !Array.isArray(receiptIds) ||
      receiptIds.length > 1000 ||
      new Set(receiptIds).size !== receiptIds.length ||
      receiptIds.some(
        (id) =>
          typeof id !== "string" ||
          !this.finance.receipts(siteId).some((r) => r.id === id),
      )
    )
      throw new BadRequestException(
        "수금 연결은 같은 현장의 유효한 수금 ID여야 합니다.",
      );
    this.repo.saveSale({
      ...fields,
      siteId,
      status: value.status as SalesInvoiceView["status"],
      receiptIds,
    });
    return this.sale(siteId);
  }
  savePurchase(expenseId: string, body: unknown) {
    const existing = this.purchase(expenseId);
    const value = raw(body);
    if (
      !PURCHASE_INVOICE_STATUSES.includes(
        value.status as PurchaseInvoiceView["status"],
      )
    )
      throw new BadRequestException("수취상태를 확인해 주세요.");
    const fields = metadata(value, value.status === "수취완료");
    if (
      fields.supplyAmount !== existing.supplyAmount ||
      fields.vat !== existing.vat
    )
      throw new BadRequestException(
        "매입 공급가액/VAT는 연결 지출과 같아야 합니다. 지출 화면에서 수정하세요.",
      );
    if (!fields.counterparty)
      throw new BadRequestException("공급업체는 필수입니다.");
    this.repo.savePurchase({
      ...fields,
      siteId: existing.siteId,
      expenseId,
      status: value.status as PurchaseInvoiceView["status"],
    });
    return this.purchase(expenseId);
  }
  saveWorker(siteId: string, workerId: string, body: unknown) {
    this.worker(siteId, workerId);
    const value = raw(body);
    if (
      !WORKER_INVOICE_STATUSES.includes(
        value.status as WorkerInvoiceView["status"],
      )
    )
      throw new BadRequestException("작업진행자 계산서 상태를 확인해 주세요.");
    const date = value.date ?? null;
    const approvalNumber = text(value, "approvalNumber");
    if (date !== null && (typeof date !== "string" || !validDate(date)))
      throw new BadRequestException("발행일을 확인해 주세요.");
    if (value.status === "발행완료" && (!date || !approvalNumber))
      throw new BadRequestException(
        "발행완료에는 날짜와 승인번호가 필요합니다.",
      );
    this.repo.saveWorker({
      siteId,
      workerId,
      status: value.status as WorkerInvoiceView["status"],
      date: date as string | null,
      approvalNumber,
      notes: text(value, "notes"),
    });
    return this.worker(siteId, workerId);
  }
}
