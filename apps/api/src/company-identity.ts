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
  ) {}
  intercept(execution: ExecutionContext, next: CallHandler) {
    const request = execution.switchToHttp().getRequest();
    const identity = this.identities.resolve(request);
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
    return new Observable((subscriber) =>
      this.context.run(identity, () => next.handle().subscribe(subscriber)),
    );
  }
}
