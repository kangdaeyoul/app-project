import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
async function setup() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
const png = readFileSync(join(__dirname, "../fixtures/photos/sample-1.png"));
const meta = {
  location: "3층 천장",
  description: "배관 점검",
  capturedAt: "2026-09-25T08:30:00+09:00",
  uploadedBy: "테스트 등록자",
};
function upload(http: unknown, workId = "D001", type = "작업 전") {
  return request(http as Parameters<typeof request>[0])
    .post("/api/photos/upload")
    .field("dailyWorkId", workId)
    .field("type", type)
    .field("location", meta.location)
    .field("description", meta.description)
    .field("capturedAt", meta.capturedAt)
    .field("uploadedBy", meta.uploadedBy);
}
test("샘플 전후사진과 파일 제공, 여러 장 등록/수정/순서/삭제 및 실제 건수", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const initial = (
      await request(http).get("/api/daily-work/D001").expect(200)
    ).body;
    assert.equal(initial.beforePhotoCount, 1);
    assert.equal(initial.afterPhotoCount, 2);
    await request(http)
      .get("/api/photos/P001/file")
      .expect(200)
      .expect("Content-Type", /image\/png/)
      .expect("X-Content-Type-Options", "nosniff");
    const created = (
      await upload(http)
        .attach("files", png, {
          filename: "작업전-배관.png",
          contentType: "image/png",
        })
        .attach("files", png, {
          filename: "before-two.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body;
    assert.equal(created.length, 2);
    assert.equal(created[0].originalFilename, "작업전-배관.png");
    assert.equal(created[0].siteId, "S001");
    assert.equal(created[0].location, meta.location);
    assert.ok(created[0].storageKey);
    assert.equal(created[0].capturedAt, "2026-09-24T23:30:00.000Z");
    assert.equal(
      (await request(http).get("/api/daily-work/D001").expect(200)).body
        .beforePhotoCount,
      3,
    );
    const file = await request(http).get(created[0].url).expect(200);
    assert.ok(Buffer.isBuffer(file.body));
    assert.ok(file.body.equals(png));
    await request(http)
      .put(`/api/photos/${created[0].id}`)
      .send({ ...meta, description: "수정 설명", capturedAt: null })
      .expect(200);
    const group = (
      await request(http)
        .get(
          "/api/photos?dailyWorkId=D001&type=" + encodeURIComponent("작업 전"),
        )
        .expect(200)
    ).body;
    const ids = group.map((p: { id: string }) => p.id).reverse();
    const ordered = (
      await request(http)
        .put("/api/photos/order")
        .send({ dailyWorkId: "D001", type: "작업 전", ids })
        .expect(200)
    ).body;
    assert.deepEqual(
      ordered.map((p: { id: string }) => p.id),
      ids,
    );
    await request(http).delete(`/api/photos/${created[0].id}`).expect(200);
    await request(http).get(created[0].url).expect(404);
    assert.equal(
      (await request(http).get("/api/daily-work/D001").expect(200)).body
        .beforePhotoCount,
      2,
    );
  } finally {
    await app.close();
  }
});
test("현장과 날짜 필터, 일일작업 현장 변경, 기존 사진 보존", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const work = (await request(http).get("/api/daily-work/D001").expect(200))
      .body;
    assert.equal(
      (
        await request(http)
          .get(
            "/api/photos?siteId=S001&type=" +
              encodeURIComponent("작업 후") +
              "&workDate=" +
              work.workDate,
          )
          .expect(200)
      ).body.length,
      2,
    );
    assert.equal(
      (await request(http).get("/api/photos?siteId=S002").expect(200)).body
        .length,
      0,
    );
    await request(http)
      .put("/api/daily-work/D001")
      .send({
        ...work,
        siteId: "S002",
        workDate: "2026-09-25",
        participantIds: work.participants.map(
          (p: { workerId: string }) => p.workerId,
        ),
      })
      .expect(200);
    assert.equal(
      (await request(http).get("/api/photos?siteId=S001").expect(200)).body
        .length,
      0,
    );
    const list = (
      await request(http)
        .get("/api/photos?siteId=S002&workDate=2026-09-25")
        .expect(200)
    ).body;
    assert.equal(list.length, 3);
    assert.equal(list[0].siteId, "S002");
  } finally {
    await app.close();
  }
});
test("잘못된 파일/메타데이터/작업/정렬 목록은 거부하며 부분 등록하지 않는다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    await upload(http)
      .attach("files", Buffer.from("<svg/>"), {
        filename: "bad.svg",
        contentType: "image/svg+xml",
      })
      .expect(400);
    await upload(http)
      .attach("files", png, { filename: "good.png", contentType: "image/png" })
      .attach("files", Buffer.from("bad"), {
        filename: "bad.png",
        contentType: "image/png",
      })
      .expect(400);
    await upload(http, "missing")
      .attach("files", png, { filename: "a.png", contentType: "image/png" })
      .expect(404);
    await request(http)
      .put("/api/photos/P001")
      .send({ ...meta, capturedAt: "2026-02-30T00:00:00Z" })
      .expect(400);
    await request(http)
      .put("/api/photos/P001")
      .send({ ...meta, uploadedBy: "" })
      .expect(400);
    await request(http)
      .put("/api/photos/order")
      .send({ dailyWorkId: "D001", type: "작업 전", ids: ["P002"] })
      .expect(400);
    await request(http).get("/api/photos?type=bad").expect(400);
    await request(http).get("/api/photos?workDate=invalid").expect(400);
    await request(http).delete("/api/photos/missing").expect(404);
    assert.equal(
      (await request(http).get("/api/photos").expect(200)).body.length,
      3,
    );
  } finally {
    await app.close();
  }
});
