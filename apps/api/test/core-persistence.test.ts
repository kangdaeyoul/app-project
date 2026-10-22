import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  CorePersistence,
  postgresCoreTransaction,
} from "../src/core-persistence";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { COMPANY_IDENTITY } from "../src/company-identity";
import { createTestApp } from "./test-app";
import { fixture } from "./supabase-fixture";
import { seoulToday } from "../src/date";
const admin = "10000000-0000-4000-8000-000000000001";
async function schema(db: PGlite) {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}');
    create table auth.identities(user_id uuid,provider text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid(),auth.jwt() to authenticated;`);
  for (const f of [
    "002-supabase-auth.sql",
    "003-trial-isolation.sql",
    "004-membership-providers.sql",
    "005-signup-profile.sql",
    "006-core-business.sql",
  ])
    await db.exec(readFileSync(join(__dirname, "../migrations", f), "utf8"));
  // Verify rerunnable migration and no dependency on seeded business data.
  await db.exec(
    readFileSync(
      join(__dirname, "../migrations/006-core-business.sql"),
      "utf8",
    ),
  );
  await db.exec(`insert into app_core.companies(company_id) values('jongro'),('other');
    insert into auth.users(id,email) values('${admin}','admin@example.test');
    update public.app_memberships set company_id='jongro',role='admin',approval_status='approved',active=true where user_id='${admin}';`);
}
function attach(app: any, db: PGlite) {
  const core = app.get(CorePersistence) as any;
  core.mode = "postgres";
  core.pool = {
    connect: async () => ({ query: db.query.bind(db), release() {} }),
    query: db.query.bind(db),
    end: async () => {},
  };
}
test("PostgreSQL: real migrations, API CRUD, restart, company isolation, trial isolation and rollback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "core-pg-"));
  let db = new PGlite(dir);
  let app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    await schema(db);
    attach(app, db);
    let http = app.getHttpServer();
    const date = seoulToday();
    const customer = (
      await request(http)
        .post("/api/customers")
        .send({ name: "영구 거래처", address: "", contactName: "", phone: "" })
        .expect(201)
    ).body;
    const workerInput = {
      name: "홍길동",
      displayName: "홍 소장",
      phone: "",
      role: "소장",
      memo: "",
      defaultAvailability: "근무가능",
    };
    const worker = (
      await request(http).post("/api/workers").send(workerInput).expect(201)
    ).body;
    await request(http)
      .put(`/api/workers/${worker.id}`)
      .send({ ...workerInput, displayName: "홍 팀장" })
      .expect(200);
    const worker2 = (
      await request(http)
        .post("/api/workers")
        .send({ ...workerInput, name: "참여자", displayName: "참여자" })
        .expect(201)
    ).body;
    const siteInput = {
      name: "영구 현장",
      client: "영구 거래처",
      clientId: customer.id,
      startDate: date,
      endDate: date,
      contractAmount: 123456,
      status: "미배정",
    };
    const site = (
      await request(http).post("/api/sites").send(siteInput).expect(201)
    ).body;
    await request(http)
      .put(`/api/sites/${site.id}`)
      .send({ ...siteInput, name: "수정 현장" })
      .expect(200);
    await request(http)
      .put(`/api/workers/${worker.id}/availability/${date}`)
      .send({ status: "근무가능", memo: "영구 저장" })
      .expect(200);
    const assignment = {
      siteId: site.id,
      date,
      managerId: worker.id,
      participantIds: [worker2.id],
      start: "09:00",
      end: "12:00",
    };
    const assigned = (
      await request(http)
        .post("/api/worker-schedule/assign")
        .send(assignment)
        .expect(201)
    ).body.work;
    const daily = {
      ...assigned,
      participantIds: [],
      content: "수정 작업",
      startTime: "09:00",
      endTime: "12:00",
      status: "작업완료",
    };
    await request(http)
      .put(`/api/daily-work/${assigned.id}`)
      .send(daily)
      .expect(200);
    assert.equal(
      (
        await db.query<any>(
          "select * from app_core.daily_work_participants where deleted_at is not null",
        )
      ).rows.length,
      1,
    );
    const company = (
      await request(http).get("/api/company/current").expect(200)
    ).body.company;
    await request(http)
      .put("/api/company/settings")
      .send({
        ...company,
        name: "보존 회사",
        displayName: "보존 회사",
        logoUrl: null,
      })
      .expect(200);
    await app.close();
    await db.close();
    db = new PGlite(dir);
    app = await createTestApp(AppModule, { logger: false });
    app.setGlobalPrefix("api");
    await app.init();
    attach(app, db);
    http = app.getHttpServer();
    assert.equal(
      (await request(http).get(`/api/sites/${site.id}`).expect(200)).body.name,
      "수정 현장",
    );
    assert.equal(
      (await request(http).get(`/api/daily-work/${assigned.id}`).expect(200))
        .body.content,
      "수정 작업",
    );
    assert.equal(
      (await request(http).get(`/api/workers/${worker.id}`).expect(200)).body
        .displayName,
      "홍 팀장",
    );
    assert.equal(
      (await request(http).get("/api/company/current").expect(200)).body.company
        .name,
      "보존 회사",
    );
    const schedule = (
      await request(http)
        .get(`/api/worker-schedule?from=${date}&to=${date}`)
        .expect(200)
    ).body;
    assert(schedule.events.some((e: any) => e.dailyWorkId === assigned.id));
    assert.equal(
      schedule.workers.find((w: any) => w.id === worker.id).availability[0]
        .status,
      "근무가능",
    );
    const context = app.get(CompanyContext);
    context.hydrate({ ...context.settings(), id: "other" });
    const identities = app.get(COMPANY_IDENTITY);
    identities.resolve = () => ({
      ...SAMPLE_IDENTITY,
      companyId: "other",
      memberships: [
        { companyId: "other", userId: SAMPLE_IDENTITY.userId, role: "admin" },
      ],
    });
    assert.deepEqual(
      (await request(http).get("/api/sites").expect(200)).body,
      [],
    );
    await request(http).get(`/api/sites/${site.id}`).expect(404);
    await request(http)
      .put(`/api/sites/${site.id}`)
      .send(siteInput)
      .expect(404);
    await request(http).delete(`/api/sites/${site.id}`).expect(404);
    await request(http)
      .post("/api/sites")
      .send({ ...siteInput, clientId: customer.id })
      .expect(400);
    await assert.rejects(
      db.query(
        "insert into app_core.daily_work(company_id,id,site_id,payload) values($1,$2,$3,$4)",
        ["other", "cross", site.id, {}],
      ),
      /foreign key/,
    );
    identities.resolve = () => SAMPLE_IDENTITY;
    const before = JSON.stringify(
      (await db.query("select * from app_core.sites")).rows,
    );
    await request(http)
      .put(`/api/sites/${site.id}`)
      .send({ ...siteInput, startDate: "invalid" })
      .expect(400);
    assert.equal(
      JSON.stringify((await db.query("select * from app_core.sites")).rows),
      before,
    );
    // FK failure during flush rolls back rows already upserted earlier in the transaction.
    const emptyState = () => ({
      customers: { records: [] },
      workers: { workers: [], overrides: [], records: {} },
      sites: { sites: [] },
      daily_work: { records: [], participants: [], catalog: [], usages: [] },
    });
    await assert.rejects(
      postgresCoreTransaction(db, "jongro", emptyState, async (state) => {
        state.states.customers.records.push({
          id: "rollback-customer",
          name: "must roll back",
        });
        state.states.sites.sites.push({
          id: "invalid-reference",
          managerId: "missing-worker",
        });
      }),
      /foreign key/,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from app_core.customers where id='rollback-customer'",
        )
      ).rows.length,
      0,
    );
    // Authenticated worker follows the same DB transaction and projection paths as production.
    const workerUser = "10000000-0000-4000-8000-000000000003";
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      workerUser,
      "assigned@example.test",
    ]);
    await db.query(
      "update public.app_memberships set company_id='jongro',role='worker',worker_id=$2,approval_status='approved',active=true where user_id=$1",
      [workerUser, worker.id],
    );
    const workerIdentity = {
      ...SAMPLE_IDENTITY,
      authenticated: true,
      appRole: "worker",
      userId: workerUser,
      workerId: worker.id,
      accessibleSiteIds: [],
      permissions: [],
      memberships: [
        { companyId: "jongro", userId: workerUser, role: "viewer" },
      ],
    };
    await app.get(CorePersistence).prepareCompany("jongro", worker.id);
    identities.resolve = () => workerIdentity;
    const visible = (
      await request(http).get("/api/operational/sites").expect(200)
    ).body;
    assert.equal(JSON.stringify(visible).includes("contractAmount"), false);
    assert.equal(JSON.stringify(visible).includes("margin"), false);
    await request(http).post("/api/sites").send(siteInput).expect(403);
    await request(http).get("/api/workers").expect(403);
    const ownSchedule = (
      await request(http)
        .get(`/api/worker-schedule?from=${date}&to=${date}`)
        .expect(200)
    ).body;
    assert(ownSchedule.events.some((e: any) => e.dailyWorkId === assigned.id));
    assert(
      ownSchedule.events.every((e: any) => e.workerIds.includes(worker.id)),
    );
    await db.query(
      "update public.app_memberships set locked=true where user_id=$1",
      [workerUser],
    );
    await request(http).get("/api/operational/sites").expect(403);
    identities.resolve = () => SAMPLE_IDENTITY;
    // Soft archive preserves FK-linked work.
    await request(http).delete(`/api/sites/${site.id}`).expect(200);
    await request(http).delete(`/api/workers/${worker2.id}`).expect(200);
    assert.equal(
      (
        await db.query<any>("select payload from app_core.sites where id=$1", [
          site.id,
        ])
      ).rows[0].payload.deletedAt != null,
      true,
    );
    // Trial writes must never create a durable company or alter real business rows.
    context.registerTrial({ ...context.settings(), id: "trial_test" }, false);
    identities.resolve = () => ({
      ...SAMPLE_IDENTITY,
      trial: true,
      companyId: "trial_test",
      memberships: [
        {
          companyId: "trial_test",
          userId: SAMPLE_IDENTITY.userId,
          role: "admin",
        },
      ],
    });
    await request(http)
      .post("/api/sites")
      .send({ ...siteInput, clientId: null })
      .expect(201);
    assert.equal(
      (
        await db.query(
          "select 1 from app_core.companies where company_id like $1",
          ["trial_%"],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select 1 from app_core.sites")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into app_core.companies(company_id) values('trial_bad')",
      ),
      /check constraint/,
    );
    // PostgreSQL failure cannot silently fall back to the pre-existing memory samples.
    (app.get(CorePersistence) as any).pool.connect = async () => {
      throw Error("offline");
    };
    identities.resolve = () => SAMPLE_IDENTITY;
    await request(http).get("/api/sites").expect(500);
  } finally {
    await app.close();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RLS: approved membership only, cross-company denial, worker financial denial and history protection", async () => {
  const db = new PGlite();
  try {
    await schema(db);
    await db.exec(`insert into app_core.sites(company_id,id,payload) values('jongro','s','{"contractAmount":999}'),('other','s','{}');
      insert into app_core.workers(company_id,id,payload) values('jongro','w','{}');
      insert into app_core.worker_availability(company_id,worker_id,payload) values('jongro','w','[]');`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from app_core.sites")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "update app_core.sites set payload='{}' where company_id='other' returning id",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(
        "insert into app_core.sites(company_id,id,payload) values('other','x','{}')",
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.exec("delete from app_core.sites"),
      /permission denied/,
    );
    await db.exec("reset role");
    const wid = "10000000-0000-4000-8000-000000000002";
    await db.exec(`insert into auth.users(id,email) values('${wid}','worker@example.test');
      update public.app_memberships set company_id='jongro',role='worker',worker_id='w',active=true,approval_status='approved' where user_id='${wid}';`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      wid,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from app_core.sites")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from app_core.companies")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from app_core.worker_availability")).rows
        .length,
      1,
    );
    await assert.rejects(
      db.exec(
        "insert into app_core.workers(company_id,id,payload) values('jongro','bad','{}')",
      ),
      /row-level security/,
    );
    await db.exec("reset role");
    await db.exec(
      `update public.app_memberships set locked=true where user_id='${wid}'`,
    );
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select * from app_core.worker_availability")).rows
        .length,
      0,
    );
    await db.exec("reset role");
    await assert.rejects(
      postgresCoreTransaction(
        db,
        "trial_bad",
        () => ({}) as any,
        async () => {},
      ),
      /체험/,
    );
    await assert.rejects(
      postgresCoreTransaction(
        db,
        "jongro",
        () => ({}) as any,
        async () => {},
        {
          ...SAMPLE_IDENTITY,
          authenticated: true,
          userId: wid,
          appRole: "worker",
          workerId: "w",
          accessibleSiteIds: [],
          permissions: [],
        },
      ),
      /권한/,
    );
  } finally {
    await db.close();
  }
});

test("Supabase session + PostgreSQL: login, admin approval UI and durable worker linkage", async () => {
  const db = new PGlite();
  await schema(db);
  const f = await fixture();
  try {
    attach(f.a, db);
    const adminAgent = request.agent(f.a.getHttpServer()),
      member = request.agent(f.a.getHttpServer());
    await adminAgent
      .post("/api/auth/login")
      .send({ login: "admin@example.test", password: "Fixture123!" })
      .expect(201);
    await adminAgent.get("/api/auth/me").expect(200);
    const aid = "10000000-0000-4000-8000-000000000002";
    Object.assign(f.rows.get(aid), {
      company_id: "jongro",
      role: "admin",
      approval_status: "approved",
      active: true,
    });
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      aid,
      "admin@example.test",
    ]);
    await db.query(
      "update public.app_memberships set company_id='jongro',role='admin',approval_status='approved',active=true where user_id=$1",
      [aid],
    );
    assert.equal(
      (await adminAgent.get("/api/auth/me").expect(200)).body.user.role,
      "admin",
    );
    const worker = (
      await adminAgent
        .post("/api/workers")
        .send({
          name: "영구연결",
          displayName: "영구연결",
          phone: "",
          role: "기사",
          memo: "",
          defaultAvailability: "근무가능",
        })
        .expect(201)
    ).body;
    await member
      .post("/api/auth/login")
      .send({ login: "member@example.test", password: "Fixture123!" })
      .expect(201);
    assert.equal(
      (await member.get("/api/auth/me").expect(200)).body.access,
      "pending",
    );
    const assignment = {
      companyId: "jongro",
      role: "worker",
      workerId: worker.id,
      active: true,
      locked: false,
      approvalStatus: "승인",
      siteIds: [],
      permissions: [],
      displayName: "영구연결",
    };
    await adminAgent
      .put("/api/users/" + admin)
      .send(assignment)
      .expect(200);
    // The mock Auth REST server and local PostgreSQL are separate fixtures; mirror its approval.
    await db.query(
      "update public.app_memberships set role='worker',worker_id=$2 where user_id=$1",
      [admin, worker.id],
    );
    const me = (await member.get("/api/auth/me").expect(200)).body;
    assert.equal(me.user.workerId, worker.id);
    await member.get("/api/operational/availability").expect(200);
    await member.get("/api/users").expect(403);
    await member.post("/api/sites").send({}).expect(403);
    await adminAgent.get("/api/users").expect(200);
  } finally {
    await f.close();
    await db.close();
  }
});
