import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { AuditService } from "./audit.service";
@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}
  @Get("audit-logs") list(@Query() query: Record<string, unknown>) {
    return this.audit.list(query);
  }
  @Get("sites/:id/audit-logs") site(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.audit.list(query, id);
  }
}
