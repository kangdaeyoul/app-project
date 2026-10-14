import {
  AS_REPOSITORY,
  AfterServiceRepository,
} from "./after-service.repository";
import { cleanCompanyProfile, companyPresentation } from "./quote-presentation";
import { CompanyContext } from "./company-context";
import { AuditRecorder } from "./audit-recorder";
import { QUOTE_ADMIN_ACCESS, QuoteAdminAccess } from "./quote-access";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
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
  QuoteListRow,
  quotePublicNotes,
} from "@jongro/shared";
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
    @Inject(AS_REPOSITORY) private asRepo: AfterServiceRepository,
    @Inject(QUOTES_REPOSITORY) private readonly repository: QuotesRepository,
    @Inject(CUSTOMERS_REPOSITORY)
    private readonly customers: CustomersRepository,
    @Inject(SitesService) private readonly sites: SitesService,
    @Inject(QUOTE_ADMIN_ACCESS) private readonly access: QuoteAdminAccess,
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
    @Inject(CompanyContext) private readonly context: CompanyContext,
  ) {}
  freezeCompanySnapshots() {
    for (const q of this.repository.list())
      if (!q.companySnapshot || !q.customerSnapshot) {
        const c = this.customers.find(q.customerId);
        this.repository.save({
          ...q,
          companySnapshot:
            q.companySnapshot ?? companyPresentation(this.context.settings()),
          customerSnapshot: q.customerSnapshot ?? {
            name: q.customerName,
            recipient: q.customerName,
            address: c?.address ?? "",
            contactName: c?.contactName ?? "",
            phone: c?.phone ?? "",
            registrationNumber: c?.registrationNumber ?? "",
          },
        });
      }
  }
  customersList() {
    const quotes = this.repository
      .list()
      .filter(
        (q) =>
          !this.context.identity.authenticated ||
          this.context.identity.appRole === "admin" ||
          (!!q.siteId &&
            this.context.identity.accessibleSiteIds?.includes(q.siteId)),
      );
    return this.customers.list().map((c) => ({
      ...c,
      quoteCount: quotes.filter((q) => q.customerId === c.id).length,
      recentQuoteDate:
        quotes
          .filter((q) => q.customerId === c.id)
          .map((q) => q.quoteDate)
          .sort()
          .at(-1) ?? "",
    }));
  }
  customerDetails(id: string) {
    this.access.assertAdmin();
    const c = this.customers.find(id);
    if (!c || c.deletedAt)
      throw new NotFoundException("거래처를 찾을 수 없습니다.");
    return {
      ...c,
      quotes: this.list().filter((q) => q.customerId === id),
      sites: this.sites
        .list()
        .filter(
          (s) =>
            s.clientId === id &&
            (!this.context.identity.authenticated ||
              this.context.identity.appRole === "admin" ||
              this.context.identity.accessibleSiteIds?.includes(s.id)),
        ),
    };
  }
  updateCustomer(id: string, body: unknown) {
    this.context.assertMember(true);
    if (!this.customers.find(id))
      throw new NotFoundException("거래처를 찾을 수 없습니다.");
    const raw = object(body);
    const value = {
      name: text(raw, "name", 300, true),
      address: text(raw, "address"),
      contactName: text(raw, "contactName"),
      phone: text(raw, "phone"),
      registrationNumber: text(raw, "registrationNumber", 100),
    };
    this.freezeCompanySnapshots();
    return this.customers.update(id, value);
  }
  removeCustomer(id: string) {
    this.context.assertMember(true);
    if (!this.customers.find(id))
      throw new NotFoundException("거래처를 찾을 수 없습니다.");
    this.freezeCompanySnapshots();
    this.customers.remove(id);
    return { deleted: true };
  }
  createCustomer(body: unknown) {
    this.access.assertAdmin();
    const raw = object(body);
    return this.customers.create({
      name: text(raw, "name", 300, true),
      address: text(raw, "address"),
      contactName: text(raw, "contactName"),
      phone: text(raw, "phone"),
      registrationNumber: text(raw, "registrationNumber", 100),
    });
  }
  private record(id: string) {
    const q = this.repository.find(id);
    if (!q) throw new NotFoundException("견적을 찾을 수 없습니다.");
    if (
      this.context.identity.authenticated &&
      this.context.identity.appRole !== "admin" &&
      (!q.siteId ||
        !this.context.identity.accessibleSiteIds?.includes(q.siteId))
    )
      throw new ForbiddenException("허용된 현장의 견적만 이용할 수 있습니다.");
    return q;
  }
  private view(q: Quote): QuoteView {
    const currentCustomer = this.customers.find(q.customerId);
    q = {
      ...q,
      quoteNumber: q.quoteNumber ?? q.id,
      workPeriod: q.workPeriod ?? "",
      companySnapshot:
        q.companySnapshot ?? companyPresentation(this.context.settings()),
      customerSnapshot: q.customerSnapshot ?? {
        name: q.customerName,
        recipient: q.customerName,
        registrationNumber: currentCustomer?.registrationNumber ?? "",
        address: currentCustomer?.address ?? "",
        contactName: currentCustomer?.contactName ?? "",
        phone: currentCustomer?.phone ?? "",
      },
    };
    try {
      return {
        ...q,
        ...calculateQuote(q),
        quoteContactName:
          q.companySnapshot?.contactName ||
          q.customerSnapshot?.contactName ||
          "",
      };
    } catch {
      throw new BadRequestException("견적 금액 범위를 초과했습니다.");
    }
  }
  list(
    search = "",
    status = "",
    from = "",
    to = "",
    trade = "",
    sort = "updated",
  ) {
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
    if (
      !["", "기계", "전기", "기계+전기"].includes(trade) ||
      !["created", "updated", "amount", "client"].includes(sort)
    )
      throw new BadRequestException("견적 정렬/공종 필터를 확인하세요.");
    const needle = search.trim().toLowerCase();
    return this.repository
      .list()
      .filter(
        (q) =>
          (!this.context.identity.authenticated ||
            this.context.identity.appRole === "admin" ||
            (!!q.siteId &&
              this.context.identity.accessibleSiteIds?.includes(q.siteId))) &&
          (!status || q.status === status) &&
          (!trade ||
            ["기계", "전기"]
              .filter((k) =>
                q.sections.some((s) => s.kind === k && s.items.length),
              )
              .join("+") === trade) &&
          (!from || q.quoteDate >= from) &&
          (!to || q.quoteDate <= to) &&
          [
            q.id,
            q.quoteNumber ?? "",
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
      .sort((a, b) =>
        sort === "created"
          ? b.createdAt.localeCompare(a.createdAt)
          : sort === "amount"
            ? calculateQuote(b).totals.totalAmount -
              calculateQuote(a).totals.totalAmount
            : sort === "client"
              ? a.customerName.localeCompare(b.customerName, "ko")
              : b.updatedAt.localeCompare(a.updatedAt),
      )
      .map((q) => {
        const view = this.view(q);
        const { companySnapshot, ...withoutImages } = view;
        return withoutImages;
      });
  }
  index(
    search = "",
    status = "",
    from = "",
    to = "",
    trade = "",
    sort = "updated",
  ): QuoteListRow[] {
    return this.list(search, status, from, to, trade, sort).map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      customerId: q.customerId,
      customerName: q.customerName,
      siteName: q.siteName,
      workContent: q.workContent,
      quoteDate: q.quoteDate,
      validUntil: q.validUntil,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      status: q.status,
      siteId: q.siteId,
      convertedSiteId: q.convertedSiteId,
      quoteContactName: q.quoteContactName ?? "",
      totals: q.totals,
      sections: q.sections
        .filter((s) => s.items.length)
        .map((s) => ({ kind: s.kind, itemCount: s.items.length })),
    }));
  }
  find(id: string) {
    this.access.assertAdmin();
    return this.view(this.record(id));
  }
  private option(r: Record<string, unknown>, key: string, fallback: boolean) {
    if (r[key] !== undefined && typeof r[key] !== "boolean")
      throw new BadRequestException("견적 옵션을 확인해 주세요.");
    return (r[key] as boolean | undefined) ?? fallback;
  }
  private entrySources(v: unknown): QuoteItemInput["entrySources"] {
    if (v === undefined) return ["manual"];
    if (
      !Array.isArray(v) ||
      !v.length ||
      v.some((s) => !["manual", "catalog", "favorite", "standard"].includes(s))
    )
      throw new BadRequestException("품목 입력 출처를 확인해 주세요.");
    return [...new Set(v)] as QuoteItemInput["entrySources"];
  }
  private standardSources(v: unknown): QuoteItemInput["standardSources"] {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > 1000)
      throw new BadRequestException("구성품 출처를 확인해 주세요.");
    return v.map((x) => this.standardSource(x)!);
  }
  private standardSource(value: unknown): QuoteItemInput["standardSource"] {
    if (value === undefined) return undefined;
    const v = object(value);
    if (!Number.isSafeInteger(v.version) || (v.version as number) < 1)
      throw new BadRequestException("템플릿 버전을 확인해 주세요.");
    return {
      templateId: text(v, "templateId", 100, true),
      componentId: text(v, "componentId", 100, true),
      version: v.version as number,
    };
  }
  private customerItems(q: QuoteView, items: QuoteItemInput[]) {
    items = items.filter((i) => i.name.trim());
    if (!q.groupComponents) return items;
    const result: QuoteItemInput[] = [];
    for (const i of items) {
      if (!i.customerGroup) {
        result.push(i);
        continue;
      }
      const existing = result.find(
        (j) =>
          j.customerGroup === i.customerGroup &&
          j.trade === i.trade &&
          j.priceCategory === i.priceCategory,
      );
      const amount = importAmount(i.quantity, i.saleUnitPrice);
      if (existing) existing.saleUnitPrice += amount;
      else
        result.push({
          ...i,
          name: i.customerGroup,
          specification: "",
          quantity: 1,
          unit: "식",
          saleUnitPrice: amount,
          notes: "",
        });
    }
    return result;
  }
  private laborBasis(value: unknown): QuoteItemInput["laborBasis"] {
    const r = object(value);
    for (const key of ["base", "extra", "workQuantity"])
      if (
        typeof r[key] !== "number" ||
        !Number.isFinite(r[key]) ||
        (r[key] as number) < 0 ||
        (r[key] as number) > 1000000
      )
        throw new BadRequestException("노무 산출 이력을 확인하세요.");
    return {
      templateId: text(r, "templateId", 100, true),
      base: r.base as number,
      extra: r.extra as number,
      workQuantity: r.workQuantity as number,
    };
  }
  private input(body: unknown, existing?: Quote): QuoteInput {
    const r = object(body),
      customerId = text(r, "customerId", 300);
    if (
      customerId &&
      (!this.customers.find(customerId) ||
        this.customers.find(customerId)?.deletedAt) &&
      existing?.customerId !== customerId
    )
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
      throw new BadRequestException(
        "기계 또는 전기 상세 내역서를 추가해 주세요.",
      );
    const sections = r.sections.map((value) => {
      const s = object(value);
      if (
        !QUOTE_SECTIONS.includes(s.kind as "기계" | "전기") ||
        !Array.isArray(s.items) ||
        s.items.length > 100
      )
        throw new BadRequestException(
          "상세 내역서 구분과 항목 수를 확인해 주세요.",
        );
      return {
        kind: s.kind as "기계" | "전기",
        items: s.items.map((value) => {
          const i = object(value);
          const quantity = i.quantity;
          if (
            typeof quantity !== "number" ||
            !Number.isFinite(quantity) ||
            quantity < 0 ||
            (quantity === 0 && i.quantityPending !== true) ||
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
            laborBasis:
              i.laborBasis === undefined
                ? undefined
                : this.laborBasis(i.laborBasis),
            quantityPending: this.option(i, "quantityPending", false),
            calculationBasis: text(i, "calculationBasis", 1000),
            constructionKey: text(i, "constructionKey", 300),
            accumulation:
              i.accumulation === undefined
                ? undefined
                : ["sum", "max"].includes(i.accumulation as string)
                  ? (i.accumulation as "sum" | "max")
                  : (() => {
                      throw new BadRequestException("합산정책을 확인하세요.");
                    })(),
            accumulationScope: text(i, "accumulationScope", 500),
            manualQuantity: this.option(i, "manualQuantity", false),
            autoGenerated: this.option(i, "autoGenerated", false),
            reviewNotice: text(i, "reviewNotice", 500),
            pricePending: this.option(i, "pricePending", false),
            materialCode: text(i, "materialCode", 100),
            entrySources: this.entrySources(i.entrySources),
            standardSources: this.standardSources(i.standardSources),
            customerGroup: text(i, "customerGroup", 100),
            standardSource: this.standardSource(i.standardSource),
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
        "상세 내역서 중복 없이 견적항목을 1건 이상 입력해 주세요.",
      );
    if (
      r.status !== "작성중" &&
      r.status !== "검토중" &&
      r.status !== "수정요청" &&
      sections.some((s) =>
        s.items.some(
          (i) => i.quantityPending || (i.pricePending && i.saleUnitPrice === 0),
        ),
      )
    )
      throw new BadRequestException(
        "현장산출 필요 수량과 미등록 단가를 확인한 뒤 제출하세요.",
      );
    if (
      r.groupComponents !== undefined &&
      typeof r.groupComponents !== "boolean"
    )
      throw new BadRequestException("구성품 출력 옵션을 확인해 주세요.");
    const input: QuoteInput = {
      autoPrice: this.option(
        r,
        "autoPrice",
        this.context.settings().quotePreferences?.autoPrice ?? true,
      ),
      mergeDuplicates: this.option(r, "mergeDuplicates", true),
      mergeAcrossSources: this.option(r, "mergeAcrossSources", true),
      groupComponents: r.groupComponents === true,
      companySnapshot: cleanCompanyProfile(
        r.companySnapshot ?? companyPresentation(this.context.settings()),
        this.context.settings(),
      ),
      customerSnapshot: (() => {
        const c = this.customers.find(customerId),
          v =
            r.customerSnapshot === undefined
              ? {
                  name: c?.name ?? "",
                  recipient: c?.name ?? "",
                  address: c?.address ?? "",
                  contactName: c?.contactName ?? "",
                  phone: c?.phone ?? "",
                  registrationNumber: c?.registrationNumber ?? "",
                }
              : object(r.customerSnapshot);
        return {
          name: text(v, "name"),
          recipient: text(v, "recipient"),
          address: text(v, "address"),
          contactName: text(v, "contactName"),
          phone: text(v, "phone"),
          registrationNumber: text(v, "registrationNumber"),
        };
      })(),
      workPeriod: text(r, "workPeriod", 300),
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
  private readonly quoteSequences = new Map<string, number>();
  private nextQuoteNumber(date: string) {
    const prefix = `Q-${date.replaceAll("-", "")}-`;
    const max = this.repository
      .list()
      .filter((q) => q.quoteNumber?.startsWith(prefix))
      .reduce(
        (m, q) => Math.max(m, Number(q.quoteNumber!.slice(prefix.length)) || 0),
        0,
      );
    const key = this.context.companyId + ":" + prefix;
    const next = Math.max(max, this.quoteSequences.get(key) ?? 0) + 1;
    this.quoteSequences.set(key, next);
    return prefix + String(next).padStart(4, "0");
  }
  save(body: unknown, id?: string) {
    this.access.assertAdmin();
    const existing = id ? this.record(id) : undefined;
    if (existing?.convertedSiteId)
      throw new ConflictException(
        "계약전환된 견적은 복사하여 새 견적으로 수정해 주세요.",
      );
    if (
      this.context.identity.authenticated &&
      this.context.identity.appRole !== "admin"
    ) {
      const r = object(body);
      if (
        typeof r.siteId !== "string" ||
        !this.context.identity.accessibleSiteIds?.includes(r.siteId)
      )
        throw new ForbiddenException("허용된 현장에 연결해야 합니다.");
      if (
        !["작성중", "검토중", "제출완료", "수정요청"].includes(
          r.status as string,
        )
      )
        throw new ForbiddenException(
          "견적 승인과 계약전환은 관리자 업무입니다.",
        );
      r.internalGeneralCost = existing?.internalGeneralCost ?? 0;
      r.internalSupportCost = existing?.internalSupportCost ?? 0;
      const base =
        existing?.companySnapshot ??
        companyPresentation(this.context.settings());
      const requested =
        r.companySnapshot === undefined ? base : object(r.companySnapshot);
      r.companySnapshot = {
        ...requested,
        companyId: this.context.companyId,
        name: base.name,
        representative: base.representative,
        registrationNumber: base.registrationNumber,
        bankInfo: base.bankInfo,
        logo: base.logo,
        seal: base.seal,
      };
      if (Array.isArray(r.sections)) {
        for (const value of r.sections) {
          const section = object(value);
          if (!Array.isArray(section.items)) continue;
          for (const [position, value] of section.items.entries()) {
            const item = object(value);
            const prior = existing?.sections.find(
              (s) => s.kind === section.kind,
            )?.items[position];
            for (const key of [
              "materialUnitCost",
              "laborUnitCost",
              "expenseUnitCost",
            ] as const)
              item[key] = prior?.[key] ?? 0;
          }
        }
      }
    }
    const raw = { ...object(body) };
    const reference =
      existing ??
      (typeof raw.id === "string" ? this.repository.find(raw.id) : undefined);
    if (
      reference &&
      raw.customerId !== reference.customerId &&
      (raw.customerSnapshot === undefined ||
        JSON.stringify(raw.customerSnapshot) ===
          JSON.stringify(this.view(reference).customerSnapshot))
    )
      delete raw.customerSnapshot;
    if (existing) {
      raw.companySnapshot ??=
        existing.companySnapshot ??
        companyPresentation(this.context.settings());
      if (raw.customerId === existing.customerId)
        raw.customerSnapshot ??= this.view(existing).customerSnapshot;
    }
    const input = this.input(raw, existing);
    const now = new Date().toISOString();
    const quote: Quote = {
      ...input,
      id: id ?? randomUUID(),
      quoteNumber:
        existing?.quoteNumber ??
        existing?.id ??
        this.nextQuoteNumber(input.quoteDate),
      customerName:
        input.customerSnapshot?.name ??
        this.customers.find(input.customerId)?.name ??
        "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      convertedSiteId: null,
    };
    this.repository.save(quote);
    return this.find(quote.id);
  }
  copy(id: string) {
    this.access.assertAdmin();
    const source = this.find(id);
    const copy = {
      ...source,
      id: randomUUID(),
      quoteNumber: this.nextQuoteNumber(seoulToday()),
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
    this.audit.withOperation(
      {
        action: "복사",
        reason: `${this.audit.reason ? this.audit.reason + " / " : ""}원본 견적 ${source.id} 복사`,
      },
      () => this.repository.save(copy),
    );
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
    const asRequest = this.asRepo
      .list()
      .find((a) => a.generatedQuoteIds?.includes(q.id));
    if (asRequest) {
      if (asRequest.billing !== "유상")
        throw new ConflictException("유상 A/S만 계약전환할 수 있습니다.");
      const asUpdated = this.asRepo.save({
        ...asRequest,
        chargeAmount: this.view(q).totals.totalAmount,
        updatedAt: new Date().toISOString(),
      });
      this.audit.record({
        targetType: "A/S",
        targetId: asRequest.id,
        action: "수정",
        before: asRequest,
        after: asUpdated,
        siteIds: [asRequest.siteId],
        reason: "A/S 견적 계약전환",
      });
      this.repository.save({
        ...q,
        status: "계약전환",
        convertedSiteId: asRequest.siteId,
        updatedAt: new Date().toISOString(),
      });
      return this.sites.find(asRequest.siteId);
    }
    const r = object(body),
      startDate = text(r, "startDate"),
      endDate = text(r, "endDate");
    if (
      !validDate(startDate) ||
      (endDate && (!validDate(endDate) || endDate < startDate))
    )
      throw new BadRequestException("공사기간을 확인해 주세요.");
    const customer = q.customerSnapshot ??
      this.customers.find(q.customerId) ?? {
        name: q.customerName,
        contactName: "",
        phone: "",
      };
    // Both operations are synchronous in this adapter. PostgreSQL must wrap these in a transaction with a quote row lock and unique convertedSiteId.
    const site = this.sites.create({
      name: q.siteName,
      client: customer.name,
      clientId: this.customers.find(q.customerId) ? q.customerId : null,
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
  excelCustomer(id: string, mode = "전체 상세") {
    const publicQuote = this.customer(id, mode);
    const record = this.record(id);
    const client = this.customers.find(record.customerId);
    return {
      ...publicQuote,
      contactName:
        publicQuote.customerSnapshot?.contactName ?? client?.contactName ?? "",
      phone: publicQuote.customerSnapshot?.phone ?? client?.phone ?? "",
      groups: publicQuote.sections.map((section) =>
        this.customerItems(
          this.view(record),
          record.sections.find((s) => s.kind === section.kind)?.items ?? [],
        ).map((item) => {
          if (item.priceCategory === "노무비") return 3;
          if (item.priceCategory === "경비") return 4;
          if (/전선|케이블|전기배관|전선관|박스|단자|차단기/.test(item.name))
            return 2;
          if (
            /배관|강관|백관|흑관|엘보|^티$|소켓|레듀샤|플랜지|행거|밸브|니플|유니온/.test(
              item.name,
            )
          )
            return 1;
          return 0;
        }),
      ),
    };
  }
  customer(id: string, mode: string = "전체 상세"): CustomerQuote {
    if (!QUOTE_PRINT_MODES.includes(mode as CustomerQuote["printMode"]))
      throw new BadRequestException("출력모드를 확인해 주세요.");
    const q = this.view(this.record(id));
    return {
      companySnapshot: q.companySnapshot
        ? {
            ...q.companySnapshot,
            logo: q.companySnapshot.logo
              ? {
                  ...q.companySnapshot.logo,
                  originalDataUrl: q.companySnapshot.logo.dataUrl,
                  filename: "company-logo",
                }
              : null,
            seal: q.companySnapshot.seal
              ? {
                  ...q.companySnapshot.seal,
                  originalDataUrl: q.companySnapshot.seal.dataUrl,
                  filename: "company-seal",
                }
              : null,
          }
        : undefined,
      customerSnapshot: q.customerSnapshot,
      workPeriod: q.workPeriod,
      id: q.id,
      quoteNumber: q.quoteNumber ?? q.id,
      customerName: q.customerName,
      siteName: q.siteName,
      address: q.address,
      workContent: q.workContent,
      quoteDate: q.quoteDate,
      validUntil: q.validUntil,
      notes: quotePublicNotes(q),
      displayUnit: q.displayUnit,
      printMode: mode as CustomerQuote["printMode"],
      totals: { ...q.totals },
      sections: [...q.sections]
        .sort(
          (a, b) =>
            ["기계", "전기"].indexOf(a.kind) - ["기계", "전기"].indexOf(b.kind),
        )
        .filter((s) => s.items.length)
        .map((s) => ({
          kind: s.kind,
          items: this.customerItems(q, s.items).map((i) => ({
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
import { quoteLineAmount as importAmount } from "@jongro/shared";
