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
  @Put("settings") settings(@Body() body:Record<string,unknown>){
    this.context.assertMember(true);const company=this.context.settings();
    for(const key of ["name","displayName","phone","email","address"] as const){const v=body?.[key];if(typeof v!=="string"||v.length>300||(["name","displayName"].includes(key)&&!v.trim()))throw new BadRequestException("회사정보를 확인해 주세요.");company[key]=v.trim();}
    const logo=body.logoUrl;if(logo!==null&&(typeof logo!=="string"||logo.length>1000||!/^https:\/\//.test(logo)))throw new BadRequestException("로고는 HTTPS URL을 입력해 주세요.");company.logoUrl=logo as string|null;company.business={...company.business,name:company.name,address:company.address,email:company.email};this.context.configure(company);return company;
  }
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
