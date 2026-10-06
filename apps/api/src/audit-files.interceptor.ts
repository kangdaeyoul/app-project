import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AuditRecorder } from "./audit-recorder";
import { CompanyContext } from "./company-context";
import { PHOTO_REPOSITORY, PhotoRepository } from "./photo.repository";
import { QUOTES_REPOSITORY, QuotesRepository } from "./quotes.repository";
@Injectable()
export class AuditFilesInterceptor implements NestInterceptor {
  constructor(
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(ModuleRef) private readonly modules: ModuleRef,
  ) {}
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution.switchToHttp().getRequest(),
      response = execution.switchToHttp().getResponse();
    const route = (request.originalUrl ?? request.url).split("?")[0];
    const photo =
      request.method === "GET" ? route.match(/\/photos\/([^/]+)\/file$/) : null;
    const quote =
      request.method === "GET"
        ? route.match(/\/quotes\/([^/]+)\/(pdf|excel)$/)
        : null;
    const report =
      request.method === "POST"
        ? route.match(
            /\/sites\/([^/]+)\/(?:photo-reports|completion-reports)\/(preview|generate)$/,
          )
        : null;
    if (!photo && !quote && !report) return next.handle();
    const identity = structuredClone(this.company.identity),
      reason = this.audit.reason;
    const photoRecord = photo
      ? this.modules
          .get<PhotoRepository>(PHOTO_REPOSITORY, { strict: false })
          .find(decodeURIComponent(photo[1]))
      : null;
    const quoteRecord = quote
      ? this.modules
          .get<QuotesRepository>(QUOTES_REPOSITORY, { strict: false })
          .find(decodeURIComponent(quote[1]))
      : null;
    const siteIds = report
      ? [decodeURIComponent(report[1])]
      : this.audit.sitesFor(
          photo ? "사진" : "견적",
          photoRecord ?? quoteRecord,
        );
    const temporaryId = randomUUID();
    const finish = () => {
      if (response.statusCode < 200 || response.statusCode >= 300) return;
      const mime = String(response.getHeader("Content-Type") ?? "");
      if (
        !/^(image\/|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)/.test(
          mime,
        )
      )
        return;
      this.company.run(identity, () =>
        this.audit.withOperation({ reason }, () => {
          const encoded = String(
            response.getHeader("X-Report-Storage-Key") ?? "",
          );
          const storageKey =
            photoRecord?.storageKey ??
            (encoded
              ? decodeURIComponent(encoded)
              : `temporary/${temporaryId}`);
          const disposition = String(
            response.getHeader("Content-Disposition") ?? "",
          );
          const encodedFilename = disposition.match(
            /filename\*=UTF-8''(.+)$/,
          )?.[1];
          const originalFilename =
            photoRecord?.originalFilename ??
            (encodedFilename ? decodeURIComponent(encodedFilename) : null);
          const metadata = {
            originalFilename,
            storageKey,
            mimeType: mime,
            size: Number(response.getHeader("Content-Length") ?? 0),
            photoId: photoRecord?.id ?? null,
            quoteId: quoteRecord?.id ?? null,
          };
          // Stored photo reports are already logged by their storage adapter. Other exports are generated transiently.
          if (quote || (report && report[2] === "preview"))
            this.audit.record({
              targetType: "파일",
              targetId: storageKey,
              action: "생성",
              before: null,
              after: metadata,
              siteIds,
              reason: quote
                ? "견적서 임시 출력 파일 생성"
                : route.includes("/completion-reports/")
                  ? "완료보고서 임시 미리보기 생성"
                  : "사진대지 임시 미리보기 생성",
            });
          this.audit.record({
            targetType: "파일",
            targetId: storageKey,
            action: "다운로드",
            before: metadata,
            after: metadata,
            siteIds,
            reason: "파일 응답 전송 완료 (미리보기 포함)",
          });
        }),
      );
    };
    response.once("finish", finish);
    response.once("close", () => response.removeListener("finish", finish));
    return next.handle();
  }
}
