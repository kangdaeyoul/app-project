import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { CompletionReportService } from "./completion-report.service";
@Controller("sites/:siteId/completion-reports")
export class CompletionReportController {
  constructor(
    @Inject(CompletionReportService)
    private readonly reports: CompletionReportService,
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
      `${save ? "attachment" : "inline"}; filename="completion-report.pdf"; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    );
    if (save)
      response.setHeader(
        "X-Report-Storage-Key",
        encodeURIComponent(report.storageKey),
      );
    response.send(report.buffer);
  }
  @Post("preview") preview(
    @Param("siteId") id: string,
    @Body() body: unknown,
    @Res() response: Parameters<CompletionReportController["send"]>[3],
  ) {
    return this.send(id, body, false, response);
  }
  @Post("generate") generate(
    @Param("siteId") id: string,
    @Body() body: unknown,
    @Res() response: Parameters<CompletionReportController["send"]>[3],
  ) {
    return this.send(id, body, true, response);
  }
}
