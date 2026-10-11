import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { seoulToday } from "../src/date";
test("모바일 본인 휴무: 회사/작업진행자 격리, 배정 경고, 수정/삭제, 관리자 일정 반영", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    const http = app.getHttpServer();
    const login = async (email: string) => {
      const a = request.agent(http);
      await a
        .post("/api/auth/login")
        .send({ login: email, password: "Jongro2026!" })
        .expect(201);
      return a;
    };
    const own = await login("worker1@jongro.test"),
      other = await login("worker2@jongro.test"),
      admin = await login("admin@jongro.test"),
      foreign = await login("admin@demo.test"),
      staff = await login("staff@jongro.test");
    await request(http).get("/api/operational/availability").expect(401);
    await staff.get("/api/operational/availability").expect(403);
    const initial = (await own.get("/api/operational/availability").expect(200))
      .body;
    assert.equal(initial.worker.id, "W001");
    assert(!("monthlyPayable" in initial.worker));
    const date = seoulToday();
    const otherBefore = (
      await other.get("/api/operational/availability").expect(200)
    ).body;
    await own
      .put(`/api/operational/availability/${date}`)
      .send({ status: "휴무" })
      .expect(409);
    await own
      .put(`/api/operational/availability/${date}`)
      .send({ status: "휴무", confirmConflict: true, workerId: "W004" })
      .expect(403);
    await own
      .put(`/api/operational/availability/${date}`)
      .send({ status: "휴무", confirmConflict: true, companyId: "demo" })
      .expect(403);
    await own
      .put(`/api/operational/availability/${date}`)
      .send({ status: "휴무", confirmConflict: true })
      .expect(200);
    const calendar = (
      await admin
        .get(`/api/worker-schedule?from=${date}&to=${date}`)
        .expect(200)
    ).body;
    assert.equal(
      calendar.workers
        .find((w: any) => w.id === "W001")
        .availability.find((a: any) => a.date === date).status,
      "휴무",
    );
    assert.deepEqual(
      (await other.get("/api/operational/availability").expect(200)).body,
      otherBefore,
    );
    assert(
      !(
        await foreign
          .get(`/api/worker-schedule?from=${date}&to=${date}`)
          .expect(200)
      ).body.workers.some((w: any) => w.id === "W001"),
    );
    const scoped = (
      await own.get(`/api/worker-schedule?from=${date}&to=${date}`).expect(200)
    ).body;
    assert(scoped.workers.every((w: any) => w.id === "W001"));
    assert(scoped.events.every((e: any) => e.workerIds.includes("W001")));
    await own
      .put(`/api/workers/W004/availability/${date}`)
      .send({ status: "휴무" })
      .expect(403);
    await own
      .put(`/api/operational/availability/${date}`)
      .send({ status: "오전불가", confirmConflict: true })
      .expect(200);
    assert.equal(
      (
        await own.get("/api/operational/availability").expect(200)
      ).body.availability.find((a: any) => a.date === date).status,
      "오전불가",
    );
    await own.delete(`/api/operational/availability/${date}`).expect(200);
    assert(
      !(
        await own.get("/api/operational/availability").expect(200)
      ).body.availability.some((a: any) => a.date === date),
    );
    await own
      .put("/api/operational/availability/2026-02-30")
      .send({ status: "휴무", confirmConflict: true })
      .expect(400);
    await own
      .put(`/api/operational/availability/${date}`)
      .send({ status: "임의상태", confirmConflict: true })
      .expect(400);
    await admin
      .put(`/api/workers/W001/availability/${date}`)
      .send({ status: "오후불가" })
      .expect(200);
    assert.equal(
      (
        await own.get("/api/operational/availability").expect(200)
      ).body.availability.find((a: any) => a.date === date).status,
      "오후불가",
    );
  } finally {
    await app.close();
  }
});
