import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER, MemoryAuthProvider } from "../src/auth";
import { readFileSync } from "node:fs";

test("PWA 데모 로그인: 역할별 세션, API 권한 및 비활성 설정", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    const http = app.getHttpServer();
    for (const [account, role] of [
      ["admin", "admin"],
      ["staff", "staff"],
      ["worker1", "worker"],
      ["worker2", "worker"],
    ]) {
      const agent = request.agent(http);
      await agent.post("/api/auth/demo").send({ account }).expect(201);
      assert.equal(
        (await agent.get("/api/auth/me").expect(200)).body.user.role,
        role,
      );
      if (role === "worker") {
        await agent.get("/api/quotes").expect(403);
        await agent.get("/api/dashboard").expect(403);
      }
    }
    await request(http)
      .post("/api/auth/demo")
      .send({ account: "__proto__" })
      .expect(400);
    const prior = process.env.DEMO_LOGIN_ENABLED;
    process.env.DEMO_LOGIN_ENABLED = "false";
    try {
      const disabled = await NestFactory.create(AppModule, { logger: false });
      const auth = disabled.get<MemoryAuthProvider>(AUTH_PROVIDER);
      assert.equal(auth.demoEnabled, false);
      assert.throws(() => auth.demoLogin("admin"));
      assert.throws(() =>
        auth.authenticate("admin@jongno.test", "Jongno2026!"),
      );
      await disabled.close();
    } finally {
      if (prior === undefined) delete process.env.DEMO_LOGIN_ENABLED;
      else process.env.DEMO_LOGIN_ENABLED = prior;
    }
  } finally {
    await app.close();
  }
});
test("모바일 작업 확인내용 보존 및 신규 배정/일정변경 알림 수신 범위", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    const admin = request.agent(app.getHttpServer()),
      worker = request.agent(app.getHttpServer());
    await admin.post("/api/auth/demo").send({ account: "admin" }).expect(201);
    await worker
      .post("/api/auth/demo")
      .send({ account: "worker1" })
      .expect(201);
    const workers = (await admin.get("/api/workers").expect(200)).body;
    const me = (await worker.get("/api/auth/me").expect(200)).body.user;
    const sites = (await admin.get("/api/sites").expect(200)).body;
    const w = (
      await admin
        .post("/api/daily-work")
        .send({
          siteId: sites[0].id,
          workDate: "2026-10-10",
          managerId: me.workerId,
          participantIds: [],
          startTime: "",
          endTime: "",
          content: "PWA 검증",
          notes: "",
          status: "작업예정",
          materials: [],
        })
        .expect(201)
    ).body;
    const photo = (
      await worker
        .post("/api/photos/upload")
        .field("dailyWorkId", w.id)
        .field("type", "작업 전")
        .field("location", "3층")
        .field("description", "실제 세션 사진")
        .field("uploadedBy", "위조 이름")
        .attach("files", readFileSync("fixtures/photos/sample-1.png"), {
          filename: "before.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body[0];
    assert.equal(photo.uploadedBy, me.displayName);
    await worker
      .put("/api/photos/" + photo.id)
      .send({
        location: "3층 복도",
        description: "수정",
        capturedAt: null,
        uploadedBy: "위조 이름",
      })
      .expect(200);
    const other = request.agent(app.getHttpServer());
    await other.post("/api/auth/demo").send({ account: "worker2" }).expect(201);
    await other.delete("/api/photos/" + photo.id).expect(403);
    await worker.delete("/api/photos/" + photo.id).expect(200);
    const alerts = (
      await worker.get("/api/work-instructions/notifications").expect(200)
    ).body;
    assert.ok(
      alerts.some(
        (e: any) => e.dailyWorkId === w.id && e.kind === "site_assigned",
      ),
    );
    await worker.post(`/api/operational/daily-work/${w.id}/start`).expect(201);
    const updated = (
      await worker
        .put(`/api/operational/daily-work/${w.id}`)
        .send({
          ...w,
          status: "작업중",
          verificationNotes: "회로 시험 완료",
          operationConfirmed: true,
          startTime: "08:00",
          endTime: "",
        })
        .expect(200)
    ).body;
    assert.equal(updated.verificationNotes, "회로 시험 완료");
    assert.equal(updated.operationConfirmed, true);
    await admin
      .put(`/api/daily-work/${w.id}`)
      .send({
        ...updated,
        plannedStartTime: "09:00",
        plannedEndTime: "11:00",
        participantIds: [],
      })
      .expect(200);
    const next = (
      await worker.get("/api/work-instructions/notifications").expect(200)
    ).body;
    const change = next.find(
      (e: any) => e.dailyWorkId === w.id && e.kind === "schedule_changed",
    );
    assert.ok(change);
    await worker
      .post(`/api/work-instructions/notifications/${change.id}/read`)
      .expect(201);
    assert.ok(
      (await worker.get("/api/work-instructions/notifications")).body.find(
        (e: any) => e.id === change.id,
      ).readAt,
    );
    assert.ok(workers.length >= 2);
  } finally {
    await app.close();
  }
});
