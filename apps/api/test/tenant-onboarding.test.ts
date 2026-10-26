import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { fixture } from "./supabase-fixture";
import { CorePersistence } from "../src/core-persistence";
import { TenantOnboardingService } from "../src/tenant-onboarding";
const legacyId = "10000000-0000-4000-8000-000000000002";
async function schema(db: PGlite) {
  await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}');
 create table auth.identities(user_id uuid,provider text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
  for (const f of [
    "002-supabase-auth.sql",
    "003-trial-isolation.sql",
    "004-membership-providers.sql",
    "005-signup-profile.sql",
  ])
    await db.exec(readFileSync(join(__dirname, "../migrations", f), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    legacyId,
    "admin@example.test",
  ]);
  await db.query(
    "update public.app_memberships set company_id='jongro',role='admin',active=true,approval_status='approved' where user_id=$1",
    [legacyId],
  );
  for (const f of [
    "006-core-business.sql",
    "007-company-onboarding.sql",
    "007-company-onboarding.sql",
  ])
    await db.exec(readFileSync(join(__dirname, "../migrations", f), "utf8"));
}
function attach(app: any, db: PGlite) {
  const core = app.get(CorePersistence) as any;
  core.mode = "postgres";
  core.pool = {
    query: db.query.bind(db),
    connect: async () => ({ query: db.query.bind(db), release() {} }),
    end: async () => {},
  };
  app.get(TenantOnboardingService).enabled = true;
}
async function login(http: any, email: string) {
  const agent = request.agent(http);
  await agent
    .post("/api/auth/login")
    .send({ login: email, password: "Fixture123!" })
    .expect(201);
  return agent;
}
const form = (email: string) => ({
  kind: "company",
  companyName: "테스트 업체",
  name: "첫 관리자",
  email,
  password: "Fixture123!",
  phone: "01012345678",
  representative: "대표자",
  registrationNumber: "1234567890",
  logoUrl:
    "data:image/png;base64," +
    readFileSync(join(__dirname, "../fixtures/photos/sample-1.png")).toString(
      "base64",
    ),
});
test("tenant onboarding: bootstrap, invites, approval, company isolation, multi-company selection and disk restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tenant-db-"));
  let db = new PGlite(dir);
  await schema(db);
  const f = await fixture({
    onSignup: async (p) => {
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
        [p.id, p.email, p.user_metadata],
      );
    },
  });
  try {
    attach(f.a, db);
    const http = f.a.getHttpServer();
    const legacy = await login(http, "admin@example.test");
    assert.equal(
      (await legacy.get("/api/auth/me").expect(200)).body.user.companyId,
      "jongro",
    );
    await request(http)
      .get("/api/tenant/companies/no-such-company")
      .expect(404);
    await request(http).get("/api/tenant/companies/jongro").expect(200);
    const registered = (
      await request(http)
        .post("/api/tenant/register")
        .send(form("founder@example.test"))
        .expect(201)
    ).body;
    const slug = registered.companySlug;
    assert(slug);
    assert.notEqual(slug, "jongro");
    const branding = (
      await request(http)
        .get("/api/tenant/companies/" + slug)
        .expect(200)
    ).body;
    assert.equal(branding.name, "테스트 업체");
    assert(branding.logoUrl.startsWith("data:image/png"));
    assert(!JSON.stringify(branding).includes("registrationNumber"));
    f.confirmEmail("founder@example.test");
    const founder = await login(http, "founder@example.test");
    const me = (await founder.get("/api/auth/me").expect(200)).body;
    assert.equal(me.user.role, "admin");
    assert.equal(me.access, "approved");
    const companyId = me.user.companyId;
    assert(me.company.logoUrl.startsWith("/api/company/branding/logo?"));
    await founder.get(me.company.logoUrl).expect(200);
    await legacy.get(me.company.logoUrl).expect(404);

    const membership = (
      await db.query<any>(
        "select * from public.app_memberships where user_id=$1",
        [me.user.id],
      )
    ).rows[0];
    assert.equal(membership.approval_status, "approved");
    assert.equal(membership.active, true);
    const staffInvite = (
      await founder
        .post("/api/tenant/invitations")
        .send({ role: "staff" })
        .expect(201)
    ).body;
    const workerInvite = (
      await founder
        .post("/api/tenant/invitations")
        .send({ role: "worker" })
        .expect(201)
    ).body;
    const staffToken = staffInvite.path.split("/").at(-1),
      workerToken = workerInvite.path.split("/").at(-1);
    const workerSignup = {
      kind: "invite",
      inviteToken: workerToken,
      name: "신규 작업자",
      phone: "01098765432",
      email: "new-worker@example.test",
      password: "Fixture123!",
    };
    await request(http)
      .post("/api/tenant/register")
      .send(workerSignup)
      .expect(201);
    f.confirmEmail(workerSignup.email);
    const workerAgent = await login(http, workerSignup.email);
    assert.equal(
      (await workerAgent.get("/api/auth/me").expect(200)).body.access,
      "pending",
    );
    const workerAccountId = [...f.people.values()].find(
      (p) => p.email === workerSignup.email,
    ).id;
    assert.equal(
      (
        await db.query<any>(
          "select requested_role from public.app_memberships where user_id=$1",
          [workerAccountId],
        )
      ).rows[0].requested_role,
      "worker",
    );
    assert(
      !JSON.stringify(
        (await founder.get("/api/tenant/invitations").expect(200)).body,
      ).includes(staffToken),
    );
    assert.equal(
      (
        await request(http)
          .get("/api/tenant/invites/" + workerToken)
          .expect(200)
      ).body.role,
      "worker",
    );
    await request(http)
      .post("/api/tenant/register")
      .send({
        ...form("forged@example.test"),
        kind: "invite",
        inviteToken: staffToken,
        company_id: "jongro",
      })
      .expect(400);
    const invited = {
      kind: "invite",
      inviteToken: staffToken,
      name: "초대 직원",
      phone: "01012345678",
      email: "staff@example.test",
      password: "Fixture123!",
    };
    await request(http).post("/api/tenant/register").send(invited).expect(201);
    f.confirmEmail(invited.email);
    const staff = await login(http, invited.email);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.access,
      "pending",
    );
    await staff.get("/api/sites").expect(403);
    const staffId = [...f.people.values()].find(
      (p) => p.email === invited.email,
    ).id;
    assert(
      (await founder.get("/api/users").expect(200)).body.some(
        (r: any) => r.id === staffId,
      ),
    );
    assert(
      !(await legacy.get("/api/users").expect(200)).body.some(
        (r: any) => r.id === staffId,
      ),
    );
    const approval = {
      action: "approve",
      companyId,
      role: "staff",
      workerId: null,
      siteIds: [],
      permissions: ["writeQuotes"],
    };
    await legacy
      .post("/api/users/" + staffId + "/approval")
      .send({ ...approval, companyId: "jongro" })
      .expect(403);
    await founder
      .post("/api/users/" + staffId + "/approval")
      .send(approval)
      .expect(201);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.access,
      "approved",
    );
    await staff.get("/api/operational/sites").expect(200);
    const date = "2026-10-26";
    const site = (
      await founder
        .post("/api/sites")
        .send({
          name: "회사별 현장",
          client: "거래처",
          startDate: date,
          endDate: date,
          status: "미배정",
          contractAmount: 500000,
        })
        .expect(201)
    ).body;
    await legacy.get("/api/sites/" + site.id).expect(404);
    await legacy
      .put("/api/sites/" + site.id)
      .send(site)
      .expect(404);
    const legacyInvite = (
      await legacy
        .post("/api/tenant/invitations")
        .send({ role: "worker" })
        .expect(201)
    ).body;
    await staff
      .post(
        "/api/tenant/invites/" + legacyInvite.path.split("/").at(-1) + "/apply",
      )
      .expect(201);
    await staff
      .post(
        "/api/tenant/invites/" + legacyInvite.path.split("/").at(-1) + "/apply",
      )
      .expect(409);
    const worker = (
      await legacy
        .post("/api/workers")
        .send({
          name: "초대 직원",
          displayName: "초대 작업자",
          phone: "",
          role: "기사",
          memo: "",
          defaultAvailability: "근무가능",
        })
        .expect(201)
    ).body;
    await legacy
      .post("/api/users/" + staffId + "/approval")
      .send({
        action: "approve",
        companyId: "jongro",
        role: "worker",
        workerId: worker.id,
        siteIds: [],
        permissions: [],
      })
      .expect(201);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.access,
      "choose_company",
    );
    await staff.get("/api/operational/sites").expect(403);
    await staff
      .post("/api/tenant/company-selection")
      .send({ companyId: "not-owned" })
      .expect(403);
    await staff
      .post("/api/tenant/company-selection")
      .send({ companyId: "jongro" })
      .expect(201);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.user.role,
      "worker",
    );
    await staff.get("/api/dashboard").expect(403);
    await staff
      .post("/api/tenant/company-selection")
      .send({ companyId })
      .expect(201);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.user.role,
      "staff",
    );
    await staff
      .post("/api/tenant/invitations")
      .send({ role: "staff" })
      .expect(403);
    await staff
      .post("/api/auth/login")
      .send({
        login: invited.email,
        password: "Fixture123!",
        companySlug: "jongro",
      })
      .expect(201);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.user.companyId,
      "jongro",
    );
    await request
      .agent(http)
      .post("/api/auth/login")
      .send({
        login: "founder@example.test",
        password: "Fixture123!",
        companySlug: "jongro",
      })
      .expect(403);
    const rejected = { ...invited, email: "rejected@example.test" };
    await request(http).post("/api/tenant/register").send(rejected).expect(201);
    f.confirmEmail(rejected.email);
    const rid = [...f.people.values()].find(
      (p) => p.email === rejected.email,
    ).id;
    await founder
      .post("/api/users/" + rid + "/approval")
      .send({ action: "reject" })
      .expect(201);
    assert.equal(
      (
        await (await login(http, rejected.email))
          .get("/api/auth/me")
          .expect(200)
      ).body.access,
      "blocked",
    );
    await request(http)
      .get("/api/tenant/invites/" + "x".repeat(43))
      .expect(404);
    await founder
      .put("/api/tenant/invitations/" + workerInvite.id + "/revoke")
      .expect(200);
    await request(http)
      .get("/api/tenant/invites/" + workerToken)
      .expect(404);
    await db.query(
      "update app_core.company_invites set expires_at=now()-interval '1 minute' where id=$1",
      [staffInvite.id],
    );
    await request(http)
      .get("/api/tenant/invites/" + staffToken)
      .expect(410);
    await founder
      .put("/api/users/" + me.user.id)
      .send({
        companyId,
        role: "staff",
        active: true,
        locked: false,
        approvalStatus: "승인",
        siteIds: [],
        permissions: [],
        displayName: "관리자",
      })
      .expect(400);
    assert.equal(
      (await founder.get("/api/auth/me").expect(200)).body.user.role,
      "admin",
    );
    await founder
      .put("/api/tenant/branding")
      .send({ slug: "my-fire-company" })
      .expect(200);
    await request(http)
      .get("/api/tenant/companies/my-fire-company")
      .expect(200);
    await request(http)
      .get("/api/tenant/companies/" + slug)
      .expect(404);
    await founder
      .put("/api/tenant/branding")
      .send({ slug: "jongro" })
      .expect(409);
    await db.close();
    db = new PGlite(dir);
    const restarted = await f.app();
    attach(restarted, db);
    try {
      const again = await login(
        restarted.getHttpServer(),
        "founder@example.test",
      );
      assert.equal(
        (await again.get("/api/auth/me").expect(200)).body.user.companyId,
        companyId,
      );
      assert.equal(
        (await again.get("/api/sites/" + site.id).expect(200)).body.name,
        "회사별 현장",
      );
      await request(restarted.getHttpServer())
        .get("/api/tenant/companies/my-fire-company")
        .expect(200);
      await db.query(
        "UPDATE app_core.companies SET active=false WHERE company_id=$1",
        [companyId],
      );
      assert.equal(
        (await again.get("/api/auth/me").expect(200)).body.access,
        "blocked",
      );
      await again.get("/api/sites").expect(403);
      await db.query(
        "UPDATE app_core.companies SET active=true WHERE company_id=$1",
        [companyId],
      );
      assert.equal(
        (await again.get("/api/auth/me").expect(200)).body.access,
        "approved",
      );
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("007 SQL: forged metadata never grants a company; RLS excludes other tenants and unassigned applicants", async () => {
  const db = new PGlite();
  try {
    await schema(db);
    const other = randomUUID(),
      stranger = randomUUID();
    await assert.rejects(
      db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
        [
          stranger,
          "stranger@example.test",
          { role: "admin", company_id: "jongro", onboarding_token: "forged" },
        ],
      ),
      /Invalid or expired/,
    );
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [
        stranger,
        "stranger@example.test",
        { role: "admin", company_id: "jongro" },
      ],
    );
    assert.equal(
      (
        await db.query<any>(
          "select * from public.app_memberships where user_id=$1",
          [stranger],
        )
      ).rows[0].company_id,
      null,
    );
    await db.exec(
      "insert into app_core.companies(company_id,slug) values('other','other-company')",
    );
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      other,
      "other@example.test",
    ]);
    await db.query(
      "update public.app_memberships set company_id='other',role='admin',active=true,approval_status='approved' where user_id=$1",
      [other],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      legacyId,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from public.app_memberships")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "update public.app_memberships set active=false where user_id=$1 returning id",
          [other],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.exec("select * from app_core.onboarding_intents"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into public.app_memberships(user_id,email,company_id,role,approval_status,active) values($1,$2,'other','admin','approved',true)",
      [legacyId, "admin@example.test"],
    );
    await db.query(
      "update public.app_memberships set company_id='jongro',role='staff' where user_id=$1",
      [stranger],
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        "update public.app_memberships set company_id='other' where user_id=$1 and company_id='jongro'",
        [stranger],
      ),
      /ownership is immutable/,
    );
    await db.exec("reset role");
    await db.exec(
      "update app_core.companies set active=false where company_id='jongro'",
    );
    await db.exec("set role authenticated");
    assert.equal(
      (
        await db.query(
          "select * from app_core.companies where company_id='jongro'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
