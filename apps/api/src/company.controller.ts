import {
  Controller,
  Get,
  Inject,
  Put,
  Body,
  BadRequestException,
  Query,
  Res,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  cleanCompanyProfile,
  companyPresentation,
  companyBranding,
} from "./quote-presentation";
import { QuotesService } from "./quotes.service";
import { APP_BRAND } from "@jongro/shared";
import { CompanyContext } from "./company-context";
@Controller("company")
export class CompanyController {
  constructor(
    @Inject(CompanyContext) private readonly context: CompanyContext,
    @Inject(QuotesService) private quotes: QuotesService,
  ) {}
  @Put("settings") settings(@Body() body: Record<string, unknown>) {
    this.context.assertMember(true);
    const company = this.context.settings();
    const before = structuredClone(company);
    for (const key of [
      "name",
      "displayName",
      "phone",
      "email",
      "address",
    ] as const) {
      const v = body?.[key];
      if (
        typeof v !== "string" ||
        v.length > 300 ||
        (["name", "displayName"].includes(key) && !v.trim())
      )
        throw new BadRequestException("회사정보를 확인해 주세요.");
      company[key] = v.trim();
    }
    const logo = body.logoUrl;
    if (
      body.quoteProfile === undefined &&
      logo !== null &&
      (typeof logo !== "string" ||
        logo.length > 1000 ||
        !/^https:\/\//.test(logo))
    )
      throw new BadRequestException("로고는 HTTPS URL을 입력해 주세요.");
    company.logoUrl = logo as string | null;
    if (body.quoteProfile !== undefined) {
      company.quoteProfile = cleanCompanyProfile(body.quoteProfile, company);
      const p = company.quoteProfile;
      const old = companyPresentation(before);
      for (const k of ["name", "address", "phone", "email"] as const)
        if (body[k] !== before[k] && p[k] === old[k]) p[k] = body[k] as string;
      company.name = p.name;
      company.address = p.address;
      company.phone = p.phone;
      company.fax = p.fax;
      company.email = p.email;
      company.website = p.website;
      company.logoUrl = p.logo?.dataUrl ?? null;
      company.business = {
        ...company.business,
        representative: p.representative,
        registrationNumber: p.registrationNumber,
        businessType: p.businessType,
        businessItem: p.businessItem,
      };
      company.output = { ...company.output, quoteNotes: p.footer };
    }
    company.business = {
      ...company.business,
      name: company.name,
      address: company.address,
      email: company.email,
    };
    this.quotes.freezeCompanySnapshots();
    this.context.configure(company);
    return company;
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
  @Get("branding/logo") branding(
    @Query("company") id: string,
    @Query("version") version: string,
    @Res() res: any,
  ) {
    this.context.assertMember();
    const c = this.context.settings(),
      logo = c.quoteProfile?.logo;
    if (
      id !== c.id ||
      !logo ||
      version !== createHash("sha256").update(logo.dataUrl).digest("hex")
    )
      throw new NotFoundException("로고를 찾을 수 없습니다.");
    res.setHeader(
      "Content-Type",
      logo.dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg",
    );
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Vary", "Cookie");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(logo.dataUrl.split(",")[1], "base64"));
  }
  @Get("current") current() {
    return {
      company: {
        ...companyBranding(this.context.settings()),
        quoteProfile: companyPresentation(this.context.settings()),
      },
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
