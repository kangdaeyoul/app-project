import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Req,
  Res,
  Inject,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { TenantOnboardingService } from "./tenant-onboarding";
import { SupabaseAuthService } from "./supabase-auth";
@Controller("tenant")
export class TenantController {
  constructor(
    @Inject(TenantOnboardingService) private tenants: TenantOnboardingService,
    @Inject(SupabaseAuthService) private auth: SupabaseAuthService,
  ) {}
  @Get("companies/:slug") company(@Param("slug") slug: string) {
    return this.tenants.company(slug);
  }
  @Get("invites/:token") async invite(@Param("token") token: string) {
    return (await this.tenants.invite(token)).view;
  }
  @Post("register") register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.registerTenant(req, res, body);
  }
  @Post("invites/:token/apply") async apply(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("token") token: string,
  ) {
    return this.tenants.applyInvite(
      token,
      await this.auth.verifiedUser(req, res),
    );
  }
  @Post("company-selection") choose(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.auth.selectCompany(req, res, body);
  }
  @Get("invitations") list() {
    return this.tenants.listInvites();
  }
  @Post("invitations") create(@Body() body: unknown) {
    return this.tenants.createInvite(body);
  }
  @Put("invitations/:id/revoke") revoke(@Param("id") id: string) {
    return this.tenants.revokeInvite(id);
  }
  @Get("branding") branding() {
    return this.tenants.branding();
  }
  @Put("branding") update(@Body() body: unknown) {
    return this.tenants.updateBranding(body);
  }
}
