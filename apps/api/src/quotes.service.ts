import { QUOTE_ADMIN_ACCESS, QuoteAdminAccess } from "./quote-access";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Customer,
  CustomerQuote,
  Quote,
  QuoteInput,
  QuoteItemInput,
  QUOTE_STATUSES,
  QUOTE_SECTIONS,
  QUOTE_PRICE_CATEGORIES,
  QUOTE_PRINT_MODES,
  calculateQuote,
  QuoteView,
} from "@jongno/shared";
import {
  CUSTOMERS_REPOSITORY,
  CustomersRepository,
} from "./customers.repository";
import { QUOTES_REPOSITORY, QuotesRepository } from "./quotes.repository";
import { SitesService } from "./sites.service";
import { validDate, seoulToday } from "./date";
function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("견적 입력값을 확인해 주세요.");
  return value as Record<string, unknown>;
}
function text(
  raw: Record<string, unknown>,
  key: string,
  max = 300,
  required = false,
) {
  const v = raw[key] ?? "";
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\u0000-\u0008\u000b-\u001f]/.test(v) ||
    (required && !v.trim())
  )
    throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
  return v.trim();
}
function money(v: unknown) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new BadRequestException(
      "단가와 비용은 0 이상의 원 단위 정수여야 합니다.",
    );
  return v;
}
@Injectable()
export class QuotesService {
  constructor(
    @Inject(QUOTES_REPOSITORY) private readonly repository: QuotesRepository,
    @Inject(CUSTOMERS_REPOSITORY)
    private readonly customers: CustomersRepository,
    @Inject(SitesService) private readonly sites: SitesService,
    @Inject(QUOTE_ADMIN_ACCESS) private readonly access: QuoteAdminAccess,
  ) {}
  customersList() {
    return this.customers.list();
  }
  createCustomer(body: unknown) {
    this.access.assertAdmin();
    const raw = object(body);
    return this.customers.create({
      name: text(raw, "name", 300, true),
      address: text(raw, "address"),
      contactName: text(raw, "contactName"),
      phone: text(raw, "phone"),
    });
  }
  private record(id: string) {
    const q = this.repository.find(id);
    if (!q) throw new NotFoundException("견적을 찾을 수 없습니다.");
    return q;
  }
  private view(q: Quote): QuoteView {
    try {
      return { ...q, ...calculateQuote(q) };
    } catch {
      throw new BadRequestException("견적 금액 범위를 초과했습니다.");
    }
  }
  list(search = "", status = "", from = "", to = "") {
    this.access.assertAdmin();
    if (
      [search, status, from, to].some((v) => typeof v !== "string") ||
      search.length > 300 ||
      (status && !QUOTE_STATUSES.includes(status as QuoteInput["status"])) ||
      (from && !validDate(from)) ||
      (to && !validDate(to)) ||
      (from && to && from > to)
    )
      throw new BadRequestException("견적 검색 조건을 확인해 주세요.");
    const needle = search.trim().toLowerCase();
    return this.repository
      .list()
      .filter(
        (q) =>
          (!status || q.status === status) &&
          (!from || q.quoteDate >= from) &&
          (!to || q.quoteDate <= to) &&
          [
            q.id,
            q.siteName,
            q.customerName,
            q.address,
            q.workContent,
            ...q.sections.flatMap((s) => s.items.map((i) => i.name)),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((q) => this.view(q));
  }
  find(id: string) {
    this.access.assertAdmin();
    return this.view(this.record(id));
  }
  private input(body: unknown): QuoteInput {
    const r = object(body),
      customerId = text(r, "customerId", 300, true);
    if (!this.customers.find(customerId))
      throw new BadRequestException("거래처를 선택해 주세요.");
    const siteId = r.siteId ?? null;
    if (siteId !== null && typeof siteId !== "string")
      throw new BadRequestException("현장 연결을 확인해 주세요.");
    if (siteId) this.sites.find(siteId);
    const quoteDate = text(r, "quoteDate"),
      validUntil = text(r, "validUntil");
    if (
      !validDate(quoteDate) ||
      !validDate(validUntil) ||
      validUntil < quoteDate
    )
      throw new BadRequestException("견적일과 유효기간을 확인해 주세요.");
    if (
      !QUOTE_STATUSES.includes(r.status as QuoteInput["status"]) ||
      r.status === "계약전환"
    )
      throw new BadRequestException("계약전환은 현장 생성으로 처리합니다.");
    const rounding = r.rounding ?? "천원 반올림",
      displayUnit = r.displayUnit ?? "만원";
    if (
      !["천원 반올림", "반올림 없음"].includes(rounding as string) ||
      !["만원", "원"].includes(displayUnit as string)
    )
      throw new BadRequestException("가격 표시 옵션을 확인해 주세요.");
    if (
      !Array.isArray(r.sections) ||
      r.sections.length < 1 ||
      r.sections.length > 2
    )
      throw new BadRequestException("기계 또는 전기 을지를 추가해 주세요.");
    const sections = r.sections.map((value) => {
      const s = object(value);
      if (
        !QUOTE_SECTIONS.includes(s.kind as "기계" | "전기") ||
        !Array.isArray(s.items) ||
        s.items.length > 100
      )
        throw new BadRequestException("을지 구분과 항목 수를 확인해 주세요.");
      return {
        kind: s.kind as "기계" | "전기",
        items: s.items.map((value) => {
          const i = object(value);
          const quantity = i.quantity;
          if (
            typeof quantity !== "number" ||
            !Number.isFinite(quantity) ||
            quantity < 0.001 ||
            quantity > 1_000_000 ||
            Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001
          )
            throw new BadRequestException(
              "수량은 양수, 소수 3자리까지 입력해 주세요.",
            );
          if (
            !QUOTE_PRICE_CATEGORIES.includes(
              i.priceCategory as QuoteItemInput["priceCategory"],
            )
          )
            throw new BadRequestException("고객금액 분류를 확인해 주세요.");
          return {
            trade: text(i, "trade", 100, true),
            name: text(i, "name", 300, true),
            specification: text(i, "specification"),
            quantity,
            unit: text(i, "unit", 30, true),
            materialUnitCost: money(i.materialUnitCost),
            laborUnitCost: money(i.laborUnitCost),
            expenseUnitCost: money(i.expenseUnitCost),
            saleUnitPrice: money(i.saleUnitPrice),
            priceCategory: i.priceCategory as QuoteItemInput["priceCategory"],
            notes: text(i, "notes", 1000),
          };
        }),
      };
    });
    if (
      new Set(sections.map((s) => s.kind)).size !== sections.length ||
      !sections.some((s) => s.items.length)
    )
      throw new BadRequestException(
        "을지 중복 없이 견적항목을 1건 이상 입력해 주세요.",
      );
    const input: QuoteInput = {
      customerId,
      siteId: siteId || null,
      siteName: text(r, "siteName", 300, true),
      address: text(r, "address"),
      workContent: text(r, "workContent", 5000),
      quoteDate,
      validUntil,
      status: r.status as QuoteInput["status"],
      notes: text(r, "notes", 5000),
      generalFee: money(r.generalFee),
      supportFee: money(r.supportFee),
      internalGeneralCost: money(r.internalGeneralCost ?? 0),
      internalSupportCost: money(r.internalSupportCost ?? 0),
      rounding: rounding as QuoteInput["rounding"],
      displayUnit: displayUnit as QuoteInput["displayUnit"],
      sections,
    };
    try {
      calculateQuote(input);
    } catch {
      throw new BadRequestException("견적 금액 범위를 초과했습니다.");
    }
    return input;
  }
  save(body: unknown, id?: string) {
    this.access.assertAdmin();
    const existing = id ? this.record(id) : undefined;
    if (existing?.convertedSiteId)
      throw new ConflictException(
        "계약전환된 견적은 복사하여 새 견적으로 수정해 주세요.",
      );
    const input = this.input(body);
    const now = new Date().toISOString();
    const quote: Quote = {
      ...input,
      id: id ?? randomUUID(),
      customerName: this.customers.find(input.customerId)!.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      convertedSiteId: null,
    };
    this.repository.save(quote);
    return this.find(quote.id);
  }
  copy(id: string) {
    this.access.assertAdmin();
    const source = this.record(id);
    const copy = {
      ...source,
      id: randomUUID(),
      siteName: source.siteName.slice(0, 295) + " (복사)",
      status: "작성중" as const,
      convertedSiteId: null,
      quoteDate: seoulToday(),
      validUntil: new Date(Date.parse(seoulToday()) + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.repository.save(copy);
    return this.find(copy.id);
  }
  remove(id: string) {
    this.access.assertAdmin();
    const q = this.record(id);
    if (q.convertedSiteId)
      throw new ConflictException("계약전환된 견적은 삭제할 수 없습니다.");
    this.repository.remove(id);
    return { deleted: true };
  }
  convert(id: string, body: unknown) {
    this.access.assertAdmin();
    const q = this.record(id);
    if (q.convertedSiteId) return this.sites.find(q.convertedSiteId);
    if (q.status !== "승인")
      throw new ConflictException("승인된 견적만 현장으로 전환할 수 있습니다.");
    const r = object(body),
      startDate = text(r, "startDate"),
      endDate = text(r, "endDate");
    if (
      !validDate(startDate) ||
      (endDate && (!validDate(endDate) || endDate < startDate))
    )
      throw new BadRequestException("공사기간을 확인해 주세요.");
    const customer = this.customers.find(q.customerId)!;
    // Both operations are synchronous in this adapter. PostgreSQL must wrap these in a transaction with a quote row lock and unique convertedSiteId.
    const site = this.sites.create({
      name: q.siteName,
      client: customer.name,
      clientId: q.customerId,
      address: q.address,
      description: q.workContent,
      contactName: customer.contactName,
      phone: customer.phone,
      startDate,
      endDate,
      contractAmount: this.view(q).totals.totalAmount,
      trades: q.sections.filter((s) => s.items.length).map((s) => s.kind),
      tradeNames: [
        ...new Set(q.sections.flatMap((s) => s.items.map((i) => i.trade))),
      ],
      manager: null,
      managerId: null,
      status: "미배정",
    });
    this.repository.save({
      ...q,
      status: "계약전환",
      convertedSiteId: site.id,
      updatedAt: new Date().toISOString(),
    });
    return site;
  }
  customer(id: string, mode: string = "전체 상세"): CustomerQuote {
    if (!QUOTE_PRINT_MODES.includes(mode as CustomerQuote["printMode"]))
      throw new BadRequestException("출력모드를 확인해 주세요.");
    const q = this.view(this.record(id));
    return {
      id: q.id,
      customerName: q.customerName,
      siteName: q.siteName,
      address: q.address,
      workContent: q.workContent,
      quoteDate: q.quoteDate,
      validUntil: q.validUntil,
      notes: q.notes,
      displayUnit: q.displayUnit,
      printMode: mode as CustomerQuote["printMode"],
      totals: { ...q.totals },
      sections: q.sections.map((s) => ({
        kind: s.kind,
        items: s.items.map((i) => ({
          trade: i.trade,
          name: i.name,
          specification: i.specification,
          quantity: i.quantity,
          unit: i.unit,
          saleUnitPrice: i.saleUnitPrice,
          amount: importAmount(i.quantity, i.saleUnitPrice),
          notes: i.notes,
        })),
      })),
    };
  }
}
import { quoteLineAmount as importAmount } from "@jongno/shared";
