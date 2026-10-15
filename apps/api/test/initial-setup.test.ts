import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CompanyContext } from "../src/company-context";
import { InitialSetupController } from "../src/initial-setup";
import { DEFAULT_COMPANY } from "@jongro/shared";
test("초기설정: 실제 회사 자료와 선택 확인으로 진행률 계산, 관리자/회사 범위 제한", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    const http = app.getHttpServer(),
      admin = request.agent(http),
      worker = request.agent(http),
      other = request.agent(http);
    await admin
      .post("/api/auth/login")
      .send({ login: "admin@jongro.test", password: "Jongro2026!" })
      .expect(201);
    await worker
      .post("/api/auth/login")
      .send({ login: "worker1@jongro.test", password: "Jongro2026!" })
      .expect(201);
    await other
      .post("/api/auth/login")
      .send({ login: "admin@demo.test", password: "Jongro2026!" })
      .expect(201);
    await request(http).get("/api/initial-setup").expect(401);
    await worker.get("/api/initial-setup").expect(403);
    await worker.put("/api/initial-setup").send({ users: true }).expect(403);
    const before = (await admin.get("/api/initial-setup").expect(200)).body;
    await admin.put("/api/initial-setup").send({ company: true }).expect(400);
    await admin.put("/api/initial-setup").send({ users: "true" }).expect(400);
    const confirmed = (
      await admin
        .put("/api/initial-setup")
        .send({
          users: true,
          quote: true,
          assetsOptional: true,
          introSeen: true,
        })
        .expect(200)
    ).body;
    assert.equal(confirmed.checks.users, true);
    assert.equal(confirmed.checks.quote, true);
    assert.equal(confirmed.checks.assets, true);
    assert(confirmed.completed >= before.completed);
    assert.equal(
      (await other.get("/api/initial-setup").expect(200)).body.checks.users,
      false,
    );
    const context = app.get(CompanyContext),
      company = {
        ...structuredClone(DEFAULT_COMPANY),
        id: "fresh-setup",
        name: "",
        displayName: "",
        address: "",
        phone: "",
        email: "",
        quoteProfile: undefined,
      };
    context.register(company);
    const initial = context.run(
      {
        authenticated: true,
        appRole: "admin",
        companyId: company.id,
        userId: "fresh-admin",
        memberships: [
          { companyId: company.id, userId: "fresh-admin", role: "admin" },
        ],
      },
      () => app.get(InitialSetupController).status(),
    );
    assert.equal(initial.completed, 0);
    assert.equal(initial.total, 8);
    assert(Object.values(initial.checks).every((v) => v === false));
  } finally {
    await app.close();
  }
});
test("체험판: 서버 표시, 예시 회사정보 수정·복원·삭제는 실제 회사와 견적을 보존", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    const a = request.agent(app.getHttpServer());
    await a.post("/api/auth/demo").send({ account: "admin" }).expect(201);
    const session = (await a.get("/api/auth/me").expect(200)).body;
    assert.equal(session.user.isDemo, true);
    const company = (await a.get("/api/company/current").expect(200)).body,
      quotes = (await a.get("/api/quotes").expect(200)).body;
    const bundle = (await a.post("/api/tutorial/samples").expect(201)).body,
      record = bundle.records.find((r: any) => r.kind === "company");
    assert(record);
    await a
      .put("/api/tutorial/samples/" + encodeURIComponent(record.id))
      .send({ fields: { 회사명: "[예시] 수정 회사" } })
      .expect(200);
    const reset = (
      await a
        .post(
          "/api/tutorial/samples/" + encodeURIComponent(record.id) + "/reset",
        )
        .expect(201)
    ).body;
    assert.equal(reset.fields.회사명, record.fields.회사명);
    await a.delete("/api/tutorial/samples").expect(200);
    assert.deepEqual((await a.get("/api/company/current")).body, company);
    assert.deepEqual((await a.get("/api/quotes")).body, quotes);
    assert.equal(
      (await a.post("/api/tutorial/samples").expect(201)).body.records.length,
      bundle.records.length,
    );
  } finally {
    await app.close();
  }
});
