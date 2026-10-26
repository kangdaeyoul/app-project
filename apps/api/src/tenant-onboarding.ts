import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  OnModuleInit,
  ConflictException,
  GoneException,
} from "@nestjs/common";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { CorePersistence, companyProfile } from "./core-persistence";
import { CompanyContext } from "./company-context";
import { Company, quoteCompanyDefaults } from "@jongro/shared";
import { cleanCompanyProfile } from "./quote-presentation";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export interface VerifiedUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
}
@Injectable()
export class TenantOnboardingService implements OnModuleInit {
  enabled = false;
  private starts = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(CorePersistence) private core: CorePersistence,
    @Inject(CompanyContext) private context: CompanyContext,
  ) {}
  async onModuleInit() {
    if (this.core.mode !== "postgres") return;
    try {
      const result = await this.core.databaseQuery(
        "SELECT to_regclass('app_core.onboarding_intents') AS ready",
      );
      this.enabled = !!result.rows[0]?.ready;
    } catch {
      throw new ServiceUnavailableException(
        "업체 등록 DB 준비 상태를 확인하지 못했습니다.",
      );
    }
  }
  require() {
    if (!this.enabled)
      throw new ServiceUnavailableException(
        "업체 등록 준비 중입니다. 운영자에게 문의해 주세요.",
      );
  }
  private admin() {
    this.require();
    this.context.assertMember(true);
    if (!this.context.identity.authenticated || this.context.identity.trial)
      throw new ForbiddenException();
    return this.context.companyId;
  }
  rateLimit(key: string) {
    const now = Date.now();
    for (const [k, v] of this.starts) if (v.until < now) this.starts.delete(k);
    const state = this.starts.get(key) ?? {
      count: 0,
      until: now + 60 * 60_000,
    };
    if (++state.count > 10)
      throw new BadRequestException(
        "요청이 많습니다. 잠시 후 다시 시도하세요.",
      );
    this.starts.set(key, state);
  }
  private text(body: any, key: string, required = false, max = 200) {
    const value = body?.[key];
    if ((value === undefined || value === "") && !required) return "";
    if (typeof value !== "string" || value.length > max || !value.trim())
      throw new BadRequestException("입력 정보를 확인하세요.");
    return value.trim();
  }
  private publicCompany(row: any) {
    const p = companyProfile(row.company_id, row.payload);
    const logo = p.quoteProfile?.logo?.dataUrl ?? p.logoUrl;
    return {
      name: p.name,
      displayName: p.displayName,
      slug: row.slug,
      logoUrl:
        typeof logo === "string" &&
        (/^https:\/\//.test(logo) ||
          /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo))
          ? logo
          : null,
    };
  }
  async company(slug: string) {
    this.require();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
      throw new NotFoundException("존재하지 않는 업체입니다");
    const row = (
      await this.core.databaseQuery(
        "SELECT company_id,slug,payload FROM app_core.companies WHERE slug=$1 AND active",
        [slug],
      )
    ).rows[0];
    if (!row) throw new NotFoundException("존재하지 않는 업체입니다");
    return this.publicCompany(row);
  }
  async invite(raw: string) {
    this.require();
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
      throw new NotFoundException("유효하지 않은 초대 링크입니다.");
    const row = (
      await this.core.databaseQuery(
        `SELECT i.*,c.slug,c.payload,c.active AS company_active FROM app_core.company_invites i JOIN app_core.companies c USING(company_id) WHERE token_hash=$1`,
        [hash(raw)],
      )
    ).rows[0];
    if (!row || !row.is_active || !row.company_active)
      throw new NotFoundException("유효하지 않은 초대 링크입니다.");
    if (new Date(row.expires_at).getTime() <= Date.now())
      throw new GoneException("만료된 초대 링크입니다.");
    return {
      row,
      view: {
        company: this.publicCompany(row),
        role: row.role,
        expiresAt: row.expires_at,
      },
    };
  }
  async registration(body: any, ip: string) {
    this.require();
    for (const key of Object.keys(body ?? {}))
      if (
        ![
          "kind",
          "inviteToken",
          "companyName",
          "name",
          "email",
          "password",
          "phone",
          "registrationNumber",
          "representative",
          "companyPhone",
          "address",
          "logoUrl",
        ].includes(key)
      )
        throw new BadRequestException("가입 요청 정보를 확인하세요.");
    const email = this.text(body, "email", true).toLowerCase();
    this.rateLimit(ip + ":" + hash(email));
    const name = this.text(body, "name", true);
    const phone = this.text(body, "phone", true, 40);
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[-+()0-9\s]{5,40}$/.test(phone) ||
      typeof body.password !== "string" ||
      body.password.length < 8 ||
      body.password.length > 200
    )
      throw new BadRequestException("이메일·휴대전화·비밀번호를 확인하세요.");
    const raw = token();
    let companyId: string | null = null,
      slug: string | null = null,
      inviteId: string | null = null,
      payload: Partial<Company> = {};
    let role = "staff";
    if (body.kind === "company") {
      const companyName = this.text(body, "companyName", true);
      companyId = "co_" + randomUUID().replaceAll("-", "");
      const prefix =
        companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 32) || "company";
      slug = prefix + "-" + randomBytes(6).toString("hex");
      const base = companyProfile(companyId, {});
      const logo = this.text(body, "logoUrl", false, 500_000);
      if (
        logo &&
        !/^https:\/\//.test(logo) &&
        !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo)
      )
        throw new BadRequestException(
          "PNG/JPG 로고 또는 HTTPS 주소를 사용하세요.",
        );
      payload = {
        ...base,
        name: companyName,
        displayName: companyName,
        phone: this.text(body, "companyPhone", false, 40),
        address: this.text(body, "address", false, 300),
        logoUrl: logo || null,
        business: {
          ...base.business,
          name: companyName,
          representative: this.text(body, "representative"),
          registrationNumber: this.text(body, "registrationNumber", false, 40),
        },
      };
      const company = payload as Company;
      company.business.address = company.address;
      const profile = quoteCompanyDefaults(company);
      if (logo.startsWith("data:"))
        profile.logo = {
          companyId: company.id,
          dataUrl: logo,
          originalDataUrl: logo,
          filename: logo.startsWith("data:image/png") ? "logo.png" : "logo.jpg",
          backgroundRemoved: false,
        };
      company.quoteProfile = cleanCompanyProfile(profile, company);
    } else if (body.kind === "invite") {
      const invitation = await this.invite(String(body.inviteToken ?? ""));
      inviteId = invitation.row.id;
      role = invitation.row.role;
    } else
      throw new BadRequestException("업체 등록 또는 초대 링크로 가입하세요.");
    await this.core.databaseQuery(
      `INSERT INTO app_core.onboarding_intents(token_hash,kind,email,company_id,slug,payload,invite_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '30 minutes')`,
      [hash(raw), body.kind, email, companyId, slug, payload, inviteId],
    );
    return { email, name, phone, raw, role, slug, kind: body.kind };
  }
  async memberships(userId: string) {
    this.require();
    const result = await this.core.databaseQuery(
      `SELECT m.*,c.active AS company_active FROM public.app_memberships m LEFT JOIN app_core.companies c ON c.company_id=m.company_id WHERE m.user_id=$1 ORDER BY m.created_at,m.id`,
      [userId],
    );
    return result.rows.map((row) =>
      row.company_id && !row.company_active
        ? { ...row, active: false, approval_status: "inactive" }
        : row,
    );
  }
  async choices(userId: string) {
    const rows = await this.core.databaseQuery(
      `SELECT m.company_id,m.role,m.approval_status,m.active,m.locked,c.slug,c.payload FROM public.app_memberships m JOIN app_core.companies c USING(company_id) WHERE m.user_id=$1 AND c.active ORDER BY c.slug`,
      [userId],
    );
    return rows.rows.map((r) => ({
      companyId: r.company_id,
      role: r.role,
      status: r.approval_status,
      active: r.active && !r.locked,
      company: this.publicCompany(r),
    }));
  }
  async listInvites() {
    const company = this.admin();
    return (
      await this.core.databaseQuery(
        "SELECT id,role,expires_at,is_active,created_at FROM app_core.company_invites WHERE company_id=$1 ORDER BY created_at DESC",
        [company],
      )
    ).rows;
  }
  async createInvite(body: any) {
    const company = this.admin();
    if (
      !["staff", "worker"].includes(body?.role) ||
      Object.keys(body).some((k) => k !== "role")
    )
      throw new BadRequestException("초대 역할을 확인하세요.");
    const raw = token();
    const row = (
      await this.core.databaseQuery(
        `INSERT INTO app_core.company_invites(company_id,token_hash,role,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days') RETURNING id,role,expires_at,is_active,created_at`,
        [company, hash(raw), body.role, this.context.identity.userId],
      )
    ).rows[0];
    return { ...row, path: "/join/" + raw };
  }
  async revokeInvite(id: string) {
    const company = this.admin();
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new NotFoundException();
    const rows = await this.core.databaseQuery(
      "UPDATE app_core.company_invites SET is_active=false,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING id",
      [company, id],
    );
    if (!rows.rows.length) throw new NotFoundException();
    return { ok: true };
  }
  async branding() {
    const company = this.admin();
    const row = (
      await this.core.databaseQuery(
        "SELECT company_id,slug,payload,active FROM app_core.companies WHERE company_id=$1",
        [company],
      )
    ).rows[0];
    return { ...this.publicCompany(row), active: row.active };
  }
  async updateBranding(body: any) {
    const company = this.admin();
    if (
      Object.keys(body ?? {}).some((k) => k !== "slug") ||
      typeof body?.slug !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,62}$/.test(body.slug)
    )
      throw new BadRequestException(
        "회사 전용 주소는 영문 소문자·숫자·하이픈 2~63자로 입력하세요.",
      );
    // ON CONFLICT-like uniqueness errors are handled without aborting the outer request transaction.
    await this.core.databaseQuery("SAVEPOINT company_slug");
    try {
      await this.core.databaseQuery(
        "UPDATE app_core.companies SET slug=$2,updated_at=now() WHERE company_id=$1",
        [company, body.slug],
      );
    } catch (error) {
      await this.core.databaseQuery("ROLLBACK TO SAVEPOINT company_slug");
      if ((error as any).code === "23505")
        throw new ConflictException("이미 사용 중인 회사 전용 주소입니다.");
      throw error;
    }
    return this.branding();
  }
  async applyInvite(raw: string, user: VerifiedUser) {
    this.require();
    return this.core.databaseTransaction(async (client) => {
      const invitation = await this.invite(raw);
      const valid = (
        await client.query(
          "SELECT i.id FROM app_core.company_invites i JOIN app_core.companies c USING(company_id) WHERE i.id=$1 AND i.is_active AND i.expires_at>now() AND c.active FOR UPDATE OF i,c",
          [invitation.row.id],
        )
      ).rows[0];
      if (!valid) throw new GoneException("만료되거나 비활성화된 초대입니다.");
      // Lock Auth identity so simultaneous applications cannot create duplicate memberships.
      const auth = (
        await client.query("SELECT id FROM auth.users WHERE id=$1 FOR UPDATE", [
          user.id,
        ])
      ).rows[0];
      if (!auth) throw new ForbiddenException();
      const existing = (
        await client.query(
          "SELECT id FROM public.app_memberships WHERE company_id=$1 AND user_id=$2",
          [invitation.row.company_id, user.id],
        )
      ).rows[0];
      if (existing)
        throw new ConflictException("이미 가입 신청 또는 소속된 업체입니다.");
      await client.query(
        `INSERT INTO public.app_memberships(user_id,email,display_name,company_id,requested_company,requested_role) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          user.id,
          user.email ?? "",
          String(user.user_metadata?.display_name ?? "").slice(0, 200),
          invitation.row.company_id,
          invitation.view.company.name,
          invitation.row.role,
        ],
      );
      return { status: "pending" };
    });
  }
  async users() {
    const company = this.admin();
    return (
      await this.core.databaseQuery(
        "SELECT * FROM public.app_memberships WHERE company_id=$1 ORDER BY created_at",
        [company],
      )
    ).rows;
  }
  async updateMember(userId: string, changes: any, pendingOnly = false) {
    const company = this.admin();
    if (!/^[a-f0-9-]{36}$/i.test(userId))
      throw new BadRequestException("사용자를 확인하세요.");
    const allowed = [
      "role",
      "approval_status",
      "active",
      "locked",
      "worker_id",
      "site_ids",
      "permissions",
      "display_name",
    ];
    const keys = Object.keys(changes).filter((k) => allowed.includes(k));
    let result;
    try {
      result = await this.core.databaseQuery(
        `UPDATE public.app_memberships SET ${keys.map((k, i) => k + "=$" + (i + 3)).join(",")},approved_at=CASE WHEN $${keys.length + 3}='approved' THEN coalesce(approved_at,now()) ELSE approved_at END,approved_by=CASE WHEN $${keys.length + 3}='approved' THEN $${keys.length + 4}::uuid ELSE approved_by END WHERE company_id=$1 AND user_id=$2 ${pendingOnly ? "AND approval_status='pending'" : ""} RETURNING *`,
        [
          company,
          userId,
          ...keys.map((k) => changes[k]),
          changes.approval_status ?? "",
          this.context.identity.userId,
        ],
      );
    } catch (error) {
      if ((error as any).code === "P0001")
        throw new BadRequestException(
          "업체에는 최소 한 명의 활성 관리자가 필요합니다.",
        );
      throw error;
    }
    if (!result.rows.length)
      throw new ForbiddenException(
        "현재 업체의 처리 가능한 사용자만 변경할 수 있습니다.",
      );
    return result.rows[0];
  }
}
