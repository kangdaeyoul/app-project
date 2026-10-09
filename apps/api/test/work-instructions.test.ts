import { createTestApp } from "./test-app";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import {
  COMPANY_IDENTITY,
  CompanyIdentityProvider,
} from "../src/company-identity";
import {
  CompanyContext,
  SAMPLE_IDENTITY,
  CompanyIdentity,
} from "../src/company-context";
import { DEFAULT_COMPANY } from "@jongno/shared";
import {
  INSTRUCTION_REPOSITORY,
  InstructionRepository,
} from "../src/work-instructions";
import { seoulToday } from "../src/date";
test("작업지시: 전체/개인/A/S 발송·중복 방지·수신별 읽음·이벤트 분리·금융 비노출·회사 격리", async () => {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  const provider = app.get<CompanyIdentityProvider>(COMPANY_IDENTITY);
  let identity: CompanyIdentity = structuredClone(SAMPLE_IDENTITY);
  provider.resolve = () => identity;
  const asWorker = (id: string) => ({
    ...SAMPLE_IDENTITY,
    userId: "worker-user-" + id,
    workerId: id,
    memberships: [
      {
        companyId: SAMPLE_IDENTITY.companyId,
        userId: "worker-user-" + id,
        role: "viewer" as const,
      },
    ],
  });
  try {
    const opts = (
      await request(http)
        .get("/api/work-instructions/options?siteId=S001")
        .expect(200)
    ).body;
    const participants = opts.filter((o: any) => o.participating);
    assert.ok(participants.length >= 2);
    const input = {
      siteId: "S001",
      title: "작업 전 촬영",
      content: "전후사진을 같은 위치에서 촬영해 주세요.",
      mode: "all",
      important: true,
    };
    const sent = (
      await request(http).post("/api/work-instructions").send(input).expect(201)
    ).body;
    assert.equal(sent.sentCount, participants.length);
    assert.equal(
      sent.message.recipients.every((r: any) => r.readAt === null),
      true,
    );
    const dupe = (
      await request(http)
        .post("/api/work-instructions")
        .send({
          ...input,
          mode: "single",
          workerId: participants[0].id,
          content: "전후사진을  같은 위치에서 촬영해 주세요.",
        })
        .expect(201)
    ).body;
    assert.equal(dupe.duplicate, true);
    assert.equal(
      app.get<InstructionRepository>(INSTRUCTION_REPOSITORY).events().length,
      participants.length,
    );
    await request(http)
      .post("/api/work-instructions")
      .send({ ...input, workerId: "invalid", mode: "single" })
      .expect(400);
    await request(http)
      .post(`/api/work-instructions/${sent.message.id}/read`)
      .expect(403);
    identity = asWorker(participants[0].id);
    const received = (
      await request(http).get("/api/work-instructions").expect(200)
    ).body;
    assert.equal(received.length, 1);
    assert.equal(received[0].recipients.length, 1);
    assert.equal(received[0].siteProfit, undefined);
    const read = (
      await request(http)
        .post(`/api/work-instructions/${sent.message.id}/read`)
        .expect(201)
    ).body;
    assert.ok(read.recipients[0].readAt);
    assert.equal(read.unread, false);
    const reread = (
      await request(http)
        .post(`/api/work-instructions/${sent.message.id}/read`)
        .expect(201)
    ).body;
    assert.equal(reread.recipients[0].readAt, read.recipients[0].readAt);
    const site = (
      await request(http).get("/api/work-instructions/site/S001").expect(200)
    ).body;
    assert.equal(site.contractAmount, undefined);
    await request(http).get("/api/work-instructions/site/S005").expect(403);
    await request(http).post("/api/work-instructions").send(input).expect(403);
    identity = asWorker(participants[1].id);
    assert.equal(
      (await request(http).get("/api/work-instructions").expect(200)).body[0]
        .unread,
      true,
    );
    identity = asWorker("W006");
    assert.deepEqual(
      (await request(http).get("/api/work-instructions").expect(200)).body,
      [],
    );
    await request(http)
      .post(`/api/work-instructions/${sent.message.id}/read`)
      .expect(403);
    identity = structuredClone(SAMPLE_IDENTITY);
    const admin = (
      await request(http).get("/api/work-instructions").expect(200)
    ).body[0];
    assert.equal(admin.recipients.filter((r: any) => r.readAt).length, 1);
    const a = (
      await request(http)
        .post("/api/after-service")
        .send({
          siteId: "S003",
          receivedDate: seoulToday(),
          receivedBy: "관리자",
          request: "A/S 시험",
          type: "하자보수",
          priority: "일반",
          billing: "무상",
          status: "접수",
          managerId: "W004",
          plannedDate: seoulToday(),
          plannedStart: "12:00",
          plannedEnd: "13:00",
        })
        .expect(201)
    ).body;
    const asMsg = (
      await request(http)
        .post("/api/work-instructions")
        .send({ ...input, siteId: "S003", asId: a.id, mode: "as" })
        .expect(201)
    ).body.message;
    assert.equal(asMsg.recipients[0].workerId, "W004");
    await request(http)
      .post("/api/work-instructions")
      .send({ ...input, asId: a.id })
      .expect(400);
    const c = app.get(CompanyContext);
    c.register({ ...DEFAULT_COMPANY, id: "instruction-other" });
    identity = {
      companyId: "instruction-other",
      userId: "other-admin",
      memberships: [
        {
          companyId: "instruction-other",
          userId: "other-admin",
          role: "admin",
        },
      ],
    };
    assert.deepEqual(
      (await request(http).get("/api/work-instructions").expect(200)).body,
      [],
    );
    await request(http)
      .post(`/api/work-instructions/${sent.message.id}/read`)
      .expect(404);
    assert.deepEqual(
      (
        await request(http)
          .get("/api/work-instructions/notifications")
          .expect(200)
      ).body,
      [],
    );
  } finally {
    await app.close();
  }
});
