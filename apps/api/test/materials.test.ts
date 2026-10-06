import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
async function setup() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
const work = {
  workDate: "2026-09-25",
  siteId: "S001",
  managerId: "W001",
  participantIds: [],
  startTime: "08:30",
  endTime: "17:20",
  content: "백관 사용",
  notes: "",
  status: "작업완료",
};
const pipe = {
  name: "백관",
  specification: "25A",
  quantity: 18,
  unit: "m",
  notes: "3층",
};
test("여러 사용자재 등록/수정/삭제, 실제 건수와 날짜별 현장 합계", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const first = (
      await request(http)
        .post("/api/daily-work")
        .send({
          ...work,
          materials: [pipe, { ...pipe, name: "엘보", quantity: 8, unit: "개" }],
          materialCount: 100,
        })
        .expect(201)
    ).body;
    assert.equal(first.materialCount, 2);
    assert.equal(first.materials.length, 2);
    assert.ok(first.materials[0].materialId);
    assert.equal(first.materials[0].dailyWorkId, first.id);
    const second = (
      await request(http)
        .post("/api/daily-work")
        .send({
          ...work,
          workDate: "2026-09-26",
          materials: [{ ...pipe, quantity: 12 }],
        })
        .expect(201)
    ).body;
    assert.equal(second.materials[0].materialId, first.materials[0].materialId);
    const aggregate = (
      await request(http).get("/api/daily-work/site-materials/S001").expect(200)
    ).body;
    assert.equal(
      aggregate.totals.find((m: { name: string }) => m.name === "백관")
        .quantity,
      30,
    );
    assert.ok(
      aggregate.usages.some(
        (u: { workDate: string }) => u.workDate === "2026-09-26",
      ),
    );
    assert.equal(
      (
        await request(http)
          .get("/api/daily-work/site-materials/S002")
          .expect(200)
      ).body.usages.length,
      0,
    );
    const changed = (
      await request(http)
        .put(`/api/daily-work/${first.id}`)
        .send({ ...work, materials: [{ ...first.materials[0], quantity: 20 }] })
        .expect(200)
    ).body;
    assert.equal(changed.materialCount, 1);
    assert.equal(changed.materials[0].id, first.materials[0].id);
    await request(http)
      .put(`/api/daily-work/${first.id}`)
      .send({ ...work, notes: "일일작업만 수정" })
      .expect(200);
    assert.equal(
      (await request(http).get(`/api/daily-work/${first.id}`).expect(200)).body
        .materialCount,
      1,
    );
    await request(http)
      .put(`/api/daily-work/${first.id}`)
      .send({ ...work, materials: [] })
      .expect(200);
    assert.equal(
      (await request(http).get(`/api/daily-work/${first.id}`).expect(200)).body
        .materialCount,
      0,
    );
    assert.equal(
      (
        await request(http)
          .get("/api/daily-work/site-materials/S001")
          .expect(200)
      ).body.totals[0].quantity,
      12,
    );
    await request(http)
      .put(`/api/daily-work/${second.id}`)
      .send({ ...work, siteId: "S002", workDate: "2026-09-26" })
      .expect(200);
    assert.equal(
      (
        await request(http)
          .get("/api/daily-work/site-materials/S001")
          .expect(200)
      ).body.usages.length,
      0,
    );
    assert.equal(
      (
        await request(http)
          .get("/api/daily-work/site-materials/S002")
          .expect(200)
      ).body.usages.length,
      1,
    );
  } finally {
    await app.close();
  }
});
test("단위/규격 분리와 소수 합산, 잘못된 자재 입력은 전체 저장 거부", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const created = (
      await request(http)
        .post("/api/daily-work")
        .send({
          ...work,
          materials: [
            { ...pipe, quantity: 0.1 },
            { ...pipe, quantity: 0.2 },
            { ...pipe, specification: "32A", quantity: 2 },
            { ...pipe, unit: "개", quantity: 3 },
          ],
        })
        .expect(201)
    ).body;
    const totals = (
      await request(http).get("/api/daily-work/site-materials/S001").expect(200)
    ).body.totals;
    assert.equal(totals.length, 3);
    assert.equal(
      totals.find(
        (t: { unit: string; specification: string }) =>
          t.unit === "m" && t.specification === "25A",
      ).quantity,
      0.3,
    );
    for (const invalid of [
      { name: "" },
      { unit: "" },
      { quantity: 0 },
      { quantity: -1 },
      { quantity: 0.0001 },
      { quantity: "3" },
      { id: "forged" },
      { notes: 42 },
    ])
      await request(http)
        .put(`/api/daily-work/${created.id}`)
        .send({ ...work, materials: [{ ...pipe, ...invalid }] })
        .expect(400);
    await request(http)
      .put(`/api/daily-work/${created.id}`)
      .send({
        ...work,
        materials: [created.materials[0], created.materials[0]],
      })
      .expect(400);
    await request(http)
      .post("/api/daily-work")
      .send({ ...work, materials: [created.materials[0]] })
      .expect(400);
    assert.equal(
      (await request(http).get(`/api/daily-work/${created.id}`).expect(200))
        .body.materialCount,
      4,
    );
    await request(http)
      .get("/api/daily-work/site-materials/missing")
      .expect(404);
  } finally {
    await app.close();
  }
});
