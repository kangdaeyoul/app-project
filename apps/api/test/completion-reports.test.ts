import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../src/app.module";
import {
  COMPLETION_REPORT_STORAGE,
  CompletionReportStorage,
} from "../src/completion-report-storage";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { CompletionReportService } from "../src/completion-report.service";
import { DEFAULT_COMPANY } from "@jongno/shared";
const parse = (
  res: NodeJS.ReadableStream,
  done: (e: Error | null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};
test("완료보고서: 기존 기록 자동 요약·합산, 수동 편집, 실제 PDF·사진 필터·저장·감사로그", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const work = (await request(http).get("/api/daily-work/D001")).body;
    await request(http)
      .put("/api/daily-work/D001")
      .send({
        ...work,
        participantIds: work.participants.map((p: any) => p.workerId),
        materials: [
          {
            name: "화재감지기 연기식",
            specification: "일반형",
            quantity: 6,
            unit: "개",
            notes: "",
          },
          {
            name: "백관",
            specification: "25A",
            quantity: 12,
            unit: "m",
            notes: "",
          },
        ],
      })
      .expect(200);
    await request(http)
      .post("/api/daily-work")
      .send({
        ...work,
        participantIds: ["W002"],
        workDate: "2026-09-25",
        content: "추가 배관 작업",
        notes: "추가 확인",
        materials: [
          {
            name: "백관",
            specification: "25A",
            quantity: 3,
            unit: "m",
            notes: "",
          },
        ],
      })
      .expect(201);
    const source = (
      await request(http)
        .get("/api/sites/S001/completion-reports/source")
        .expect(200)
    ).body;
    assert.equal(source.defaults.days.length, 2);
    assert.equal(
      source.materials.find((m: any) => m.name === "백관").quantity,
      15,
    );
    assert.deepEqual(source.defaults.participantIds, ["W002", "W003"]);
    assert.equal(source.photos.length, 3);
    const body = {
      ...source.defaults,
      purpose: "소방시설 정상 작동 확인",
      opinion: "보수 완료",
      followUp: "주기적 점검",
      days: source.defaults.days.map((d: any) => ({
        ...d,
        content: "수동 수정 작업내역",
      })),
    };
    for (const [type, photoType, count] of [
      ["공사 완료보고서", "", 3],
      ["보수 완료보고서", "작업 후", 2],
    ] as const) {
      const r = await request(http)
        .post("/api/sites/S001/completion-reports/generate")
        .send({ ...body, documentType: type, photoType })
        .buffer(true)
        .parse(parse)
        .expect(201)
        .expect("Content-Type", /application\/pdf/);
      assert(r.body.length > 10000);
      const pdf = await PDFDocument.load(r.body);
      assert.equal(pdf.getTitle(), type);
      assert.equal(pdf.getPageCount(), 2);
      const key = decodeURIComponent(r.headers["x-report-storage-key"]);
      assert(key.includes("/06 완료보고서/"));
      assert(key.startsWith(`companies/${DEFAULT_COMPANY.id}/S001/`));
      assert.deepEqual(
        app.get<CompletionReportStorage>(COMPLETION_REPORT_STORAGE).get(key),
        r.body,
      );
      assert(
        decodeURIComponent(r.headers["content-disposition"]).includes(
          type.replace(/ /g, "") + "_",
        ),
      );
      // The merged document retains all requested embedded image resources.
      const plain = Buffer.from(
        await pdf.save({ useObjectStreams: false }),
      ).toString("latin1");
      assert.equal((plain.match(/\/Subtype \/Image\b/g) || []).length, count);
      assert(plain.includes("/FontFile2"));
    }
    const preview = await request(http)
      .post("/api/sites/S001/completion-reports/preview")
      .send({
        ...body,
        photoSelection: "선택한 사진만",
        photoIds: ["P001"],
        photoLayout: "사진 목록",
      })
      .buffer(true)
      .parse(parse)
      .expect(201);
    const long = await request(http)
      .post("/api/sites/S001/completion-reports/preview")
      .send({
        ...body,
        purpose: "긴 본문 확인 ".repeat(400) + "마지막 내용 확인",
      })
      .buffer(true)
      .parse(parse)
      .expect(201);
    assert((await PDFDocument.load(long.body)).getPageCount() > 2);
    assert.match(preview.headers["content-disposition"], /^inline/);
    assert.equal(preview.headers["x-report-storage-key"], undefined);
    const pdf = await PDFDocument.load(preview.body);
    assert.equal(
      (
        Buffer.from(await pdf.save({ useObjectStreams: false }))
          .toString("latin1")
          .match(/\/Subtype \/Image\b/g) || []
      ).length,
      1,
    );
    assert.equal(
      (await request(http).get("/api/daily-work/D001")).body.content,
      work.content,
    );
    const logs = (
      await request(http).get("/api/sites/S001/audit-logs?pageSize=100")
    ).body.items;
    assert(
      logs.some(
        (l: any) =>
          l.targetType === "파일" &&
          l.action === "생성" &&
          l.targetId.includes("06 완료보고서"),
      ),
    );
    assert(
      logs.some(
        (l: any) =>
          l.action === "다운로드" &&
          l.after.originalFilename.includes("완료보고서"),
      ),
    );
  } finally {
    await app.close();
  }
});
test("완료보고서: 입력 검증, 빈 현장, 비활성 작업자와 회사·현장 권한 격리", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    for (const body of [
      { documentType: "잘못된 종류" },
      { createdDate: "2026-02-30" },
      { periodStart: "2026-10-20", periodEnd: "2026-10-01" },
      { title: "" },
      { managerId: "other" },
      { participantIds: ["unknown"] },
      { participantIds: ["W002", "W002"] },
      { photoSelection: "선택한 사진만", photoIds: [] },
      { photoIds: ["outside"] },
      { photoType: "작업 후", photoIds: ["P001"] },
      { days: [] },
      { days: [{ dailyWorkId: "D001", date: "1999-01-01", content: "위조" }] },
      { opinion: 3 },
      { purpose: "x".repeat(5001) },
    ])
      await request(http)
        .post("/api/sites/S001/completion-reports/preview")
        .send(body)
        .expect(400);
    await request(http)
      .post("/api/sites/missing/completion-reports/generate")
      .send({})
      .expect(404);
    const empty = await request(http)
      .post("/api/sites/S002/completion-reports/generate")
      .send({})
      .buffer(true)
      .parse(parse)
      .expect(201);
    assert((await PDFDocument.load(empty.body)).getPageCount() >= 1);
    await request(http).delete("/api/workers/W001").expect(200);
    assert(
      (
        await request(http).get("/api/sites/S001/completion-reports/source")
      ).body.workers.some((w: any) => w.id === "W001"),
    );
    const context = app.get(CompanyContext),
      service = app.get(CompletionReportService);
    const member = {
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
    assert.equal(
      context.run(member, () => service.source("S001").site.id),
      "S001",
    );
    assert.throws(
      () => context.run(member, () => service.source("S002")),
      /접근 권한/,
    );
    context.register({ ...DEFAULT_COMPANY, id: "second", name: "다른 회사" });
    const other = {
      companyId: "second",
      userId: "second-admin",
      memberships: [
        { companyId: "second", userId: "second-admin", role: "admin" as const },
      ],
    };
    assert.throws(
      () => context.run(other, () => service.source("S001")),
      /현장을 찾을/,
    );
    const store = app.get<CompletionReportStorage>(COMPLETION_REPORT_STORAGE);
    context.run(SAMPLE_IDENTITY, () =>
      store.put("test-key", Buffer.from("original")),
    );
    assert.equal(
      context.run(other, () => store.get("test-key")),
      undefined,
    );
  } finally {
    await app.close();
  }
});
