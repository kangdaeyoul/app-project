import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MaterialExcelService } from "./material-excel.service";
@Controller("material-prices")
export class MaterialExcelController {
  constructor(
    @Inject(MaterialExcelService)
    private readonly service: MaterialExcelService,
  ) {}
  private async download(
    template: boolean,
    response: {
      setHeader: (k: string, v: string) => void;
      send: (v: Buffer) => void;
    },
  ) {
    const buffer = await this.service.download(template);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="materials.xlsx"; filename*=UTF-8''${encodeURIComponent(template ? "자재단가_표준양식.xlsx" : "현재_자재목록.xlsx")}`,
    );
    response.setHeader("Cache-Control", "no-store");
    response.send(buffer);
  }
  @Get("template") template(
    @Res() res: Parameters<MaterialExcelController["download"]>[1],
  ) {
    return this.download(true, res);
  }
  @Get("export") export(
    @Res() res: Parameters<MaterialExcelController["download"]>[1],
  ) {
    return this.download(false, res);
  }
  @Post("imports/preview")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  preview(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException("XLSX 파일을 선택하세요.");
    return this.service.preview(file.buffer, file.originalname);
  }
  @Get("imports") jobs() {
    return this.service.jobs();
  }
  @Get("history") histories() {
    return this.service.histories();
  }
  @Put("imports/:id/review") review(
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.review(id, body);
  }
  @Post("imports/:id/submit") submit(
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.submit(id, body?.revision);
  }
  @Post("imports/:id/cancel") cancel(@Param("id") id: string) {
    return this.service.cancel(id);
  }
  @Get("imports/:id") job(@Param("id") id: string) {
    return this.service.job(id);
  }
  @Post("imports/:id/apply") apply(
    @Param("id") id: string,
    @Body() body: { mode: unknown },
  ) {
    return this.service.apply(id, body);
  }
  @Get(":id/history") history(@Param("id") id: string) {
    return this.service.history(id);
  }
}
