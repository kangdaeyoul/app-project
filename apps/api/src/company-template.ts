import { Inject, Injectable, ConflictException } from "@nestjs/common";
import { join } from "node:path";
import { CompanyContext } from "./company-context";
@Injectable()
export class CompanyTemplateResolver {
  constructor(
    @Inject(CompanyContext) private readonly context: CompanyContext,
  ) {}
  settings() {
    return this.context.settings();
  }
  quotePath() {
    const company = this.context.settings();
    if (
      company.id !== "jongro" ||
      company.quoteTemplate?.kind !== "jongro-2026" ||
      company.quoteTemplate.storageKey !==
        "companies/jongro/templates/jongro-2026.xlsx"
    )
      throw new ConflictException("회사 전용 견적서 템플릿 등록이 필요합니다.");
    return join(__dirname, "../fixtures/quotes/jongro-2026.xlsx");
  }
}
