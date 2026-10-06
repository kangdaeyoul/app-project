import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PHOTO_REPORT_LAYOUTS, PhotoView } from "@jongno/shared";
import { reportRows } from "../src/photo-report.service";
import {
  PHOTO_REPORT_STORAGE,
  PhotoReportStorage,
  TemporaryPhotoReportStorage,
} from "../src/photo-report-storage";
const parsePdf = (
  res: NodeJS.ReadableStream,
  done: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};
const options = { showWorker: true, showNumber: true, showTime: true };
test("사진대지 실제 PDF 3가지 형식, 임시저장/미리보기, 필터와 원본 보존", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const originals = [1, 2, 3].map((n) =>
      readFileSync(join(__dirname, `../fixtures/photos/sample-${n}.png`)),
    );
    const photos = (await request(http).get("/api/photos?siteId=S001"))
      .body as PhotoView[];
    assert.equal(photos.length, 3);
    for (const layout of PHOTO_REPORT_LAYOUTS) {
      const pdf = await request(http)
        .post("/api/sites/S001/photo-reports/generate")
        .send({ ...options, layout })
        .buffer(true)
        .parse(parsePdf)
        .expect(201)
        .expect("Content-Type", /application\/pdf/);
      assert.ok(pdf.body.length > 10000);
      assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.body.toString("latin1").includes("/FontFile2"));
      assert.equal(
        (pdf.body.toString("latin1").match(/\/Subtype \/Image\b/g) || [])
          .length,
        3,
      );
      assert.ok(
        decodeURIComponent(pdf.headers["content-disposition"]).includes(
          "종로 오피스 소방시설 개선_공사사진대지_",
        ),
      );
      const key = decodeURIComponent(pdf.headers["x-report-storage-key"]);
      assert.ok(key.includes("/05 현장사진/사진대지/"));
      assert.deepEqual(
        app.get<PhotoReportStorage>(PHOTO_REPORT_STORAGE).get(key),
        pdf.body,
      );
    }
    const preview = await request(http)
      .post("/api/sites/S001/photo-reports/preview")
      .send({
        ...options,
        selection: "선택한 사진만",
        photoIds: ["P001", "P003"],
      })
      .buffer(true)
      .parse(parsePdf)
      .expect(201);
    assert.match(preview.headers["content-disposition"], /^inline/);
    assert.equal(preview.headers["x-report-storage-key"], undefined);
    assert.equal(
      (preview.body.toString("latin1").match(/\/Subtype \/Image\b/g) || [])
        .length,
      2,
    );
    const before = await request(http)
      .post("/api/sites/S001/photo-reports/preview")
      .send({ type: "작업 전", workDate: photos[0].workDate })
      .buffer(true)
      .parse(parsePdf)
      .expect(201);
    assert.equal(
      (before.body.toString("latin1").match(/\/Subtype \/Image\b/g) || [])
        .length,
      1,
    );
    for (let i = 0; i < 3; i++) {
      const file = await request(http)
        .get(`/api/photos/P00${i + 1}/file`)
        .expect(200);
      assert.deepEqual(file.body, originals[i]);
    }
    let upload = request(http)
      .post("/api/photos/upload")
      .field("dailyWorkId", "D001")
      .field("type", "작업 후")
      .field("uploadedBy", "테스트 관리자")
      .field("location", "3층 천장 배관");
    for (let i = 0; i < 4; i++)
      upload = upload.attach("files", originals[0], {
        filename: `extra-${i}.png`,
        contentType: "image/png",
      });
    await upload.expect(201);
    for (const [layout, pages] of [
      ["작업 전/후 비교형", 3],
      ["페이지당 4장", 2],
      ["페이지당 6장", 2],
    ]) {
      const pdf = await request(http)
        .post("/api/sites/S001/photo-reports/preview")
        .send({ layout })
        .buffer(true)
        .parse(parsePdf)
        .expect(201);
      assert.equal(
        (pdf.body.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
        pages,
      );
      assert.equal(
        (pdf.body.toString("latin1").match(/\/Subtype \/Image\b/g) || [])
          .length,
        7,
      );
    }
    await request(http)
      .put("/api/photos/P001")
      .send({
        location: "긴 위치".repeat(30),
        description: "전체 설명 보존 ".repeat(200),
        uploadedBy: "관리자",
        capturedAt: null,
      })
      .expect(200);
    const appendix = await request(http)
      .post("/api/sites/S001/photo-reports/preview")
      .send({
        selection: "선택한 사진만",
        photoIds: ["P001"],
        workContent: "긴 공사내용".repeat(300),
        showNumber: false,
      })
      .buffer(true)
      .parse(parsePdf)
      .expect(201);
    assert.ok(
      (appendix.body.toString("latin1").match(/\/Type \/Page\b/g) || [])
        .length >= 2,
    );
  } finally {
    await app.close();
  }
});
test("사진대지 잘못된 범위/날짜/옵션/외부현장 사진 차단", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    for (const body of [
      { layout: "invalid" },
      { createdDate: "2026-02-30" },
      { periodStart: "2026-10-20", periodEnd: "2026-10-01" },
      { showWorker: "true" },
      { selection: "선택한 사진만", photoIds: [] },
      { selection: "선택한 사진만", photoIds: ["P001", "P001"] },
      { selection: "선택한 사진만", photoIds: ["outside"] },
      { selection: "선택한 사진만", type: "작업 후", photoIds: ["P001"] },
      { type: "전체" },
      { workDate: "1999-01-01" },
      { title: "" },
      { companyName: "x".repeat(101) },
    ])
      await request(http)
        .post("/api/sites/S001/photo-reports/preview")
        .send(body)
        .expect(400);
    await request(http)
      .post("/api/sites/missing/photo-reports/generate")
      .send({})
      .expect(404);
    await request(http)
      .post("/api/sites/S002/photo-reports/generate")
      .send({ selection: "선택한 사진만", photoIds: ["P001"] })
      .expect(400);
    await request(http).delete("/api/photos/P001").expect(200);
    await request(http)
      .post("/api/sites/S001/photo-reports/generate")
      .send({ selection: "선택한 사진만", photoIds: ["P001"] })
      .expect(400);
  } finally {
    await app.close();
  }
});
test("비교형 짝짓기: 같은 날짜/위치만 연결하고 모든 사진을 중복 없이 보존", () => {
  const p = (
    id: string,
    type: PhotoView["type"],
    workDate = "2026-10-06",
    location = "3층",
  ) => ({ id, type, workDate, location }) as PhotoView;
  const photos = [
    p("a", "작업 전"),
    p("b", "작업 후"),
    p("c", "작업 후"),
    p("d", "작업 전", "2026-10-07"),
    p("e", "작업 후", "2026-10-06", "4층"),
    p("f", "작업 전", "2026-10-06", ""),
    p("g", "작업 후", "2026-10-06", ""),
  ];
  const rows = reportRows(photos, true);
  assert.deepEqual(
    rows[0].map((p) => p?.id),
    ["a", "b"],
  );
  assert.deepEqual(
    rows[1].map((p) => p?.id ?? null),
    [null, "c"],
  );
  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows
      .flat()
      .filter(Boolean)
      .map((p) => p!.id)
      .sort(),
    photos.map((p) => p.id).sort(),
  );
});
test("생성 PDF 임시저장 어댑터 복사 및 보관 수 제한", () => {
  const storage = new TemporaryPhotoReportStorage();
  const data = Buffer.from("pdf");
  storage.put("0", data);
  data.fill(0);
  assert.equal(storage.get("0")!.toString(), "pdf");
  storage.get("0")!.fill(0);
  assert.equal(storage.get("0")!.toString(), "pdf");
  for (let i = 1; i <= 20; i++) storage.put(String(i), Buffer.from("pdf"));
  assert.equal(storage.get("0"), undefined);
  assert.equal(storage.get("20")!.toString(), "pdf");
});
