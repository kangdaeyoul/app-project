import { PermissionService } from "./permission.service";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { APP_BRAND, DEFAULT_COMPANY } from "@jongno/shared";
import { CompanyContext, CompanyIdentity } from "./company-context";
import { CompanyIdentityProvider } from "./company-identity";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import {
  CurrentUser,
  UserRole,
  UserPermission as Permission,
} from "@jongno/shared";
export type { CurrentUser, UserRole } from "@jongno/shared";
import { AuditRecorder } from "./audit-recorder";
interface StoredUser extends CurrentUser {
  passwordHash: string;
}
export interface AuthProvider {
  authenticate(login: string, password: string): CurrentUser;
  resolve(request: unknown): CompanyIdentity;
  session(user: CurrentUser, remember: boolean): { token: string; ttl: number };
  current(): CurrentUser;
  logout(request: unknown): void;
  list(): CurrentUser[];
  save(body: unknown, id?: string): CurrentUser;
  options(): {
    companies: import("@jongno/shared").Company[];
    sites: { id: string; name: string }[];
    workers: { id: string; name: string; displayName: string }[];
  };
}
export const AUTH_PROVIDER = Symbol("AUTH_PROVIDER");
interface Session {
  userId: string;
  expiresAt: number;
}
const roles: UserRole[] = ["admin", "staff", "worker", "customer"];
const permissions: Permission[] = [
  "internalCosts",
  "siteFinance",
  "workerPayments",
  "editSchedule",
  "writeQuotes",
];
function hash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 32).toString("hex");
}
function verify(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 32),
    Buffer.from(digest, "hex"),
  );
}
function publicUser(u: StoredUser): CurrentUser {
  const { passwordHash, ...safe } = u;
  return structuredClone(safe);
}
@Injectable()
export class MemoryAuthProvider
  implements AuthProvider, CompanyIdentityProvider
{
  private users = new Map<string, StoredUser>();
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(PermissionService) private policy: PermissionService,
    @Inject(AuditRecorder) private audit: AuditRecorder,
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
  ) {
    this.company.register({
      ...structuredClone(DEFAULT_COMPANY),
      id: "demo-company",
      name: "테스트 소방회사",
      displayName: "테스트 소방회사",
      logoUrl: null,
      sealKey: null,
      quoteTemplate: null,
      phone: "",
      fax: "",
      email: "",
      address: "",
      branchAddress: "",
      website: "",
      business: {
        registrationNumber: "",
        corporationNumber: "",
        name: "테스트 소방회사",
        representative: "",
        address: "",
        businessType: "",
        businessItem: "",
        email: "",
      },
      output: {
        photoReportTitle: "공사 사진대지",
        footer: "안전한 현장, 체계적인 관리",
        quoteNotes: "",
      },
    });
    const seed = (
      id: string,
      loginId: string,
      role: UserRole,
      workerId: string | null = null,
      active = true,
      companyId = DEFAULT_COMPANY.id,
    ) => {
      const worker = workerId ? this.workers.find(workerId) : undefined;
      this.users.set(id, {
        id,
        companyId,
        loginId,
        email: loginId,
        name: worker?.name ?? (role === "admin" ? "관리자" : "사내직원"),
        displayName:
          worker?.displayName ?? (role === "admin" ? "관리자" : "사내직원"),
        role,
        workerId,
        active,
        siteIds: role === "staff" ? ["S001", "S003"] : [],
        permissions: role === "staff" ? ["writeQuotes"] : [],
        passwordHash: hash("Jongno2026!"),
      });
    };
    seed("sample-admin", "admin@jongno.test", "admin");
    seed("sample-staff", "staff@jongno.test", "staff");
    seed("sample-worker1", "worker1@jongno.test", "worker", "W001");
    seed("sample-worker2", "worker2@jongno.test", "worker", "W004");
    seed("sample-inactive", "inactive@jongno.test", "staff", null, false);
    seed("other-admin", "admin@demo.test", "admin", null, true, "demo-company");
  }
  authenticate(login: string, password: string) {
    if (
      typeof login !== "string" ||
      typeof password !== "string" ||
      login.length > 200 ||
      password.length > 200
    )
      throw new UnauthorizedException("아이디와 비밀번호를 확인해 주세요.");
    const key = login.trim().toLowerCase(),
      now = Date.now(),
      attempt = this.attempts.get(key);
    if (attempt && attempt.until > now && attempt.count >= 10)
      throw new UnauthorizedException("잠시 후 다시 로그인해 주세요.");
    const u = [...this.users.values()].find(
      (u) => u.loginId.toLowerCase() === key || u.email.toLowerCase() === key,
    );
    // Equal-cost verification also runs for unknown accounts.
    const valid = verify(
      password,
      u?.passwordHash ?? this.users.get("sample-admin")!.passwordHash,
    );
    if (!u || !valid || !u.active || u.role === "customer") {
      this.attempts.set(key, {
        count: attempt && attempt.until > now ? attempt.count + 1 : 1,
        until: now + 300000,
      });
      throw new UnauthorizedException(
        "로그인할 수 없습니다. 계정 정보와 활성 상태를 확인해 주세요.",
      );
    }
    this.attempts.delete(key);
    return publicUser(u);
  }
  session(user: CurrentUser, remember: boolean) {
    const token = randomBytes(32).toString("hex");
    const ttl = remember ? 30 * 86400 : 8 * 3600;
    this.sessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + ttl * 1000,
    });
    return { token, ttl };
  }
  private token(request: unknown) {
    const r = request as { headers?: Record<string, string> };
    const cookie = r.headers?.cookie ?? "";
    return (
      cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("field_session="))
        ?.slice(14) ?? ""
    );
  }
  resolve(request: unknown): CompanyIdentity {
    const token = this.token(request),
      s = this.sessions.get(token),
      u = s ? this.users.get(s.userId) : undefined;
    if (
      !s ||
      s.expiresAt <= Date.now() ||
      !u?.active ||
      u.role === "customer"
    ) {
      this.sessions.delete(token);
      throw new UnauthorizedException("로그인이 필요합니다.");
    }
    const identity: CompanyIdentity = {
      companyId: u.companyId,
      userId: u.id,
      userDisplayName: u.displayName,
      authenticated: true,
      appRole: u.role,
      permissions: [...u.permissions],
      accessibleSiteIds: u.role === "admin" ? undefined : [...u.siteIds],
      workerId: u.role === "worker" ? (u.workerId ?? undefined) : undefined,
      canEditSchedule:
        u.role === "admin" || u.permissions.includes("editSchedule"),
      memberships: [
        {
          companyId: u.companyId,
          userId: u.id,
          role:
            u.role === "admin"
              ? "admin"
              : u.role === "staff"
                ? "member"
                : "viewer",
        },
      ],
    };
    if (u.role === "worker")
      identity.accessibleSiteIds = this.company.run(identity, () =>
        this.sites
          .list()
          .filter((s) => !s.deletedAt && this.policy.allowedSite(s.id))
          .map((s) => s.id),
      );
    return identity;
  }
  logout(request: unknown) {
    this.sessions.delete(this.token(request));
  }
  current() {
    const u = this.users.get(this.company.identity.userId);
    if (!u) throw new UnauthorizedException();
    return publicUser(u);
  }
  list() {
    this.company.assertMember(true);
    return [...this.users.values()]
      .filter((u) => u.companyId === this.company.companyId)
      .map(publicUser);
  }
  save(body: unknown, id?: string) {
    this.company.assertMember(true);
    const b = body as Partial<CurrentUser> & { password?: string };
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new BadRequestException();
    const existing = id ? this.users.get(id) : undefined;
    if (id && (!existing || existing.companyId !== this.company.companyId))
      throw new ForbiddenException("현재 회사 사용자만 관리할 수 있습니다.");
    if (b.companyId !== this.company.companyId)
      throw new ForbiddenException(
        "관리 권한이 있는 현재 회사에만 배정할 수 있습니다.",
      );
    for (const key of ["loginId", "email", "name", "displayName"] as const)
      if (typeof b[key] !== "string" || !b[key]!.trim() || b[key]!.length > 200)
        throw new BadRequestException(
          "사용자 이름과 로그인 정보를 확인해 주세요.",
        );
    if (
      !roles.includes(b.role!) ||
      typeof b.active !== "boolean" ||
      !Array.isArray(b.siteIds) ||
      b.siteIds.some((s) => typeof s !== "string" || !this.sites.find(s)) ||
      !Array.isArray(b.permissions) ||
      b.permissions.some((p) => !permissions.includes(p))
    )
      throw new BadRequestException("역할과 접근 범위를 확인해 주세요.");
    if (
      (b.workerId &&
        (!this.workers.find(b.workerId) ||
          this.workers.find(b.workerId)?.deletedAt)) ||
      (b.role === "worker" && !b.workerId)
    )
      throw new BadRequestException("작업진행자 연결이 필요합니다.");
    if (b.role !== "staff" && b.role !== "admin" && b.permissions.length)
      throw new BadRequestException(
        "작업진행자에게 회사 관리 권한을 부여할 수 없습니다.",
      );
    if (
      [...this.users.values()].some(
        (u) =>
          u.id !== id &&
          (u.loginId.toLowerCase() === b.loginId!.trim().toLowerCase() ||
            u.email.toLowerCase() === b.email!.trim().toLowerCase()),
      )
    )
      throw new BadRequestException("이미 사용 중인 로그인 정보입니다.");
    if (
      existing?.role === "admin" &&
      (!b.active || b.role !== "admin") &&
      !this.list().some((u) => u.id !== id && u.active && u.role === "admin")
    )
      throw new BadRequestException(
        "활성 관리자를 한 명 이상 유지해야 합니다.",
      );
    if (
      (!existing && !b.password) ||
      (b.password &&
        (typeof b.password !== "string" ||
          b.password.length < 8 ||
          b.password.length > 200))
    )
      throw new BadRequestException("비밀번호는 8~200자로 입력해 주세요.");
    const u: StoredUser = {
      id: id ?? randomUUID(),
      companyId: this.company.companyId,
      loginId: b.loginId!.trim(),
      email: b.email!.trim(),
      name: b.name!.trim(),
      displayName: b.displayName!.trim(),
      role: b.role!,
      active: b.active!,
      workerId: b.role === "worker" ? b.workerId! : null,
      siteIds: [...new Set(b.siteIds)],
      permissions: [...new Set(b.permissions)],
      passwordHash: b.password ? hash(b.password) : existing!.passwordHash,
    };
    this.users.set(u.id, u);
    this.audit.record({
      targetType: "사용자",
      targetId: u.id,
      action: existing ? "수정" : "생성",
      before: existing ? publicUser(existing) : null,
      after: publicUser(u),
      siteIds: [...new Set([...(existing?.siteIds ?? []), ...u.siteIds])],
      reason: "사용자 계정과 역할 관리 (비밀번호 제외)",
    });
    return publicUser(u);
  }
  options() {
    this.company.assertMember(true);
    return {
      companies: [this.company.settings()],
      sites: this.sites
        .list()
        .filter((s) => !s.deletedAt)
        .map((s) => ({ id: s.id, name: s.name })),
      workers: this.workers
        .list()
        .filter((w) => !w.deletedAt)
        .map((w) => ({ id: w.id, name: w.name, displayName: w.displayName })),
    };
  }
}
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_PROVIDER) private auth: AuthProvider,
    @Inject(CompanyContext) private company: CompanyContext,
  ) {}
  @Get("config") config() {
    return {
      appBrand: APP_BRAND,
      company: {
        id: this.company.settings().id,
        name: this.company.settings().name,
        displayName: this.company.settings().displayName,
        logoUrl: this.company.settings().logoUrl,
      },
      sampleMode: true,
    };
  }
  @Post("login") login(
    @Body() body: { login: string; password: string; remember?: boolean },
    @Res({ passthrough: true }) res: any,
  ) {
    if (body?.remember !== undefined && typeof body.remember !== "boolean")
      throw new BadRequestException();
    const user = this.auth.authenticate(body?.login, body?.password);
    const { token, ttl } = this.auth.session(user, body.remember === true);
    res.setHeader("Cache-Control", "no-store");
    res.cookie("field_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.AUTH_SECURE_COOKIE === "true",
      path: "/",
      ...(body.remember ? { maxAge: ttl * 1000 } : {}),
    });
    return { user };
  }
  @Get("me") me() {
    return {
      user: this.auth.current(),
      company: this.company.settings(),
      appBrand: APP_BRAND,
    };
  }
  @Post("logout") logout(
    @Req() req: unknown,
    @Res({ passthrough: true }) res: any,
  ) {
    this.auth.logout(req);
    res.clearCookie("field_session", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
    return { ok: true };
  }
}
@Controller("users")
export class UsersController {
  constructor(@Inject(AUTH_PROVIDER) private auth: AuthProvider) {}
  @Get() list() {
    return this.auth.list();
  }
  @Get("options") options() {
    return this.auth.options();
  }
  @Post() create(@Body() body: unknown) {
    return this.auth.save(body);
  }
  @Put(":id") update(@Param("id") id: string, @Body() body: unknown) {
    return this.auth.save(body, id);
  }
}
