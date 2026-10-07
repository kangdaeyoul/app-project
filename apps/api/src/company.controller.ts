import {
  Controller,
  Get,
  Inject,
  Put,
  Body,
  BadRequestException,
} from "@nestjs/common";
import { APP_BRAND } from "@jongno/shared";
import { CompanyContext } from "./company-context";
@Controller("company")
export class CompanyController {
  constructor(
    @Inject(CompanyContext) private readonly context: CompanyContext,
  ) {}
  @Put("quote-preferences") preferences(@Body() body: { autoPrice: unknown }) {
    this.context.assertMember(true);
    if (typeof body?.autoPrice !== "boolean")
      throw new BadRequestException("단가 자동입력 설정을 확인해 주세요.");
    const company = this.context.settings();
    company.quotePreferences = { autoPrice: body.autoPrice };
    this.context.configure(company);
    return company.quotePreferences;
  }
  @Get("current") current() {
    return {
      company: this.context.settings(),
      appBrand: APP_BRAND,
      user: {
        id: this.context.identity.userId,
        membership: this.context.identity.memberships.find(
          (m) =>
            m.companyId === this.context.companyId &&
            m.userId === this.context.identity.userId,
        ),
      },
      sampleMode: true,
    };
  }
}
