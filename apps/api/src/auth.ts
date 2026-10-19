import type { Request, Response } from "express";
import { SupabaseAuthService } from "./supabase-auth";
import {companyBranding} from "./quote-presentation";
import { PermissionService } from "./permission.service";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Header,
  Logger,
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
import { APP_BRAND, DEFAULT_COMPANY } from "@jongro/shared";
import { CompanyContext, CompanyIdentity } from "./company-context";
import { CompanyIdentityProvider } from "./company-identity";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import {
  CurrentUser,
  UserRole,
  UserPermission as Permission,
} from "@jongro/shared";
export type { CurrentUser, UserRole } from "@jongro/shared";
import { AuditRecorder } from "./audit-recorder";
interface StoredUser extends CurrentUser {
  passwordHash: string;
}
export interface AuthProvider {
  readonly demoEnabled?: boolean;
  demoLogin?(account: string): CurrentUser;
  authenticate(login: string, password: string): CurrentUser;
  resolve(request: unknown): CompanyIdentity;
  session(user: CurrentUser, remember: boolean): { token: string; ttl: number };
  current(): CurrentUser;
  logout(request: unknown): void;
  list(): CurrentUser[];
  save(body: unknown, id?: string): CurrentUser;
  register(body: unknown): { status: string };
  updateProfile(body: unknown): CurrentUser;
  options(): {
    companies: import("@jongro/shared").Company[];
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
  "manageMaterials",
  "approveMaterials",
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
  readonly demoEnabled = (process.env.NODE_ENV !== "production" || process.env.APP_ENV === "test") && (
    process.env.DEMO_LOGIN_ENABLED === "true" ||
    (process.env.DEMO_LOGIN_ENABLED !== "false" && process.env.NODE_ENV !== "production"));
  private users = new Map<string, StoredUser>();
  private dummyHash = hash(randomBytes(32).toString("hex"));
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
    if (!this.demoEnabled) return;
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
        isDemo:true,
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
        passwordHash: hash("Jongro2026!"),
      });
    };
    seed("sample-admin", "admin@jongro.test", "admin");
    seed("sample-staff", "staff@jongro.test", "staff");
    seed("sample-worker1", "worker1@jongro.test", "worker", "W001");
    seed("sample-worker2", "worker2@jongro.test", "worker", "W004");
    seed("sample-inactive", "inactive@jongro.test", "staff", null, false);
    seed("other-admin", "admin@demo.test", "admin", null, true, "demo-company");
  }
  demoLogin(account: string) {
    if (!this.demoEnabled)
      throw new UnauthorizedException("데모 로그인이 비활성화되어 있습니다.");
    const keys: Record<string, string> = {
      admin: "admin@jongro.test",
      staff: "staff@jongro.test",
      worker1: "worker1@jongro.test",
      worker2: "worker2@jongro.test",
    };
    if (!Object.hasOwn(keys, account))
      throw new BadRequestException("데모 계정을 선택해 주세요.");
    return this.authenticate(keys[account], "Jongro2026!");
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
    const currentValid = verify(password, u?.passwordHash ?? this.dummyHash);
    // Preserve the original demo password only while a seeded account remains unchanged.
    const legacyDemoValid = !currentValid && this.demoEnabled &&
      !!u && ["sample-admin", "sample-staff", "sample-worker1", "sample-worker2", "sample-inactive"].includes(u.id) &&
      password === "Jongno2026!" && verify("Jongro2026!", u.passwordHash);
    const valid = currentValid || legacyDemoValid;
    if (
      !u ||
      !valid ||
      !u.active ||
      u.locked ||
      (u.approvalStatus && u.approvalStatus !== "승인") ||
      u.role === "customer"
    ) {
      if (
        process.env.NODE_ENV !== "production" ||
        process.env.AUTH_DIAGNOSTICS === "true"
      )
        console.warn(
          "[auth] login rejected:",
          !u
            ? "account missing (demo seed disabled or unknown login)"
            : !valid
              ? "password mismatch"
              : !u.active
                ? "inactive or awaiting approval"
                : u.locked
                  ? "account locked"
                  : u.role === "customer"
                    ? "customer access not enabled"
                    : "approval required",
        );
      this.attempts.set(key, {
        count: attempt && attempt.until > now ? attempt.count + 1 : 1,
        until: now + 300000,
      });
      throw new UnauthorizedException(
        this.demoEnabled && u?.id.startsWith("sample-")
          ? !valid ? "테스트 계정 비밀번호가 일치하지 않습니다. 초기 공통 비밀번호는 Jongro2026!입니다. 비밀번호를 변경했다면 변경한 비밀번호를 입력해 주세요."
            : !u.active ? "비활성 또는 승인대기 계정입니다. 관리자에게 활성 상태를 확인해 주세요."
            : u.locked ? "잠긴 계정입니다. 관리자에게 잠금 해제를 요청해 주세요."
            : "승인되지 않은 계정입니다. 관리자에게 확인해 주세요."
          : "로그인할 수 없습니다. 계정 정보와 활성 상태를 확인해 주세요.",
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
      u.locked ||
      (u.approvalStatus && u.approvalStatus !== "승인") ||
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
      (!b.active ||
        b.locked ||
        (b.approvalStatus && b.approvalStatus !== "승인") ||
        b.role !== "admin") &&
      !this.list().some(
        (u) =>
          u.id !== id &&
          u.active &&
          !u.locked &&
          (!u.approvalStatus || u.approvalStatus === "승인") &&
          u.role === "admin",
      )
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
    if (
      b.approvalStatus &&
      !["승인대기", "승인", "거절", "비활성"].includes(b.approvalStatus)
    )
      throw new BadRequestException("가입 상태를 확인하세요.");
    const u: StoredUser = {
      isDemo: existing?.isDemo === true,
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
      phone:
        typeof b.phone === "string"
          ? b.phone.trim().slice(0, 30)
          : (existing?.phone ?? ""),
      approvalStatus: b.approvalStatus ?? existing?.approvalStatus ?? "승인",
      requestedCompany: existing?.requestedCompany,
      appliedAt: existing?.appliedAt,
      locked: b.locked === true,
      passwordResetRequired: b.password
        ? false
        : b.passwordResetRequired === true,
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
  register(raw: unknown) {
    const b = raw as Record<string, unknown>;
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      !["staff", "worker", "customer"].includes(String(b.role))
    )
      throw new BadRequestException("가입 유형을 확인해 주세요.");
    for (const k of ["name", "email", "phone", "companyName", "password"])
      if (
        typeof b[k] !== "string" ||
        !String(b[k]).trim() ||
        String(b[k]).length > 200
      )
        throw new BadRequestException("가입 신청 정보를 확인해 주세요.");
    const email = String(b.email).trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      String(b.password).length < 8
    )
      throw new BadRequestException(
        "이메일과 8자 이상의 비밀번호를 입력하세요.",
      );
    if (
      [...this.users.values()].some(
        (u) =>
          u.email.toLowerCase() === email || u.loginId.toLowerCase() === email,
      )
    )
      throw new BadRequestException("이미 등록된 이메일입니다.");
    const id = randomUUID();
    this.users.set(id, {
      id,
      companyId: this.company.signupCompany(String(b.companyName)),
      loginId: email,
      email,
      name: String(b.name).trim(),
      displayName: String(b.name).trim(),
      phone: String(b.phone).trim(),
      requestedCompany: String(b.companyName).trim(),
      role: b.role as UserRole,
      active: false,
      approvalStatus: "승인대기",
      locked: false,
      passwordResetRequired: false,
      workerId: null,
      siteIds: [],
      permissions: [],
      passwordHash: hash(String(b.password)),
      appliedAt: new Date().toISOString(),
    });
    return { status: "승인대기" };
  }
  updateProfile(raw: unknown) {
    const old = this.users.get(this.company.identity.userId);
    if (!old) throw new UnauthorizedException();
    const b = raw as Record<string, unknown>;
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      Object.keys(b).some(
        (k) =>
          ![
            "name",
            "displayName",
            "phone",
            "email",
            "password",
            "currentPassword",
          ].includes(k),
      )
    )
      throw new ForbiddenException(
        "회사·역할·접근범위는 본인이 변경할 수 없습니다.",
      );
    const u = { ...old };
    for (const k of ["name", "displayName", "phone", "email"] as const) {
      if (b[k] === undefined) continue;
      if (
        typeof b[k] !== "string" ||
        String(b[k]).length > 200 ||
        (k !== "phone" && !String(b[k]).trim())
      )
        throw new BadRequestException("내 정보를 확인해 주세요.");
      u[k] = String(b[k]).trim();
    }
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) ||
      [...this.users.values()].some(
        (v) =>
          v.id !== u.id &&
          (v.email.toLowerCase() === u.email.toLowerCase() ||
            v.loginId.toLowerCase() === u.email.toLowerCase()),
      )
    )
      throw new BadRequestException("사용 가능한 이메일을 입력하세요.");
    if (b.password) {
      if (
        typeof b.currentPassword !== "string" ||
        b.currentPassword.length > 200 ||
        !verify(b.currentPassword, old.passwordHash)
      )
        throw new UnauthorizedException("현재 비밀번호를 확인하세요.");
      if (
        typeof b.password !== "string" ||
        b.password.length < 8 ||
        b.password.length > 200
      )
        throw new BadRequestException("새 비밀번호는 8~200자로 입력하세요.");
      u.passwordHash = hash(b.password);
      u.passwordResetRequired = false;
      for (const [token, session] of this.sessions)
        if (session.userId === u.id) this.sessions.delete(token);
    }
    if (old.loginId === old.email) u.loginId = u.email;
    if (u.workerId) {
      const w = this.workers.find(u.workerId);
      if (w && !w.deletedAt)
        this.company.withOperationalWrite(() =>
          this.workers.update(w.id, {
            ...w,
            name: u.name,
            displayName: u.displayName,
            phone: u.phone ?? "",
          }),
        );
    }
    this.users.set(u.id, u);
    this.audit.record({
      targetType: "사용자",
      targetId: u.id,
      action: "수정",
      before: publicUser(old),
      after: publicUser(u),
      siteIds: u.siteIds,
      reason: "본인 정보 수정 (비밀번호 제외)",
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
  private loggedDemoDisabled = false;
  constructor(
    @Inject(AUTH_PROVIDER) private auth: AuthProvider,
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(SupabaseAuthService) private real: SupabaseAuthService,
  ) {}
  @Post("signup") signup(@Req() req:Request, @Res({passthrough:true}) res:Response, @Body() body: unknown) {
    return this.real.required ? this.real.signup(req,res,body) : this.auth.register(body);
  }
  @Get("google") google(@Req() req:Request,@Res() res:Response){return this.real.google(req,res);}
  @Get("callback") callback(@Req() req:Request,@Res() res:Response){return this.real.callback(req,res);}
  @Post("link/google") async linkGoogle(@Req() req:Request,@Res() res:Response){return this.real.google(req,res,true);}
  @Put("profile") profile(@Req() req:Request, @Body() body: unknown) {
    if(this.real.hasCredentials(req)) throw new BadRequestException("실제 계정의 이름·이메일·비밀번호는 Supabase 계정 관리에서 변경하세요. 회사와 역할은 앱 관리자가 지정합니다.");
    return this.auth.updateProfile(body);
  }
  @Get("config")
  @Header("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate")
  @Header("Pragma", "no-cache")
  @Header("Expires", "0")
  config() {
    if (!this.loggedDemoDisabled && !this.auth.demoEnabled && (process.env.RENDER === "true" || process.env.NODE_ENV !== "production")) {
      this.loggedDemoDisabled = true;
      new Logger("AuthConfig").warn(JSON.stringify({ event: "demo_login_disabled", configured: process.env.DEMO_LOGIN_ENABLED === "false" ? "false" : process.env.DEMO_LOGIN_ENABLED === undefined ? "unset" : "invalid", hint: "테스트환경은 DEMO_LOGIN_ENABLED=true 설정 후 API 프로세스를 재시작하세요.", build: process.env.RENDER_GIT_COMMIT ?? "local" }));
    }
    return {
      appBrand: APP_BRAND,
      company: this.real.required ? null : {
        id: this.company.settings().id,
        name: this.company.settings().name,
        displayName: this.company.settings().displayName,
        logoUrl: companyBranding(this.company.settings()).logoUrl,
      },
      sampleMode: !this.real.required,
      authMode: this.real.required ? "supabase" : "demo",
      supabaseConfigured: this.real.enabled,
      demoEnabled: this.auth.demoEnabled === true,
      loginRevision: "demo-config-no-cache-v3",
      buildVersion: process.env.RENDER_GIT_COMMIT ?? process.env.APP_BUILD_VERSION ?? "local",
    };
  }
  @Post("login") login(
    @Req() req:Request,
    @Body() body: { login: string; password: string; remember?: boolean },
    @Res({ passthrough: true }) res: any,
  ) {
    if (body?.remember !== undefined && typeof body.remember !== "boolean")
      throw new BadRequestException();
    if(this.real.required)return this.real.login(req,res,body);
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
  @Post("demo") async demoLogin(
    @Req() req:Request,
    @Body() body: { account: string; remember?: boolean },
    @Res({ passthrough: true }) res: any,
  ) {
    if (!this.auth.demoEnabled || !this.auth.demoLogin)
      throw new UnauthorizedException("데모 로그인이 비활성화되어 있습니다.");
    if (body?.remember !== undefined && typeof body.remember !== "boolean")
      throw new BadRequestException();
    if(this.real.hasCredentials(req))await this.real.logout(req,res);
    const user = this.auth.demoLogin(body?.account);
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
  @Get("me") me(@Req() req:Request,@Res({passthrough:true}) res:Response) {
    if(this.real.hasCredentials(req) || (this.real.required && !req.headers.cookie?.includes("field_session=")))return this.real.me(req,res);
    const identity=this.auth.resolve(req);
    return this.company.run(identity,()=>({user:this.auth.current(),company:companyBranding(this.company.settings()),appBrand:APP_BRAND,access:"approved",authMode:"demo"}));
  }
  @Post("logout") async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: any,
  ) {
    if(this.real.hasCredentials(req))await this.real.logout(req,res);
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
  constructor(@Inject(AUTH_PROVIDER) private auth: AuthProvider, @Inject(SupabaseAuthService) private real:SupabaseAuthService) {}
  @Get() list(@Req() req:Request) {
    return this.real.hasCredentials(req) ? this.real.list(req) : this.auth.list();
  }
  @Get("options") options(@Req() req:Request) {
    return {...this.auth.options(),authMode:this.real.hasCredentials(req)?"supabase":"demo"};
  }
  @Post() create(@Req() req:Request,@Body() body: unknown) {
    if(this.real.hasCredentials(req))throw new BadRequestException("사용자가 Supabase로 가입한 뒤 승인대기 목록에서 배정하세요.");
    return this.auth.save(body);
  }
  @Put(":id") update(@Req() req:Request,@Param("id") id: string, @Body() body: unknown) {
    return this.real.hasCredentials(req) ? this.real.save(req,id,body) : this.auth.save(body, id);
  }
}
