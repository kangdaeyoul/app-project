import { PermissionService } from "./permission.service";
import { map } from "rxjs/operators";
import { AuditRecorder } from "./audit-recorder";
import { BadRequestException } from "@nestjs/common";
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import {
  CompanyContext,
  CompanyIdentity,
  SAMPLE_IDENTITY,
} from "./company-context";
export const COMPANY_IDENTITY = Symbol("COMPANY_IDENTITY");
export interface CompanyIdentityProvider {
  resolve(request: unknown): CompanyIdentity;
}
// Development-only adapter. Never trusts companyId/userId submitted by a browser.
export class SampleCompanyIdentityProvider implements CompanyIdentityProvider {
  resolve(_request: unknown) {
    return structuredClone(SAMPLE_IDENTITY);
  }
}
@Injectable()
export class CompanyIdentityInterceptor implements NestInterceptor {
  constructor(
    @Inject(CompanyContext) private readonly context: CompanyContext,
    @Inject(COMPANY_IDENTITY)
    private readonly identities: CompanyIdentityProvider,
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution.switchToHttp().getRequest();
    const controller = execution.getClass().name,
      handler = execution.getHandler().name;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin) {
        let host: string;
        try {
          host = new URL(origin).host;
        } catch {
          throw new ForbiddenException("잘못된 요청 출처입니다.");
        }
        const expected =
          request.headers["x-forwarded-host"] ?? request.headers.host;
        if (host !== expected)
          throw new ForbiddenException(
            "외부 사이트의 변경 요청은 허용하지 않습니다.",
          );
      }
    }
    if (
      (controller === "AuthController" &&
        ["config", "login"].includes(handler)) ||
      (controller === "AppController" && handler === "health")
    )
      return next.handle();
    const identity = this.identities.resolve(request);
    request.res?.setHeader("Cache-Control", "no-store");

    if (identity.workerId && !identity.authenticated) {
      const controller = execution.getClass().name;
      if (
        ![
          "WorkInstructionController",
          "AfterServiceController",
          "WorkerScheduleController",
          "PhotoController",
          "CompanyController",
        ].includes(controller) ||
        (controller === "CompanyController" && request.method !== "GET")
      )
        throw new ForbiddenException(
          "작업진행자는 본인 배정 업무만 이용할 수 있습니다.",
        );
    }
    const claim = request.headers["x-company-id"];
    if (claim && claim !== identity.companyId)
      throw new ForbiddenException("회사는 서버의 사용자 소속으로 결정됩니다.");
    const check = (value: unknown): void => {
      if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return;
      for (const [key, v] of Object.entries(value)) {
        if (
          ["companyId", "company_id", "tenantId", "tenant_id"].includes(key) &&
          v !== identity.companyId
        )
          throw new ForbiddenException(
            "다른 회사의 소유권을 지정할 수 없습니다.",
          );
        check(v);
      }
    };
    check(request.body);
    const reason = request.body?.auditReason ?? "";
    if (
      typeof reason !== "string" ||
      reason.length > 500 ||
      /[\u0000-\u0008\u000b-\u001f]/.test(reason)
    )
      throw new BadRequestException("변경 사유를 확인해 주세요.");
    return new Observable((subscriber) =>
      this.context.run(identity, () =>
        this.audit.withOperation({ reason: reason.trim() }, () =>
          (() => {
            this.permissions.authorize(controller, handler, request);
            return next
              .handle()
              .pipe(map((data) => this.permissions.project(controller, data)))
              .subscribe(subscriber);
          })(),
        ),
      ),
    );
  }
}
