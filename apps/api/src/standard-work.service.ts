import { priceChange } from "./material-price";
import { validDate } from "./date";
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
  WorkCondition,
  WorkSiteConditions,
  WORK_CONDITION_KEYS,
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
function text(v: unknown, required = false, max = 300) {
  if (
    typeof v !== "string" ||
    v.length > max ||
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
    const data = this.repository.list();
    return { ...data, templates: data.templates.filter((t) => !t.deletedAt) };
  }
  favorites() {
    this.context.assertMember(true);
    return {
      companyId: this.context.companyId,
      userId: null,
      priceIds: this.repository.favorites(),
    };
  }
  saveFavorites(raw: { priceIds: unknown }) {
    this.context.assertMember(true);
    const ids = raw?.priceIds;
    const prices = this.repository.list().prices;
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) => typeof id !== "string" || !prices.some((p) => p.id === id),
      )
    )
      bad();
    this.repository.saveFavorites(ids);
    return this.favorites();
  }
  history(id: string) {
    this.context.assertMember(true);
    if (!this.repository.find(id)) throw new NotFoundException();
    return this.repository.get(id);
  }
  private find(id: string) {
    const t = this.repository.find(id);
    if (!t || t.deletedAt)
      throw new NotFoundException("표준작업을 찾을 수 없습니다.");
    return t;
  }
  savePrice(raw: WorkPrice, id?: string) {
    this.context.assertMember(true);
    if (!raw || typeof raw !== "object") bad();
    const current = this.repository.list().prices;
    if (id && !current.some((p) => p.id === id)) throw new NotFoundException();
    if (!["재료비", "노무비", "경비"].includes(raw.category)) bad();
    const old = current.find((p) => p.id === id);
    const p: WorkPrice = {
      id: id ?? randomUUID(),
      companyId: this.context.companyId,
      trade: text(raw.trade ?? old?.trade ?? ""),
      manufacturer: text(raw.manufacturer ?? old?.manufacturer ?? ""),
      supplier: text(raw.supplier ?? old?.supplier ?? ""),
      purchasePrice: number(
        raw.purchasePrice ?? old?.purchasePrice ?? 0,
        1000000000,
      ),
      vatIncluded: raw.vatIncluded ?? old?.vatIncluded ?? false,
      effectiveDate: text(raw.effectiveDate ?? old?.effectiveDate ?? ""),
      notes: text(raw.notes ?? old?.notes ?? "", false, 1000),
      name: text(raw.name, true),
      specification: text(raw.specification),
      unit: text(raw.unit, true),
      category: raw.category,
      cost: number(raw.cost, 1000000000),
      salePrice: number(raw.salePrice, 1000000000),
    };
    if (!Number.isSafeInteger(p.cost) || !Number.isSafeInteger(p.salePrice))
      bad();
    if (
      !Number.isSafeInteger(p.purchasePrice) ||
      typeof p.vatIncluded !== "boolean" ||
      (p.effectiveDate && !validDate(p.effectiveDate))
    )
      bad();
    const history = priceChange(p, old, "수동", this.context.identity.userId);
    this.repository.commitPrices([p], history ? [history] : []);
    return p;
  }
  private rules(value: unknown): WorkCondition[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 30) bad();
    return value.map((r) => {
      if (
        !r ||
        typeof r !== "object" ||
        !WORK_CONDITION_KEYS.includes(r.key) ||
        !["같음", "다름", "이상", "이하"].includes(r.operator)
      )
        bad();
      if (["이상", "이하"].includes(r.operator) && r.key !== "height") bad();
      if (r.key === "height") {
        number(r.value, 100);
      } else if (
        [
          "reuseWiring",
          "reusePiping",
          "reuseEquipment",
          "night",
          "demolition",
        ].includes(r.key)
      ) {
        if (typeof r.value !== "boolean") bad();
      } else {
        text(r.value, true);
        if (
          r.key === "workType" &&
          !["증설", "이설", "신설", "교체"].includes(r.value)
        )
          bad();
        if (r.key === "installation" && !["노출", "매립"].includes(r.value))
          bad();
      }
      return { key: r.key, operator: r.operator, value: r.value };
    });
  }
  private matches(rule: WorkCondition, c: WorkSiteConditions) {
    const v = c[rule.key];
    return rule.operator === "같음"
      ? v === rule.value
      : rule.operator === "다름"
        ? v !== rule.value
        : rule.operator === "이상"
          ? (v as number) >= (rule.value as number)
          : (v as number) <= (rule.value as number);
  }
  create(raw: StandardWork) {
    this.context.assertMember(true);
    return this.save(randomUUID(), raw, true);
  }
  copy(id: string) {
    this.context.assertMember(true);
    const old = this.find(id);
    return this.create({
      ...old,
      name: old.name.slice(0, 290) + " (복사)",
      workType:
        old.workType ??
        ["증설", "이설", "신설", "교체"].find((v) => old.name.endsWith(v)) ??
        "신설",
      reason: `원본 ${old.id} 복사`,
      active: true,
    });
  }
  archive(id: string) {
    this.context.assertMember(true);
    const old = this.find(id);
    const t = {
      ...old,
      version: old.version + 1,
      active: false,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy:
        this.context.identity.userDisplayName ?? this.context.identity.userId,
      reason: "표준작업 삭제 (기존 견적 및 버전 이력 보존)",
    };
    this.repository.save(t);
    return { deleted: true };
  }
  save(id: string, raw: StandardWork, creating = false) {
    this.context.assertMember(true);
    const old = creating ? undefined : this.find(id);
    if (!raw || typeof raw !== "object") bad();
    if (!creating && raw.version !== old!.version)
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
        includeWhen: this.rules(c.includeWhen),
        excludeWhen: this.rules(c.excludeWhen),
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
      workType: text(
        raw.workType ?? old?.workType ?? raw.name.split(" ").at(-1),
        true,
      ),
      description: text(raw.description ?? old?.description ?? "", false, 1000),
      baseQuantity: number(raw.baseQuantity ?? old?.baseQuantity ?? 1),
      unit: text(raw.unit ?? old?.unit ?? "개", true),
      calculation: text(
        raw.calculation ?? old?.calculation ?? "구성품별 계산",
        true,
      ),
      conditions: this.rules(raw.conditions),
      active: raw.active ?? old?.active ?? true,
      deletedAt: null,
      version: creating ? 1 : old!.version + 1,
      components,
      updatedAt: new Date().toISOString(),
      updatedBy:
        this.context.identity.userDisplayName ?? this.context.identity.userId,
      reason: text(raw.reason, true),
    };
    if (
      !["증설", "이설", "신설", "교체"].includes(t.workType!) ||
      typeof t.active !== "boolean" ||
      !t.baseQuantity
    )
      bad();
    this.repository.save(t);
    return t;
  }
  calculate(id: string, r: StandardWorkRequest) {
    this.context.assertMember(true);
    const t = this.find(id);
    if (!r || typeof r !== "object") bad();
    if (t.active === false)
      throw new ConflictException(
        "비활성 작업세트는 견적에 추가할 수 없습니다.",
      );
    const conditions: WorkSiteConditions = {
      workType:
        t.workType ??
        ["증설", "이설", "신설", "교체"].find((v) => t.name.endsWith(v)) ??
        "신설",
      installation: "노출",
      reuseWiring: false,
      reusePiping: false,
      reuseEquipment: false,
      ceiling: "일반",
      height: 3,
      night: false,
      demolition: true,
      ...r.conditions,
    };
    if (
      r.conditions &&
      (typeof r.conditions !== "object" ||
        Array.isArray(r.conditions) ||
        Object.keys(r.conditions).some(
          (k) =>
            !WORK_CONDITION_KEYS.includes(
              k as (typeof WORK_CONDITION_KEYS)[number],
            ),
        ))
    )
      bad();
    if (
      !["증설", "이설", "신설", "교체"].includes(conditions.workType) ||
      !["노출", "매립"].includes(conditions.installation) ||
      typeof conditions.ceiling !== "string" ||
      conditions.ceiling.length > 300 ||
      [
        "reuseWiring",
        "reusePiping",
        "reuseEquipment",
        "night",
        "demolition",
      ].some(
        (k) => typeof conditions[k as keyof WorkSiteConditions] !== "boolean",
      )
    )
      bad();
    number(conditions.height, 100);
    if (r.autoPrice !== undefined && typeof r.autoPrice !== "boolean") bad();
    if ((t.conditions ?? []).some((rule) => !this.matches(rule, conditions)))
      throw new BadRequestException(
        "작업세트 적용조건과 현장조건이 맞지 않습니다.",
      );
    const autoPrice =
      r.autoPrice ??
      this.context.settings().quotePreferences?.autoPrice ??
      true;
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
      if (
        (c.includeWhen ?? []).some((rule) => !this.matches(rule, conditions)) ||
        (c.excludeWhen ?? []).some((rule) => this.matches(rule, conditions))
      )
        continue;
      if (
        (conditions.reuseEquipment && c.role === "주자재") ||
        (conditions.reuseWiring && ["배선", "전선"].includes(c.role)) ||
        (conditions.reusePiping && ["전선관", "배관"].includes(c.role)) ||
        (!conditions.demolition && c.role === "철거노무")
      )
        continue;
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
        materialCode: p.id,
        entrySources: ["standard"],
        trade: t.name,
        name: p.name,
        specification: p.specification,
        quantity,
        unit: p.unit,
        materialUnitCost: autoPrice && p.category === "재료비" ? p.cost : 0,
        laborUnitCost: autoPrice && p.category === "노무비" ? p.cost : 0,
        expenseUnitCost: autoPrice && p.category === "경비" ? p.cost : 0,
        saleUnitPrice: autoPrice ? p.salePrice : 0,
        pricePending:!autoPrice,
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
