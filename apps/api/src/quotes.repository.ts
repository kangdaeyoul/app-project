import { randomUUID } from "node:crypto";
import {
  Quote,
  QuoteInput,
  QuoteItemInput,
  QUOTE_SECTIONS,
} from "@jongno/shared";
import { seoulToday } from "./date";
export const QUOTES_REPOSITORY = Symbol("QUOTES_REPOSITORY");
export interface QuotesRepository {
  list(): Quote[];
  find(id: string): Quote | undefined;
  save(quote: Quote): void;
  remove(id: string): void;
}
type QuoteRecord = Omit<Quote, "sections">;
interface SectionRecord {
  id: string;
  quoteId: string;
  kind: (typeof QUOTE_SECTIONS)[number];
  position: number;
}
interface ItemRecord extends QuoteItemInput {
  id: string;
  sectionId: string;
  position: number;
}
export class SampleQuotesRepository implements QuotesRepository {
  private quotes = new Map<string, QuoteRecord>();
  private sections: SectionRecord[] = [];
  private items: ItemRecord[] = [];
  constructor() {
    const today = seoulToday(),
      validUntil = new Date(Date.parse(today) + 30 * 86400000)
        .toISOString()
        .slice(0, 10);
    const item = (kind: string): QuoteItemInput => ({
      trade: kind === "기계" ? "스프링클러" : "자동화재탐지",
      name: kind === "기계" ? "배관용탄소강관 백관" : "화재감지기 연기식",
      specification: kind === "기계" ? "25A" : "일반형",
      quantity: kind === "기계" ? 18 : 6,
      unit: kind === "기계" ? "m" : "개",
      materialUnitCost: kind === "기계" ? 4123 : 15379,
      laborUnitCost: kind === "기계" ? 2761 : 6247,
      expenseUnitCost: kind === "기계" ? 317 : 811,
      saleUnitPrice: kind === "기계" ? 12500 : 35000,
      priceCategory: "재료비",
      notes: "샘플 견적",
    });
    for (const [i, kinds] of [["기계"], ["전기"], ["기계", "전기"]].entries()) {
      const input: QuoteInput = {
        customerId: `C00${i + 1}`,
        siteId: i === 0 ? "S001" : null,
        siteName: [
          "종로 오피스 기계 견적",
          "혜화 상가 전기 견적",
          "광화문 기계·전기 견적",
        ][i],
        address: ["종로구 종로 33", "종로구 대학로 120", "종로구 세종대로 175"][
          i
        ],
        workContent: kinds.join("·") + " 소방시설 공사",
        quoteDate: today,
        validUntil,
        status: i === 2 ? "승인" : "작성중",
        notes: "실제 계약이 아닌 샘플입니다.",
        generalFee: 50000,
        supportFee: 30000,
        internalGeneralCost: 14239,
        internalSupportCost: 8317,
        rounding: "천원 반올림",
        displayUnit: "만원",
        sections: kinds.map((kind) => ({
          kind: kind as (typeof QUOTE_SECTIONS)[number],
          items: [item(kind)],
        })),
      };
      this.save({
        ...input,
        id: `Q00${i + 1}`,
        customerName: ["종로 오피스", "혜화 상가 관리사무소", "광화문 빌딩"][i],
        convertedSiteId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  list() {
    return [...this.quotes.keys()].map((id) => this.find(id)!);
  }
  find(id: string) {
    const q = this.quotes.get(id);
    if (!q) return undefined;
    return structuredClone({
      ...q,
      sections: this.sections
        .filter((s) => s.quoteId === id)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          kind: s.kind,
          items: this.items
            .filter((i) => i.sectionId === s.id)
            .sort((a, b) => a.position - b.position)
            .map(({ id, sectionId, position, ...item }) => item),
        })),
    });
  }
  save(quote: Quote) {
    const { sections, ...record } = structuredClone(quote);
    this.remove(quote.id);
    this.quotes.set(quote.id, record);
    sections.forEach((s, position) => {
      const sectionId = randomUUID();
      this.sections.push({
        id: sectionId,
        quoteId: quote.id,
        kind: s.kind,
        position,
      });
      s.items.forEach((item, position) =>
        this.items.push({ ...item, id: randomUUID(), sectionId, position }),
      );
    });
  }
  remove(id: string) {
    const ids = new Set(
      this.sections.filter((s) => s.quoteId === id).map((s) => s.id),
    );
    this.items = this.items.filter((i) => !ids.has(i.sectionId));
    this.sections = this.sections.filter((s) => s.quoteId !== id);
    this.quotes.delete(id);
  }
}
