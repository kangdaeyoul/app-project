import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  WorkPrice,
  StandardWork,
  StandardWorkRequest,
  QuoteItemInput,
  WORK_COMPONENT_ROLES,
  WORK_QUANTITY_MODES,
  WORK_REUSE_FLAGS,
} from "@jongno/shared";
import { CompanyContext } from "./company-context";
import {
  STANDARD_WORK_REPOSITORY,
  StandardWorkRepository,
} from "./standard-work.repository";
function bad(): never {
  throw new BadRequestException("표준작업 입력값을 확인해 주세요.");
}
function number(v: unknown, max = 1000000) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > max ||
    Math.abs(v * 1000 - Math.round(v * 1000)) > 0.000001
  )
    bad();
  return v as number;
}
function text(v: unknown, required = false) {
  if (
    typeof v !== "string" ||
    v.length > 300 ||
    (required && !v.trim()) ||
    /[\u0000-\u001f]/.test(v)
  )
    bad();
  return (v as string).trim();
}
@Injectable()
export class StandardWorkService {
  constructor(
    @Inject(STANDARD_WORK_REPOSITORY)
    private readonly repository: StandardWorkRepository,
    @Inject(CompanyContext) private readonly context: CompanyContext,
  ) {}
  list() {
    this.context.assertMember(true);
    return this.repository.list();
  }
  history(id: string) {
    this.context.assertMember(true);
    this.find(id);
    return this.repository.get(id);
  }
  private find(id: string) {
    const t = this.repository.find(id);
    if (!t) throw new NotFoundException("표준작업을 찾을 수 없습니다.");
    return t;
  }
  savePrice(raw: WorkPrice, id?: string) {
    this.context.assertMember(true);
    if (!raw || typeof raw !== "object") bad();
    const current = this.repository.list().prices;
    if (id && !current.some((p) => p.id === id)) throw new NotFoundException();
    if (!["재료비", "노무비", "경비"].includes(raw.category)) bad();
    const p: WorkPrice = {
      id: id ?? randomUUID(),
      companyId: this.context.companyId,
      name: text(raw.name, true),
      specification: text(raw.specification),
      unit: text(raw.unit, true),
      category: raw.category,
      cost: number(raw.cost, 1000000000),
      salePrice: number(raw.salePrice, 1000000000),
    };
    if (!Number.isSafeInteger(p.cost) || !Number.isSafeInteger(p.salePrice))
      bad();
    this.repository.savePrice(p);
    return p;
  }
  save(id: string, raw: StandardWork) {
    this.context.assertMember(true);
    const old = this.find(id);
    if (!raw || typeof raw !== "object") bad();
    if (raw.version !== old.version)
      throw new ConflictException(
        "다른 변경이 있습니다. 최신 템플릿을 다시 불러오세요.",
      );
    if (
      !["기계", "전기"].includes(raw.section) ||
      !Array.isArray(raw.components) ||
      !raw.components.length ||
      raw.components.length > 100
    )
      bad();
    const prices = this.repository.list().prices;
    const ids = new Set<string>();
    const components = raw.components.map((c) => {
      if (!c || typeof c !== "object") bad();
      const cid = text(c.id, true);
      if (ids.has(cid)) bad();
      ids.add(cid);
      if (
        !prices.some((p) => p.id === c.priceId) ||
        !WORK_COMPONENT_ROLES.includes(c.role) ||
        !WORK_QUANTITY_MODES.includes(c.mode) ||
        !["배선", "배관"].includes(c.lengthKey) ||
        !Array.isArray(c.omitWhen) ||
        c.omitWhen.some((f) => !WORK_REUSE_FLAGS.includes(f))
      )
        bad();
      return {
        id: cid,
        priceId: c.priceId,
        role: c.role,
        mode: c.mode,
        factor: number(c.factor),
        lengthKey: c.lengthKey,
        omitWhen: [...new Set(c.omitWhen)],
        customerGroup: text(c.customerGroup),
      };
    });
    const t: StandardWork = {
      id,
      companyId: this.context.companyId,
      name: text(raw.name, true),
      section: raw.section,
      version: old.version + 1,
      components,
      updatedAt: new Date().toISOString(),
      updatedBy:
        this.context.identity.userDisplayName ?? this.context.identity.userId,
      reason: text(raw.reason, true),
    };
    this.repository.save(t);
    return t;
  }
  calculate(id: string, r: StandardWorkRequest) {
    this.context.assertMember(true);
    const t = this.find(id);
    if (!r || typeof r !== "object") bad();
    const qty = number(r.quantity);
    if (qty <= 0) bad();
    if (
      !r.lengths ||
      typeof r.lengths !== "object" ||
      !Array.isArray(r.reuse) ||
      r.reuse.some((f) => !WORK_REUSE_FLAGS.includes(f)) ||
      !r.overrides ||
      typeof r.overrides !== "object" ||
      Array.isArray(r.overrides)
    )
      bad();
    number(r.lengths.배선);
    number(r.lengths.배관);
    for (const [key, v] of Object.entries(r.overrides)) {
      if (!t.components.some((c) => c.id === key)) bad();
      number(v);
    }
    const prices = this.repository.list().prices;
    const items: QuoteItemInput[] = [];
    for (const c of t.components) {
      if (c.omitWhen.some((f) => r.reuse.includes(f))) continue;
      const p = prices.find((p) => p.id === c.priceId)!;
      let quantity = r.overrides[c.id];
      if (quantity === undefined) {
        if (c.mode === "관리자 직접입력")
          throw new BadRequestException(
            `${p.name}: 수량을 직접 입력해 주세요.`,
          );
        quantity =
          c.mode === "1식"
            ? 1
            : c.mode === "고정수량"
              ? c.factor
              : c.mode === "길이기준"
                ? r.lengths[c.lengthKey] || qty * c.factor
                : qty * c.factor;
      }
      quantity = number(Math.round(quantity * 1000) / 1000);
      if (!quantity) continue;
      items.push({
        trade: t.name,
        name: p.name,
        specification: p.specification,
        quantity,
        unit: p.unit,
        materialUnitCost: p.category === "재료비" ? p.cost : 0,
        laborUnitCost: p.category === "노무비" ? p.cost : 0,
        expenseUnitCost: p.category === "경비" ? p.cost : 0,
        saleUnitPrice: p.salePrice,
        priceCategory: p.category,
        notes: "",
        customerGroup: c.customerGroup,
        standardSource: {
          templateId: t.id,
          version: t.version,
          componentId: c.id,
        },
      });
    }
    return { templateId: t.id, version: t.version, section: t.section, items };
  }
}
