import { Controller, Get, Inject } from "@nestjs/common";
import { APP_BRAND } from "@jongno/shared";
import { CompanyContext } from "./company-context";
@Controller("company")
export class CompanyController {
  constructor(
    @Inject(CompanyContext) private readonly context: CompanyContext,
  ) {}
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
