import {
  ConflictException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Post,
  Res,
} from "@nestjs/common";
import { CompanyContext } from "./company-context";
import { MaterialPersistence } from "./material-persistence";
import { materialAccess } from "./material-access";
import { StandardWorkService } from "./standard-work.service";
@Controller("material-prices/catalog")
export class MaterialCatalogController {
  constructor(
    @Inject(CompanyContext) private context: CompanyContext,
    @Inject(MaterialPersistence) private store: MaterialPersistence,
    @Inject(StandardWorkService) private service: StandardWorkService,
  ) {}
  @Get() list() {
    materialAccess(this.context);
    return {
      prices: this.store.repository.list().prices,
      storage: this.store.mode,
      persistent: this.store.mode !== "memory",
    };
  }
  @Post() create(@Body() raw: any) {
    return this.service.savePrice(raw);
  }
  @Put(":id") save(@Param("id") id: string, @Body() raw: any) {
    const old = this.store.repository.list().prices.find((p) => p.id === id);
    if (old && (raw?.revision ?? 0) !== (old.revision ?? 0))
      throw new ConflictException(
        "다른 사용자가 자재를 수정했습니다. 다시 불러오세요.",
      );
    return this.service.savePrice(raw, id);
  }
  @Get("backup") backup(@Res() res: any) {
    this.context.assertMember(true);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="material-catalog-backup.json"',
    );
    res.send(
      JSON.stringify(
        {
          version: 1,
          companyId: this.context.companyId,
          createdAt: new Date().toISOString(),
          state: this.store.repository.snapshot(),
        },
        null,
        2,
      ),
    );
  }
}
