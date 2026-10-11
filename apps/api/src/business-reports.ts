import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import { CompanyContext } from "./company-context";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { QUOTES_REPOSITORY, QuotesRepository } from "./quotes.repository";
import { EXPENSES_REPOSITORY, ExpensesRepository } from "./expenses.repository";
import { FINANCE_REPOSITORY, FinanceRepository } from "./finance.repository";
import { INVOICES_REPOSITORY, InvoicesRepository } from "./invoices.repository";
import { FinanceService, sum } from "./finance.service";
import { validDate, validateMonth } from "./date";
type PerformanceInput = {
  year: number;
  status: "실적신고 대상" | "제외" | "검토필요";
  contractDate: string;
  completedDate: string;
  mechanical: number | null;
  electrical: number | null;
  constructionType: string;
  workType: string;
  notes: string;
};
@Injectable()
export class BusinessReportsService {
  private records = new Map<string, Map<string, PerformanceInput>>();
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(QUOTES_REPOSITORY) private quotes: QuotesRepository,
    @Inject(FINANCE_REPOSITORY) private payments: FinanceRepository,
    @Inject(EXPENSES_REPOSITORY) private expenses: ExpensesRepository,
    @Inject(INVOICES_REPOSITORY) private invoices: InvoicesRepository,
    @Inject(FinanceService) private finance: FinanceService,
  ) {}
  private partition() {
    this.company.assertMember(true);
    const id = this.company.companyId;
    if (!this.records.has(id)) this.records.set(id, new Map());
    return this.records.get(id)!;
  }
  collections() {
    this.company.assertMember(true);
    return this.sites
      .list()
      .filter((s) => !s.deletedAt)
      .map((s) => {
        const f = this.finance.siteFinance(s.id),
          receipts = this.finance.receipts(s.id),
          contract = f.contractAmount;
        return {
          ...f,
          siteName: s.name,
          client: s.client,
          supplyAmount: Math.round(contract / 1.1),
          vat: contract - Math.round(contract / 1.1),
          outstanding: Math.max(0, f.receivables),
          overpayment: Math.max(0, -f.receivables),
          collectionStatus:
            f.collectedAmount > contract
              ? "초과입금"
              : f.collectedAmount === contract
                ? "수금완료"
                : f.collectedAmount > 0
                  ? "일부수금"
                  : "미수",
          lastReceivedDate:
            receipts
              .map((r) => r.receivedDate)
              .sort()
              .at(-1) ?? null,
          receipts,
        };
      });
  }
  monthly(month: string) {
    validateMonth(month);
    const rows = this.collections(),
      expenses = this.expenses
        .list()
        .filter((e) => e.expenseDate.startsWith(month)),
      receipts = this.payments
        .receipts()
        .filter((r) => r.receivedDate.startsWith(month)),
      payments = this.payments
        .payments()
        .filter((p) => p.paymentDate.startsWith(month)),
      contracts = this.sites
        .list()
        .filter((s) => !s.deletedAt && s.startDate.startsWith(month));
    const settlements = this.finance.settlements();
    return {
      month,
      criteria:
        "계약액은 착공월 기준, 수금·지출·지급은 발생일 기준입니다. 미수·미지급은 현재 잔액입니다.",
      contractAmount: sum(contracts.map((s) => s.contractAmount)),
      received: sum(receipts.map((r) => r.amount)),
      outstanding: sum(rows.map((r) => r.outstanding)),
      expenses: sum(expenses.map((e) => e.totalAmount)),
      workerPaid: sum(payments.map((p) => p.amount)),
      workerUnpaid: settlements.totals.unpaidAmount,
      salesInvoices: sum(
        this.sites
          .list()
          .map((s) => this.invoices.sale(s.id))
          .filter((i) => i?.status === "발행완료" && i.date?.startsWith(month))
          .map((i) => i!.supplyAmount + i!.vat),
      ),
      purchaseInvoices: sum(
        this.expenses
          .list()
          .map((e) => this.invoices.purchase(e.id))
          .filter((i) => i?.status === "수취완료" && i.date?.startsWith(month))
          .map((i) => i!.supplyAmount + i!.vat),
      ),
      siteProfit: sum(rows.map((r) => r.siteProfit)),
      sites: rows.filter(
        (r) =>
          contracts.some((s) => s.id === r.siteId) ||
          receipts.some((p) => p.siteId === r.siteId) ||
          expenses.some((e) => e.siteId === r.siteId),
      ),
      profitCriteria:
        "현장차익은 현재 누적 계약매출(유상 A/S 포함) - 직접 현장원가입니다. 회사 세금·보험·고정비는 포함하지 않습니다.",
    };
  }
  annual(year: number, includeOutstanding = true) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new BadRequestException("연도를 확인하세요.");
    const records = this.partition();
    const rows = this.sites
      .list()
      .filter(
        (s) =>
          !s.deletedAt &&
          s.status === "완료" &&
          (records.get(s.id)?.year ?? Number(s.endDate?.slice(0, 4))) === year,
      )
      .map((s) => {
        const saved = records.get(s.id);
        const quote = this.quotes
          .list()
          .find((q) => q.convertedSiteId === s.id);
        const inv = this.invoices.sale(s.id),
          f = this.finance.siteFinance(s.id);
        const part = (kind: "기계" | "전기") => {
          const section = quote?.sections.find((v) => v.kind === kind);
          return section
            ? sum(
                section.items.map((i) =>
                  Math.round(i.quantity * i.saleUnitPrice),
                ),
              )
            : null;
        };
        const mechanical = saved?.mechanical ?? part("기계"),
          electrical = saved?.electrical ?? part("전기");
        return {
          siteId: s.id,
          year,
          siteName: s.name,
          client: s.client,
          workName: quote?.workContent || s.description,
          address: s.address,
          contractDate: saved?.contractDate || "",
          startDate: s.startDate,
          completedDate: saved?.completedDate || "",
          contractAmount: s.contractAmount,
          mechanical,
          electrical,
          constructionType: saved?.constructionType || "",
          workType: saved?.workType || "",
          invoiceAmount:
            inv?.status === "발행완료" ? inv.supplyAmount + inv.vat : 0,
          received: f.collectedAmount,
          outstanding: f.receivables,
          completed: true,
          status: saved?.status ?? "검토필요",
          notes: saved?.notes ?? "준공일과 기계·전기 구분금액을 검토하세요.",
          sourceNotice: quote
            ? "구분금액 자동값: 계약전환 견적 을지 판매금액(공급가액, 공통 경비 배분 전)"
            : "구분금액 미입력",
        };
      })
      .filter((r) => includeOutstanding || r.outstanding <= 0);
    const targets = rows.filter((r) => r.status === "실적신고 대상");
    return {
      companyId: this.company.companyId,
      year,
      includeOutstanding,
      rows,
      summary: {
        completedSites: rows.length,
        targetSites: targets.length,
        reviewSites: rows.filter((r) => r.status === "검토필요").length,
        totalContract: sum(targets.map((r) => r.contractAmount)),
        mechanical: sum(targets.map((r) => r.mechanical ?? 0)),
        electrical: sum(targets.map((r) => r.electrical ?? 0)),
        missingAmounts: targets.filter(
          (r) => r.mechanical === null || r.electrical === null,
        ).length,
      },
    };
  }
  save(siteId: string, b: PerformanceInput) {
    const p = this.partition(),
      s = this.sites.find(siteId);
    if (!s || s.deletedAt || s.status !== "완료")
      throw new BadRequestException("완료 현장만 실적으로 관리합니다.");
    if (
      !b ||
      !["실적신고 대상", "제외", "검토필요"].includes(b.status) ||
      !Number.isInteger(b.year) ||
      b.year < 2000 ||
      b.year > 2100
    )
      throw new BadRequestException("실적 상태와 연도를 확인하세요.");
    for (const d of [b.contractDate, b.completedDate])
      if (d && !validDate(d))
        throw new BadRequestException("유효한 날짜를 입력하세요.");
    for (const n of [b.mechanical, b.electrical])
      if (n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 1e12))
        throw new BadRequestException(
          "구분금액은 0 이상의 정수 또는 미입력이어야 합니다.",
        );
    for (const k of ["constructionType", "workType", "notes"] as const)
      if (typeof b[k] !== "string" || b[k].length > 3000)
        throw new BadRequestException("실적 정보를 확인하세요.");
    if (
      b.status === "실적신고 대상" &&
      (!b.completedDate || b.mechanical === null || b.electrical === null)
    )
      throw new BadRequestException(
        "신고 대상으로 지정하기 전에 준공일과 기계·전기 금액(해당없음은 0)을 확인하세요.",
      );
    p.set(siteId, structuredClone(b));
    return b;
  }
  async export(year: number, format: string, includeOutstanding = true) {
    const a = this.annual(year, includeOutstanding);
    const headers = [
      "연도",
      "현장명",
      "발주처",
      "공사명",
      "주소",
      "계약일",
      "착공일",
      "준공일",
      "계약금액(VAT 포함)",
      "기계금액",
      "전기금액",
      "공사종류",
      "공사구분",
      "발행세금계산서",
      "실제수금",
      "신고상태",
      "비고",
      "준공 여부",
    ];
    const rows = a.rows.map((r) => [
      r.year,
      r.siteName,
      r.client,
      r.workName,
      r.address,
      r.contractDate,
      r.startDate,
      r.completedDate,
      r.contractAmount,
      r.mechanical ?? "미입력",
      r.electrical ?? "미입력",
      r.constructionType,
      r.workType,
      r.invoiceAmount,
      r.received,
      r.status,
      r.notes,
      r.completed ? "준공 확인 대상" : "미준공",
    ]);
    if (format === "csv")
      return Buffer.from(
        "\ufeff" +
          [headers, ...rows]
            .map((row) =>
              row
                .map(
                  (v) =>
                    '"' +
                    String(v)
                      .replace(/^[=+@-]/, "'$&")
                      .replaceAll('"', '""') +
                    '"',
                )
                .join(","),
            )
            .join("\r\n"),
      );
    const wb = new ExcelJS.Workbook(),
      sh = wb.addWorksheet("연간실적");
    sh.columns = headers.map((header) => ({ header, width: 22 }));
    rows.forEach((r) => sh.addRow(r));
    sh.getRow(1).font = { bold: true };
    sh.views = [{ state: "frozen", ySplit: 1 }];
    sh.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
      printArea: `A1:R${rows.length + 1}`,
    };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
@Controller("business-reports")
export class BusinessReportsController {
  constructor(
    @Inject(BusinessReportsService) private service: BusinessReportsService,
  ) {}
  @Get("collections") collections() {
    return this.service.collections();
  }
  @Get("monthly") monthly(@Query("month") m: string) {
    return this.service.monthly(m);
  }
  @Get("performance") annual(
    @Query("year") y: string,
    @Query("includeOutstanding") i: string,
  ) {
    return this.service.annual(Number(y), i !== "false");
  }
  @Put("performance/:id") save(
    @Param("id") id: string,
    @Body() b: PerformanceInput,
  ) {
    return this.service.save(id, b);
  }
  @Get("performance/export") async export(
    @Query("year") y: string,
    @Query("format") f: string,
    @Query("includeOutstanding") i: string,
    @Res() res: any,
  ) {
    if (!["xlsx", "csv"].includes(f)) throw new BadRequestException();
    res.setHeader(
      "Content-Type",
      f === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="performance_${y}.${f}"`,
    );
    res.send(await this.service.export(Number(y), f, i !== "false"));
  }
}
