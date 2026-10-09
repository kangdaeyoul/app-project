import { createTestApp } from "./test-app";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { seoulToday } from "../src/date";
async function setup() {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
const input = {
  workDate: "2026-09-25",
  siteId: "S001",
  managerId: "W001",
  participantIds: ["W002", "W003"],
  startTime: "08:30",
  endTime: "17:20",
  content: "3층 스프링클러 배관 및 자탐 작업",
  notes: "샘플",
  status: "작업완료",
};
test("등록/수정/시간계산/관계 필터와 동일 현장 여러 날짜 기록", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const created = (
      await request(http)
        .post("/api/daily-work")
        .send({ ...input, materialCount: 99, totalMinutes: 1 })
        .expect(201)
    ).body;
    assert.equal(created.totalMinutes, 530);
    assert.equal(created.siteName, "종로 오피스 소방시설 개선");
    assert.equal(created.managerDisplayName, "김현장 소장");
    assert.equal(created.participants.length, 2);
    assert.equal(created.materialCount, 0);
    assert.equal(created.beforePhotoCount, 0);
    assert.equal(created.afterPhotoCount, 0);
    const another = (
      await request(http)
        .post("/api/daily-work")
        .send({ ...input, workDate: "2026-09-26" })
        .expect(201)
    ).body;
    assert.notEqual(another.id, created.id);
    const update = (
      await request(http)
        .put(`/api/daily-work/${created.id}`)
        .send({
          ...input,
          endTime: "16:00",
          participantIds: ["W002"],
          status: "관리자확인완료",
        })
        .expect(200)
    ).body;
    assert.equal(update.totalMinutes, 450);
    assert.equal(update.participants.length, 1);
    const siteRows = (
      await request(http).get("/api/daily-work?siteId=S001").expect(200)
    ).body;
    assert.ok(siteRows.some((r: { id: string }) => r.id === created.id));
    assert.ok(siteRows.every((r: { siteId: string }) => r.siteId === "S001"));
    assert.equal(
      (await request(http).get("/api/daily-work?siteId=S002").expect(200)).body
        .length,
      0,
    );
    for (const id of ["W001", "W002"])
      assert.ok(
        (
          await request(http).get(`/api/daily-work?workerId=${id}`).expect(200)
        ).body.some((r: { id: string }) => r.id === created.id),
      );
    assert.ok(
      !(
        await request(http).get("/api/daily-work?workerId=W003").expect(200)
      ).body.some((r: { id: string }) => r.id === created.id),
    );
    assert.equal(
      (await request(http).get("/api/workers/W002?month=2026-09").expect(200))
        .body.monthlyWorkDays,
      2,
    );
    await request(http).delete("/api/workers/W002").expect(200);
    assert.equal(
      (await request(http).get(`/api/daily-work/${created.id}`).expect(200))
        .body.participants[0].displayName,
      "박진행 팀장",
    );
    await request(http)
      .put(`/api/daily-work/${created.id}`)
      .send({ ...input, participantIds: ["W002"] })
      .expect(200);
    await request(http).post("/api/daily-work").send(input).expect(400);
  } finally {
    await app.close();
  }
});
test("오늘 시각으로 시작과 종료하고 수동 시간을 수정한다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const created = (
      await request(http)
        .post("/api/daily-work")
        .send({
          ...input,
          workDate: seoulToday(),
          startTime: "",
          endTime: "",
          status: "작업예정",
        })
        .expect(201)
    ).body;
    const started = (
      await request(http)
        .post(`/api/daily-work/${created.id}/start`)
        .expect(201)
    ).body;
    assert.equal(started.status, "작업중");
    assert.match(started.startTime, /^\d{2}:\d{2}$/);
    await request(http).post(`/api/daily-work/${created.id}/start`).expect(409);
    const finished = (
      await request(http)
        .post(`/api/daily-work/${created.id}/finish`)
        .expect(201)
    ).body;
    assert.equal(finished.status, "작업완료");
    assert.ok(finished.totalMinutes >= 0);
    await request(http)
      .post(`/api/daily-work/${created.id}/finish`)
      .expect(409);
    const edited = (
      await request(http)
        .put(`/api/daily-work/${created.id}`)
        .send({ ...input, workDate: seoulToday() })
        .expect(200)
    ).body;
    assert.equal(edited.totalMinutes, 530);
    const old = (
      await request(http)
        .post("/api/daily-work")
        .send({
          ...input,
          workDate: "2000-01-01",
          startTime: "",
          endTime: "",
          status: "작업예정",
        })
        .expect(201)
    ).body;
    await request(http).post(`/api/daily-work/${old.id}/start`).expect(409);
  } finally {
    await app.close();
  }
});
test("잘못된 연결, 날짜, 시간, 중복 참여자와 상태는 저장되지 않는다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const original = (await request(http).get("/api/daily-work").expect(200)).body;
    for (const invalid of [
      { workDate: "2026-02-30" },
      { siteId: "missing" },
      { managerId: "missing" },
      { participantIds: ["missing"] },
      { participantIds: ["W002", "W002"] },
      { participantIds: "W002" },
      { startTime: "24:00" },
      { startTime: "18:00" },
      { startTime: "" },
      { endTime: "", status: "작업완료" },
      { endTime: "17:00", status: "작업중" },
      { status: "invalid" },
    ])
      await request(http)
        .post("/api/daily-work")
        .send({ ...input, ...invalid })
        .expect(400);
    await request(http).get("/api/daily-work/missing").expect(404);
    await request(http).put("/api/daily-work/missing").send(input).expect(404);
    assert.deepEqual((await request(http).get("/api/daily-work").expect(200)).body, original);
  } finally {
    await app.close();
  }
});
