import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { seoulToday } from "../src/date";

async function setup() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
const input = {
  name: "김철수",
  displayName: "김철수 소장",
  phone: "010-1234-5678",
  role: "현장소장",
  memo: "샘플 메모",
  defaultAvailability: "근무가능",
};

test("작업진행자의 이름/표시명/역할을 분리하고 등록·수정·조회한다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const created = (
      await request(http)
        .post("/api/workers")
        .send({ ...input, systemRole: "admin" })
        .expect(201)
    ).body;
    assert.equal(created.name, "김철수");
    assert.equal(created.displayName, "김철수 소장");
    assert.equal(created.role, "현장소장");
    assert.equal(created.systemRole, undefined);
    const detail = (
      await request(http).get(`/api/workers/${created.id}`).expect(200)
    ).body;
    assert.equal(detail.todaySiteCount, 0);
    assert.equal(detail.monthlyWorkDays, 0);
    assert.equal(detail.monthlyPayable, 0);
    assert.equal(detail.unpaidAmount, 0);
    await request(http)
      .put(`/api/workers/${created.id}`)
      .send({
        ...input,
        displayName: "김철수 팀장",
        defaultAvailability: "오후불가",
      })
      .expect(200);
    const changed = (
      await request(http).get(`/api/workers/${created.id}`).expect(200)
    ).body;
    assert.equal(changed.name, "김철수");
    assert.equal(changed.displayName, "김철수 팀장");
    assert.equal(changed.availability, "오후불가");
  } finally {
    await app.close();
  }
});

test("날짜별 근무 상태를 갱신하고 기본 상태와 오늘 상태를 구분한다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const date = seoulToday();
    for (const status of ["휴무", "오전불가", "오후불가", "근무가능"]) {
      await request(http)
        .put(`/api/workers/W001/availability/${date}`)
        .send({ status })
        .expect(200);
      const detail = (await request(http).get("/api/workers/W001").expect(200))
        .body;
      assert.equal(detail.availability, status);
      assert.equal(detail.availabilityDates.length, 1);
      assert.equal(detail.defaultAvailability, "근무가능");
    }
    await request(http)
      .put("/api/workers/W001/availability/2035-10-01")
      .send({ status: "휴무" })
      .expect(200);
    assert.equal(
      (await request(http).get("/api/workers/W001").expect(200)).body
        .availability,
      "근무가능",
    );
  } finally {
    await app.close();
  }
});

test("현장 ID 배정과 삭제 후 기존 현장/작업기록 보존 및 새 배정 거부", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const date = seoulToday();
    const worker = (
      await request(http).post("/api/workers").send(input).expect(201)
    ).body;
    const siteInput = {
      name: "ID 연결 현장",
      startDate: date,
      status: "진행중",
      contractAmount: 10000,
      managerId: worker.id,
      manager: "위조 표시명",
    };
    const site = (
      await request(http).post("/api/sites").send(siteInput).expect(201)
    ).body;
    assert.equal(site.manager, "김철수 소장");
    assert.equal(site.managerId, worker.id);
    assert.equal(
      (await request(http).get(`/api/workers/${worker.id}`).expect(200)).body
        .todaySiteCount,
      1,
    );
    await request(http)
      .put(`/api/workers/${worker.id}`)
      .send({ ...input, displayName: "변경 표시명" })
      .expect(200);
    assert.equal(
      (await request(http).get(`/api/sites/${site.id}`).expect(200)).body
        .manager,
      "김철수 소장",
    );
    await request(http).delete(`/api/workers/${worker.id}`).expect(200);
    assert.ok(
      !(await request(http).get("/api/workers").expect(200)).body.some(
        (w: { id: string }) => w.id === worker.id,
      ),
    );
    assert.ok(
      (
        await request(http).get("/api/workers?includeDeleted=true").expect(200)
      ).body.some((w: { id: string }) => w.id === worker.id),
    );
    assert.equal(
      (await request(http).get(`/api/workers/${worker.id}`).expect(200)).body
        .sites.length,
      1,
    );
    await request(http)
      .put(`/api/sites/${site.id}`)
      .send({ ...site, name: "삭제 후 현장 수정" })
      .expect(200);
    assert.equal(
      (await request(http).get(`/api/sites/${site.id}`).expect(200)).body
        .manager,
      "김철수 소장",
    );
    await request(http).post("/api/sites").send(siteInput).expect(400);
    await request(http)
      .put(`/api/workers/${worker.id}`)
      .send(input)
      .expect(409);
    await request(http)
      .put(`/api/workers/${worker.id}/availability/${date}`)
      .send({ status: "휴무" })
      .expect(409);
    const before = (await request(http).get("/api/workers/W001").expect(200))
      .body;
    await request(http).delete("/api/workers/W001").expect(200);
    const after = (await request(http).get("/api/workers/W001").expect(200))
      .body;
    assert.deepEqual(after.work, before.work);
    assert.equal(after.unpaidAmount, before.unpaidAmount);
    assert.equal(
      (await request(http).get("/api/sites/S001").expect(200)).body.managerId,
      "W001",
    );
  } finally {
    await app.close();
  }
});

test("정산은 샘플 원장으로 집계하고 잘못된 입력은 거부한다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const rows = (await request(http).get("/api/workers").expect(200)).body;
    const w = rows.find((w: { id: string }) => w.id === "W001");
    assert.equal(w.todaySiteCount, 1);
    assert.equal(w.monthlyWorkDays, 1);
    assert.equal(w.monthlyPayable, 537000);
    assert.equal(w.unpaidAmount, 537000);
    assert.equal(
      rows.find((w: { id: string }) => w.id === "W002").unpaidAmount,
      0,
    );
    assert.equal(
      (await request(http).get("/api/workers?month=2000-01").expect(200))
        .body[0].monthlyPayable,
      0,
    );
    for (const fields of [
      { name: "" },
      { displayName: " " },
      { defaultAvailability: "unknown" },
      { phone: 123 },
      { memo: "x".repeat(5001) },
    ])
      await request(http)
        .post("/api/workers")
        .send({ ...input, ...fields })
        .expect(400);
    await request(http).get("/api/workers?month=invalid").expect(400);
    await request(http).get("/api/workers/missing").expect(404);
    await request(http).delete("/api/workers/missing").expect(404);
    await request(http)
      .put("/api/workers/W001/availability/2026-02-30")
      .send({ status: "휴무" })
      .expect(400);
    await request(http)
      .put("/api/workers/W001/availability/2026-10-06")
      .send({ status: "invalid" })
      .expect(400);
    await request(http)
      .post("/api/sites")
      .send({
        name: "없는 담당자",
        startDate: seoulToday(),
        status: "미배정",
        contractAmount: 0,
        managerId: "missing",
      })
      .expect(400);
  } finally {
    await app.close();
  }
});
