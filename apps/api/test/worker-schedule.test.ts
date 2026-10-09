import { createTestApp } from "./test-app";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { WorkerScheduleService } from "../src/worker-schedule";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { DEFAULT_COMPANY } from "@jongno/shared";
import {
  WORKERS_REPOSITORY,
  WorkersRepository,
} from "../src/workers.repository";
import { seoulToday } from "../src/date";
const date = seoulToday();
const input = {
  siteId: "S002",
  date,
  managerId: "W004",
  participantIds: [],
  start: "12:00",
  end: "13:00",
};
test("스케줄: 기존 데이터 투영, 다중 현장, 휴무·중복 검증, 관리자 강제 저장, 사진·실제시간 보존", async () => {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const before = (
      await request(http)
        .get(`/api/worker-schedule?from=${date}&to=${date}`)
        .expect(200)
    ).body;
    assert.ok(before.workers.length >= 5);
    assert.equal((await request(http).get("/api/workers/W004").expect(200)).body.todaySiteCount,2);
    assert.equal(
      new Set(before.workers.map((w: any) => w.color)).size,
      before.workers.length,
    );
    assert.equal(
      before.events.filter((e: any) => e.workerIds.includes("W004")).length,
      2,
    );
    assert.equal(
      before.events.find((e: any) => e.dailyWorkId === "D001").workerIds.length,
      3,
    );
    const original = (
      await request(http).get("/api/daily-work/D001").expect(200)
    ).body;
    await request(http)
      .post("/api/worker-schedule/assign")
      .send({ ...input, start: "10:00", end: "11:00" })
      .expect(409);
    for (const [worker, start, end] of [
      ["W006", "12:00", "13:00"],
      ["W003", "09:00", "10:00"],
      ["W005", "15:00", "16:00"],
    ])
      await request(http)
        .post("/api/worker-schedule/assign")
        .send({ ...input, managerId: worker, start, end })
        .expect(409);
    const saved = (
      await request(http)
        .post("/api/worker-schedule/assign")
        .send(input)
        .expect(201)
    ).body.work;
    assert.equal(saved.plannedStartTime, "12:00");
    assert.equal(saved.startTime, "");
    await request(http)
      .post("/api/worker-schedule/assign")
      .send({
        ...input,
        dailyWorkId: saved.id,
        start: "10:00",
        end: "11:00",
        force: true,
      })
      .expect(201);
    const after = (await request(http).get("/api/daily-work/D001").expect(200))
      .body;
    assert.deepEqual(after, original);
    const edited = (
      await request(http)
        .post("/api/worker-schedule/assign")
        .send({
          ...input,
          siteId: "S001",
          dailyWorkId: "D001",
          managerId: "W001",
          participantIds: ["W002", "W003"],
          start: "08:00",
          end: "18:00",
          force: true,
        })
        .expect(201)
    ).body.work;
    for (const key of [
      "startTime",
      "endTime",
      "status",
      "materials",
      "participants",
      "beforePhotoCount",
      "afterPhotoCount",
    ])
      assert.deepEqual(edited[key], original[key]);
    const legacy = (
      await request(http)
        .put("/api/daily-work/D001")
        .send({ ...original, participantIds: ["W002", "W003"] })
        .expect(200)
    ).body;
    assert.equal(legacy.plannedStartTime, "08:00");
    assert.equal(legacy.plannedEndTime, "18:00");

    const color = "#846045";
    await request(http)
      .put("/api/worker-schedule/workers/W004/color")
      .send({ color })
      .expect(200);
    await request(http).delete("/api/workers/W004").expect(200);
    const final = (
      await request(http)
        .get(`/api/worker-schedule?from=${date}&to=${date}`)
        .expect(200)
    ).body;
    assert.equal(final.workers.find((w: any) => w.id === "W004").color, color);
    assert.equal(
      final.workers.find((w: any) => w.id === "W004").inactive,
      true,
    );
    await request(http).get("/api/worker-schedule?from=2026-02-30").expect(400);
  } finally {
    await app.close();
  }
});
test("스케줄 회사 격리, 본인 일정만 조회, 직원 현장 범위와 수정/강제 권한", async () => {
  const app = await createTestApp(AppModule, { logger: false });
  await app.init();
  const service = app.get(WorkerScheduleService),
    context = app.get(CompanyContext);
  try {
    const own = {
      ...SAMPLE_IDENTITY,
      workerId: "W004",
      memberships: [
        {
          companyId: DEFAULT_COMPANY.id,
          userId: SAMPLE_IDENTITY.userId,
          role: "viewer" as const,
        },
      ],
    };
    context.run(own, () => {
      const result = service.list(date, date);
      assert.equal(result.workers.length, 1);
      assert.ok(result.events.every((e) => e.workerIds.includes("W004")));
      assert.equal(result.canEdit, false);
      assert.throws(() => service.assign(input));
      assert.throws(() => service.color("W004", { color: "#123456" }));
    });
    const staff = {
      ...SAMPLE_IDENTITY,
      accessibleSiteIds: ["S002"],
      memberships: [
        {
          companyId: DEFAULT_COMPANY.id,
          userId: SAMPLE_IDENTITY.userId,
          role: "member" as const,
        },
      ],
    };
    context.run(staff, () => {
      assert.ok(
        service.list(date, date).events.every((e) => e.siteId === "S002"),
      );
      assert.throws(() => service.assign(input));
    });
    context.run({ ...staff, canEditSchedule: true }, () => {
      assert.equal(service.list(date,date).canEdit,true);assert.ok(service.list(date,date).workers.some(w=>w.id==="W004"));
      assert.throws(() => service.assign({ ...input, force: true }));
      assert.throws(() => service.assign({ ...input, siteId: "S001" }));
    });
    context.run({ ...own, workerId: undefined, canEditSchedule: true }, () => {
      assert.equal(service.list(date, date).canEdit, false);
      assert.throws(() => service.assign(input));
    });
    const other = {
      ...DEFAULT_COMPANY,
      id: "schedule-other",
      displayName: "다른 회사",
    };
    context.register(other);
    context.run(
      {
        companyId: other.id,
        userId: "other-admin",
        memberships: [
          { companyId: other.id, userId: "other-admin", role: "admin" },
        ],
      },
      () => {
        assert.equal(service.list(date, date).events.length, 0);
        assert.equal(service.list(date, date).workers.length, 0);
        assert.throws(() => service.assign(input));
      },
    );
    const repo = app.get<WorkersRepository>(WORKERS_REPOSITORY),
      w = repo.create({
        name: "새 작업자",
        displayName: "새 작업자 기사",
        phone: "",
        role: "기사",
        memo: "",
        defaultAvailability: "근무가능",
      });
    assert.ok(w.color);
    for (let i = 0; i < 8; i++)
      repo.create({
        name: `추가 ${i}`,
        displayName: `추가 ${i}`,
        phone: "",
        role: "기사",
        memo: "",
        defaultAvailability: "근무가능",
      });
    assert.equal(
      new Set(repo.list().map((w) => w.color)).size,
      repo.list().length,
    );

    assert.ok(
      !repo
        .list()
        .filter((x) => x.id !== w.id)
        .some((x) => x.color === w.color),
    );
  } finally {
    await app.close();
  }
});
