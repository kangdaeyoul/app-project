import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../src/app.module";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { InspectionReportService } from "../src/inspection-report.service";
import {
  INSPECTION_REPORT_STORAGE,
  InspectionReportStorage,
} from "../src/inspection-report-storage";
import {
  INSPECTION_REPORT_REPOSITORY,
  InspectionReportRepository,
} from "../src/inspection-report.repository";
import { DEFAULT_COMPANY, INSPECTION_REPORT_TITLE } from "@jongno/shared";
const parse = (
  res: NodeJS.ReadableStream,
  done: (e: Error | null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};
const item = (number: string) => ({
  number,
  inspection: "감지기 설치 상태 확인",
  result: "감지기 보수 완료",
  beforePhotoIds: ["P001"],
  afterPhotoIds: ["P002"],
});
test("점검지적사항 보고서: 회사별 초안 저장·수정·순서, 단일 PDF 표지+6/8장, 파일 저장·감사", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const source = (
      await request(http)
        .get("/api/sites/S001/inspection-reports/source")
        .expect(200)
    ).body;
    assert.equal(source.reports.length, 1);
    assert.equal(source.reports[0].items[0].beforePhotoIds[0], "P001");
    assert.equal(source.defaults.layout, 6);
    const input = {
      ...source.defaults,
      originalDocumentName: "소방 점검결과 원본",
      items: [1, 2, 3, 4].map((n) => item(String(n))),
    };
    const created = (
      await request(http)
        .post("/api/sites/S001/inspection-reports")
        .send(input)
        .expect(201)
    ).body;
    assert.equal(created.companyId, DEFAULT_COMPANY.id);
    assert.equal(created.items.length, 4);
    assert(new Set(created.items.map((i: any) => i.id)).size === 4);
    const changed = (
      await request(http)
        .put(`/api/sites/S001/inspection-reports/${created.id}`)
        .send({
          ...created,
          items: [
            created.items[2],
            { ...created.items[0], result: "내용 수정 완료" },
          ],
        })
        .expect(200)
    ).body;
    assert.deepEqual(
      changed.items.map((i: any) => i.number),
      ["3", "1"],
    );
    assert.equal(changed.items[1].id, created.items[0].id);
    assert.equal(changed.items[1].result, "내용 수정 완료");
    assert.equal(
      (
        await request(http).get("/api/sites/S001/inspection-reports/source")
      ).body.reports.find((r: any) => r.id === created.id).items.length,
      2,
    );
    for (const [layout, pages] of [
      [6, 3],
      [8, 2],
    ]) {
      const r = await request(http)
        .post("/api/sites/S001/inspection-reports/generate")
        .send({ ...input, layout })
        .buffer(true)
        .parse(parse)
        .expect(201)
        .expect("Content-Type", /application\/pdf/);
      assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
      assert(r.body.length > 10000);
      const pdf = await PDFDocument.load(r.body);
      assert.equal(pdf.getTitle(), INSPECTION_REPORT_TITLE);
      assert.equal(pdf.getPageCount(), pages);
      const plain = Buffer.from(
        await pdf.save({ useObjectStreams: false }),
      ).toString("latin1");
      assert(plain.includes("/FontFile2"));
      assert.equal((plain.match(/\/Subtype \/Image\b/g) || []).length, 8);
      const key = decodeURIComponent(r.headers["x-report-storage-key"]);
      assert(key.startsWith(`companies/${DEFAULT_COMPANY.id}/S001/`));
      assert(key.includes("/점검지적사항/"));
      assert.deepEqual(
        app.get<InspectionReportStorage>(INSPECTION_REPORT_STORAGE).get(key),
        r.body,
      );
      assert(
        decodeURIComponent(r.headers["content-disposition"]).includes(
          "_점검지적사항보수결과_",
        ),
      );
    }
    const preview = await request(http)
      .post("/api/sites/S001/inspection-reports/preview")
      .send({
        ...input,
        items: [{ ...item("1"), beforePhotoIds: [], afterPhotoIds: [] }],
      })
      .buffer(true)
      .parse(parse)
      .expect(201);
    assert.match(preview.headers["content-disposition"], /^inline/);
    assert.equal(preview.headers["x-report-storage-key"], undefined);
    assert.equal((await PDFDocument.load(preview.body)).getPageCount(), 2);
    const long = await request(http)
      .post("/api/sites/S001/inspection-reports/preview")
      .send({
        ...input,
        items: [
          {
            ...item("1"),
            inspection: "긴 지적사항 설명 ".repeat(400) + "마지막 지적내용",
            result: "긴 보수결과 ".repeat(400) + "마지막 보수결과",
          },
        ],
      })
      .buffer(true)
      .parse(parse)
      .expect(201);
    assert((await PDFDocument.load(long.body)).getPageCount() > 3);
    const longSite = (await request(http).get("/api/sites/S001")).body;
    await request(http)
      .put("/api/sites/S001")
      .send({ ...longSite, name: "긴 현장명 ".repeat(35) })
      .expect(200);
    const cover = await request(http)
      .post("/api/sites/S001/inspection-reports/preview")
      .send({
        ...input,
        originalDocumentName: "긴 원본자료명 ".repeat(30),
        items: [item("1")],
      })
      .buffer(true)
      .parse(parse)
      .expect(201);
    assert.equal((await PDFDocument.load(cover.body)).getPageCount(), 2);
    const logs = (
      await request(http).get("/api/sites/S001/audit-logs?pageSize=100")
    ).body.items;
    assert(
      logs.some(
        (l: any) =>
          l.targetType === "점검지적사항 보고서" && l.action === "생성",
      ),
    );
    assert(
      logs.some(
        (l: any) =>
          l.targetType === "점검지적사항 보고서" &&
          l.action === "수정" &&
          l.before.items.length === 4 &&
          l.after.items.length === 2,
      ),
    );
    assert(
      logs.some(
        (l: any) =>
          l.action === "다운로드" &&
          l.after.originalFilename.includes("점검지적사항보수결과"),
      ),
    );
  } finally {
    await app.close();
  }
});
test("점검지적사항 보고서: 잘못된 사진·항목·날짜와 회사/현장 접근 차단, 삭제 사진 원본 보존", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const source = (
        await request(http).get("/api/sites/S001/inspection-reports/source")
      ).body,
      input = { ...source.defaults, items: [item("1")] };
    for (const patch of [
      { items: [] },
      { items: [item("1"), item("1")] },
      { layout: 7 },
      { layout: "6" },
      { workDate: "2026-02-30" },
      { items: [{ ...item("1"), inspection: "" }] },
      { items: [{ ...item("1"), result: "x".repeat(5001) }] },
      { items: [{ ...item("1"), beforePhotoIds: ["P002"] }] },
      { items: [{ ...item("1"), afterPhotoIds: ["P001"] }] },
      { items: [{ ...item("1"), beforePhotoIds: ["outside"] }] },
      { items: [{ ...item("1"), afterPhotoIds: ["P002", "P002"] }] },
      { items: [{ ...item("1"), id: "II001" }] },
    ])
      await request(http)
        .post("/api/sites/S001/inspection-reports")
        .send({ ...input, ...patch })
        .expect(400);
    await request(http)
      .post("/api/sites/S002/inspection-reports/preview")
      .send(input)
      .expect(400);
    await request(http)
      .put("/api/sites/S002/inspection-reports/IR001")
      .send({
        ...input,
        items: [{ ...item("1"), beforePhotoIds: [], afterPhotoIds: [] }],
      })
      .expect(404);
    await request(http)
      .get("/api/sites/missing/inspection-reports/source")
      .expect(404);
    await request(http)
      .post("/api/sites/S001/inspection-reports/preview")
      .send({ ...input, companyId: "other" })
      .expect(403);
    const before = (await request(http).get("/api/photos/P001/file")).body;
    await request(http)
      .post("/api/sites/S001/inspection-reports/preview")
      .send(input)
      .buffer(true)
      .parse(parse)
      .expect(201);
    assert.deepEqual(
      (await request(http).get("/api/photos/P001/file")).body,
      before,
    );
    await request(http).delete("/api/photos/P001").expect(200);
    await request(http)
      .post("/api/sites/S001/inspection-reports/generate")
      .send(input)
      .expect(400);
    assert.equal(
      app
        .get<InspectionReportRepository>(INSPECTION_REPORT_REPOSITORY)
        .find("IR001")!.items[0].beforePhotoIds[0],
      "P001",
    );
    const company = app.get(CompanyContext),
      reports = app.get(InspectionReportService),
      member = {
        ...SAMPLE_IDENTITY,
        userId: "member",
        memberships: [
          {
            companyId: DEFAULT_COMPANY.id,
            userId: "member",
            role: "member" as const,
          },
        ],
        accessibleSiteIds: ["S001"],
      };
    assert(
      company.run(member, () => reports.source("S001").site.id) === "S001",
    );
    assert.throws(
      () => company.run(member, () => reports.source("S002")),
      /접근 권한/,
    );
    const viewer = {
      ...member,
      memberships: [
        {
          companyId: DEFAULT_COMPANY.id,
          userId: "member",
          role: "viewer" as const,
        },
      ],
    };
    assert.throws(
      () =>
        company.run(viewer, () =>
          reports.save("S001", {
            ...input,
            items: [{ ...item("1"), beforePhotoIds: [], afterPhotoIds: [] }],
          }),
        ),
      /읽기 전용/,
    );
    company.register({ ...DEFAULT_COMPANY, id: "second", name: "다른 회사" });
    const other = {
      companyId: "second",
      userId: "admin2",
      memberships: [
        { companyId: "second", userId: "admin2", role: "admin" as const },
      ],
    };
    assert.throws(
      () => company.run(other, () => reports.source("S001")),
      /현장을 찾을/,
    );
    assert.equal(
      company.run(other, () =>
        app
          .get<InspectionReportRepository>(INSPECTION_REPORT_REPOSITORY)
          .find("IR001"),
      ),
      undefined,
    );
    const store = app.get<InspectionReportStorage>(INSPECTION_REPORT_STORAGE);
    store.put("key", Buffer.from("original"));
    assert.equal(
      company.run(other, () => store.get("key")),
      undefined,
    );
  } finally {
    await app.close();
  }
});
