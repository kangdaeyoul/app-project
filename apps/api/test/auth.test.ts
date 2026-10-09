import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { seoulToday } from "../src/date";
async function fixture() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  const login = async (name: string, remember = false) => {
    const agent = request.agent(http);
    const res = await agent
      .post("/api/auth/login")
      .send({ login: name, password: "Jongno2026!", remember })
      .expect(201);
    assert.match(res.headers["set-cookie"][0], /HttpOnly/);
    assert.match(res.headers["set-cookie"][0], /SameSite=Lax/);
    return agent;
  };
  return { app, http, login };
}
test("세션 인증: 익명/위조 신원/비활성 차단, 유지 쿠키, 로그아웃", async () => {
  const { app, http, login } = await fixture();
  try {
    await request(http).get("/api/sites").expect(401);
    await request(http)
      .get("/api/sites")
      .set("x-user-id", "sample-admin")
      .expect(401);
    await request(http).get("/api/auth/config").expect(200);
    await request(http)
      .post("/api/auth/login")
      .send({ login: "inactive@jongno.test", password: "Jongno2026!" })
      .expect(401);
    await request(http)
      .post("/api/auth/login")
      .send({ login: "worker1@jongno.test", password: "wrong" })
      .expect(401);
    const a = await login("admin@jongno.test", true);
    assert.equal(
      (await a.get("/api/auth/me").expect(200)).body.user.role,
      "admin",
    );
    assert.equal((await a.get("/api/sites").expect(200)).body.length, 5);
    await a.post("/api/auth/logout").expect(201);
    await a.get("/api/sites").expect(401);
    await request(http)
      .post("/api/auth/login")
      .set("Origin", "https://outside.test")
      .send({ login: "admin@jongno.test", password: "Jongno2026!" })
      .expect(403);
  } finally {
    await app.close();
  }
});
test("사내직원: 허용 현장과 견적 작성, 원가/손익/지급 비노출 및 기존 견적 원가 보존", async () => {
  const { app, login } = await fixture();
  try {
    const admin = await login("admin@jongno.test"),
      staff = await login("staff@jongno.test");
    const sites = (await staff.get("/api/sites").expect(200)).body;
    assert.deepEqual(sites.map((s: any) => s.id).sort(), ["S001", "S003"]);
    for (const s of sites) {
      assert.equal(s.contractAmount, undefined);
      assert.equal(s.collectedAmount, undefined);
      assert.equal(s.unpaidWorkerAmount, undefined);
    }
    await staff.get("/api/sites/S004").expect(403);
    await staff.get("/api/dashboard").expect(403);
    await staff.get("/api/expenses").expect(403);
    await staff.get("/api/users").expect(403);
    const original = (await admin.get("/api/quotes").expect(200)).body.find(
      (q: any) => q.siteId === "S001",
    );
    assert.ok(original);
    const q = (await staff.get("/api/quotes/" + original.id).expect(200)).body;
    assert.equal(q.internal, undefined);
    assert.equal(q.internalGeneralCost, undefined);
    assert.equal(q.sections[0].items[0].materialUnitCost, undefined);
    q.sections[0].items[0].saleUnitPrice += 100;
    q.sections[0].items[0].materialUnitCost = 999999;
    q.status = "작성중";
    await staff
      .put("/api/quotes/" + q.id)
      .send(q)
      .expect(200);
    const saved = (await admin.get("/api/quotes/" + q.id).expect(200)).body;
    assert.equal(
      saved.sections[0].items[0].materialUnitCost,
      original.sections[0].items[0].materialUnitCost,
    );
    assert.equal(
      saved.sections[0].items[0].saleUnitPrice,
      original.sections[0].items[0].saleUnitPrice + 100,
    );
    await staff.post("/api/quotes").send({...q,siteId:"S001",sections:[null]}).expect(400);
    await staff.post("/api/quotes").send({...q,siteId:"S001",sections:[{kind:"전기",items:[null]}]}).expect(400);
    q.siteId = "S004";
    await staff
      .put("/api/quotes/" + q.id)
      .send(q)
      .expect(403);
    await staff
      .post("/api/quotes/" + q.id + "/convert")
      .send({})
      .expect(403);
  } finally {
    await app.close();
  }
});
test("작업진행자 2명: 본인 현장/일정/작업/정산만 허용, 타인 및 회사 손익 차단", async () => {
  const { app, login } = await fixture();
  try {
    const a = await login("worker1@jongno.test"),
      b = await login("worker2@jongno.test");
    const sites = (await a.get("/api/sites").expect(200)).body;
    assert.ok(sites.some((s: any) => s.id === "S001"));
    assert.ok(!sites.some((s: any) => s.id === "S003"));
    assert.equal(sites[0].contractAmount, undefined);
    await a.get("/api/sites/S003").expect(403);
    const works = (await a.get("/api/daily-work").expect(200)).body;
    assert.ok(
      works.every(
        (w: any) =>
          w.managerId === "W001" ||
          w.participants.some((p: any) => p.workerId === "W001"),
      ),
    );
    await a.get("/api/daily-work/D002").expect(403);
    await a.get("/api/worker-schedule?workerId=W004").expect(403);
    const today = seoulToday();
    const s = (
      await a
        .get("/api/worker-schedule?from=" + today + "&to=" + today)
        .expect(200)
    ).body;
    assert.ok(s.events.length > 0);
    assert.ok(s.events.every((e: any) => e.workerIds.includes("W001")));
    const settlements = (
      await a.get("/api/operational/settlements").expect(200)
    ).body;
    assert.ok(settlements.rows.every((r: any) => r.workerId === "W001"));
    await a.get("/api/operational/settlements?workerId=W004").expect(403);
    await a.get("/api/sites/S001/finance").expect(403);
    await a.get("/api/quotes").expect(403);
    await a.get("/api/workers/W004").expect(403);
    await a
      .put("/api/operational/daily-work/D002")
      .send({ content: "공격", status: "작업예정" })
      .expect(403);
    assert.ok(
      (await b.get("/api/sites").expect(200)).body.some(
        (s: any) => s.id === "S003",
      ),
    );
  } finally {
    await app.close();
  }
});
test("회사 격리: 다른 회사 세션/본문/헤더와 파일·현장·사용자 접근", async () => {
  const { app, login } = await fixture();
  try {
    const other = await login("admin@demo.test");
    const company = (await other.get("/api/auth/me").expect(200)).body.company;
    assert.equal(company.business.registrationNumber, "");
    assert.equal(company.email, "");
    assert.deepEqual((await other.get("/api/sites").expect(200)).body, []);
    await other.get("/api/sites/S001").expect(404);
    await other.get("/api/photos/P001/file").expect(404);
    assert.ok(
      (await other.get("/api/users").expect(200)).body.every(
        (u: any) => u.companyId === "demo-company",
      ),
    );
    await other.get("/api/sites").set("x-company-id", "jongno").expect(403);
    await other.post("/api/sites").send({ companyId: "jongno" }).expect(403);
    await other
      .put("/api/users/sample-admin")
      .send({ companyId: "demo-company" })
      .expect(403);
  } finally {
    await app.close();
  }
});
test("사용자 관리: 등록/수정/역할 변경 즉시 적용, 비활성 세션 차단, 마지막 관리자 보호", async () => {
  const { app, login } = await fixture();
  try {
    const admin = await login("admin@jongno.test"),
      staff = await login("staff@jongno.test");
    const users = (await admin.get("/api/users").expect(200)).body;
    assert.ok(
      users.every((u: any) => !("passwordHash" in u) && !("password" in u)),
    );
    const original = users.find((u: any) => u.id === "sample-staff");
    const changed = {
      ...original,
      role: "worker",
      workerId: "W004",
      permissions: [],
      name: "최기계",
      displayName: "최기계 기사",
    };
    await admin.put("/api/users/sample-staff").send(changed).expect(200);
    assert.equal(
      (await staff.get("/api/auth/me").expect(200)).body.user.role,
      "worker",
    );
    await staff.get("/api/quotes").expect(403);
    await admin
      .put("/api/users/sample-staff")
      .send({ ...changed, active: false })
      .expect(200);
    await staff.get("/api/sites").expect(401);
    await admin
      .put("/api/users/sample-admin")
      .send({
        ...users.find((u: any) => u.id === "sample-admin"),
        active: false,
      })
      .expect(400);
    const newUser = (
      await admin
        .post("/api/users")
        .send({
          ...original,
          id: undefined,
          loginId: "new@jongno.test",
          email: "new@jongno.test",
          name: "실제 이름",
          displayName: "표시 이름",
          password: "Jongno2026!",
        })
        .expect(201)
    ).body;
    assert.notEqual(newUser.name, newUser.displayName);
    const audits = (await admin.get("/api/audit-logs").expect(200)).body;
    assert.ok(JSON.stringify(audits).includes("사용자"));
    assert.ok(!JSON.stringify(audits).includes("passwordHash"));
  } finally {
    await app.close();
  }
});

test("직원 추가권한: 현장 재무/지급액은 허용 현장에만, 권한 회수 즉시 차단", async () => {
  const { app, login } = await fixture();
  try {
    const admin = await login("admin@jongno.test"),
      staff = await login("staff@jongno.test");
    await staff.get("/api/operational/site-finance/S001").expect(403);
    const u = (await admin.get("/api/users").expect(200)).body.find(
      (u: any) => u.id === "sample-staff",
    );
    await admin
      .put("/api/users/" + u.id)
      .send({
        ...u,
        permissions: [
          "writeQuotes",
          "siteFinance",
          "internalCosts",
          "workerPayments",
          "editSchedule",
        ],
      })
      .expect(200);
    const f = (
      await staff.get("/api/operational/site-finance/S001").expect(200)
    ).body;
    assert.equal(
      f.contractAmount,
      (await admin.get("/api/sites/S001/finance").expect(200)).body
        .contractAmount,
    );
    assert.equal(typeof f.siteProfit, "number");
    assert.equal(typeof f.totalExpenses, "number");
    await staff.get("/api/operational/site-finance/S004").expect(403);
    assert.ok(
      (
        await staff.get("/api/operational/site-settlements/S001").expect(200)
      ).body.rows.every((r: any) => r.siteId === "S001"),
    );
    await admin
      .put("/api/users/" + u.id)
      .send(u)
      .expect(200);
    await staff.get("/api/operational/site-finance/S001").expect(403);
  } finally {
    await app.close();
  }
});
test("작업진행자 실제 업무: 본인 시작/종료·수동시간·사용자재 저장, 배정 위조·관리자승인 차단", async () => {
  const { app, login } = await fixture();
  try {
    const worker = await login("worker2@jongno.test"),
      admin = await login("admin@jongno.test");
    const started = (
      await worker.post("/api/operational/daily-work/D002/start").expect(201)
    ).body;
    assert.equal(started.status, "작업중");
    assert.match(started.startTime, /^\d{2}:\d{2}$/);
    await worker.post("/api/operational/daily-work/D002/finish").expect(201);
    const saved = (
      await worker
        .put("/api/operational/daily-work/D002")
        .send({
          status: "작업완료",
          startTime: "09:00",
          endTime: "12:30",
          content: "본인 작업 입력",
          notes: "완료 확인 요청",
          siteId: "S001",
          managerId: "W001",
          materials: [
            {
              name: "감지기",
              specification: "연기식",
              unit: "개",
              quantity: 2,
              notes: "",
            },
          ],
        })
        .expect(200)
    ).body;
    assert.equal(saved.siteId, "S003");
    assert.equal(saved.managerId, "W004");
    assert.equal(saved.totalMinutes, 210);
    assert.equal(saved.materialCount, 1);
    const stored = (await admin.get("/api/daily-work/D002").expect(200)).body;
    assert.equal(stored.content, "본인 작업 입력");
    assert.equal(stored.materials[0].quantity, 2);
    await worker
      .put("/api/operational/daily-work/D002")
      .send({ ...saved, status: "관리자확인완료" })
      .expect(403);
  } finally {
    await app.close();
  }
});
