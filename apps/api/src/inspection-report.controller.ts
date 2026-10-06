import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import { InspectionReportService } from "./inspection-report.service";
@Controller("sites/:siteId/inspection-reports")
export class InspectionReportController {
  constructor(
    @Inject(InspectionReportService)
    private readonly reports: InspectionReportService,
  ) {}
  @Get("source") source(@Param("siteId") id: string) {
    return this.reports.source(id);
  }
  private async send(
    id: string,
    body: unknown,
    save: boolean,
    response: {
      setHeader: (key: string, value: string) => void;
      send: (buffer: Buffer) => void;
    },
  ) {
    const report = await this.reports.render(id, body, save);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Disposition",
      `${save ? "attachment" : "inline"}; filename="inspection-report.pdf"; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    );
    if (save)
      response.setHeader(
        "X-Report-Storage-Key",
        encodeURIComponent(report.storageKey),
      );
    response.send(report.buffer);
  }
  @Post() save(@Param("siteId") siteId: string, @Body() body: unknown) {
    return this.reports.save(siteId, body);
  }
  @Put(":id") update(
    @Param("siteId") siteId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.reports.save(siteId, body, id);
  }
  @Post("preview") preview(
    @Param("siteId") id: string,
    @Body() body: unknown,
    @Res() response: Parameters<InspectionReportController["send"]>[3],
  ) {
    return this.send(id, body, false, response);
  }
  @Post("generate") generate(
    @Param("siteId") id: string,
    @Body() body: unknown,
    @Res() response: Parameters<InspectionReportController["send"]>[3],
  ) {
    return this.send(id, body, true, response);
  }
}
