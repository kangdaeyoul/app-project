import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { AppModule } from "../src/app.module";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import {
  COMPANY_IDENTITY,
  CompanyIdentityProvider,
} from "../src/company-identity";
import { AfterServiceService } from "../src/after-service";
import { DEFAULT_COMPANY } from "@jongno/shared";
import { seoulToday } from "../src/date";
const date = seoulToday();
const input = {
  siteId: "S003",
  receivedDate: date,
  receivedBy: "관리자",
  request: "3층 감지기 오동작",
  location: "3층 복도",
  equipment: "연기감지기",
  type: "하자보수",
  priority: "일반",
  billing: "무상",
  status: "접수",
  urgent: false,
};
async function setup() {
  const a = await NestFactory.create(AppModule, { logger: false });
  a.setGlobalPrefix("api");
  await a.init();
  return a;
}
test("A/S 접수·연결·배정·처리·사진·무상 비용·견적·매출·재발·종결·실제 PDF", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const original = (await request(http).get("/api/sites/S003").expect(200))
      .body;
    let r = (
      await request(http).post("/api/after-service").send(input).expect(201)
    ).body;
    assert.ok(r.number.startsWith("AS-"));
    assert.equal(r.siteName, original.name);
    await request(http)
      .put(`/api/after-service/${r.id}`)
      .send({ ...r, workIds: ["D001"] })
      .expect(400);
    await request(http)
      .put(`/api/after-service/${r.id}`)
      .send({ ...r, status: "종결", resultConfirmed: true })
      .expect(400);
    const image = readFileSync("fixtures/photos/sample-1.png");
    await request(http)
      .post(
        `/api/after-service/${r.id}/photos/${encodeURIComponent("접수 사진")}`,
      )
      .field("location", "3층 복도")
      .field("description", "오동작 접수")
      .attach("files", image, {
        filename: "접수.png",
        contentType: "image/png",
      })
      .expect(201);
    await request(http)
      .put(`/api/after-service/${r.id}`)
      .send({
        ...r,
        managerId: "W004",
        plannedDate: date,
        plannedStart: "10:00",
        plannedEnd: "11:00",
      })
      .expect(409);
    r = (
      await request(http)
        .put(`/api/after-service/${r.id}`)
        .send({
          ...r,
          managerId: "W004",
          plannedDate: date,
          plannedStart: "12:00",
          plannedEnd: "13:00",
          urgent: true,
        })
        .expect(200)
    ).body;
    const workId = r.workIds[0];
    assert.ok(workId);
    assert.equal(r.status, "일정예정");
    const events = (
      await request(http)
        .get(`/api/worker-schedule?from=${date}&to=${date}`)
        .expect(200)
    ).body.events;
    assert.ok(
      events.some((e: any) => e.asId === r.id && e.dailyWorkId === workId),
    );
    await request(http)
      .put(`/api/after-service/${r.id}/work`)
      .send({
        dailyWorkId: workId,
        content: "감지기 교체 및 회로시험",
        cause: "감지기 불량",
        action: "감지기 교체",
        testResult: "정상",
        startTime: "12:00",
        endTime: "13:00",
        status: "작업완료",
        materials: [
          {
            name: "연기감지기",
            specification: "일반형",
            quantity: 1,
            unit: "개",
            notes: "",
          },
        ],
      })
      .expect(200);
    for (const phase of ["작업 전", "작업 후", "작업 중", "시험/확인"])
      await request(http)
        .post(`/api/after-service/${r.id}/photos/${encodeURIComponent(phase)}`)
        .field("location", "3층 복도")
        .field("description", phase)
        .attach("files", image, {
          filename: `${phase.replace("/", "_")}.png`,
          contentType: "image/png",
        })
        .expect(201);
    const work = (
      await request(http).get(`/api/daily-work/${workId}`).expect(200)
    ).body;
    assert.equal(work.beforePhotoCount, 1);
    assert.equal(work.afterPhotoCount, 1);
    assert.equal(work.materialCount, 1);
    await request(http)
      .post("/api/expenses")
      .send({
        expenseDate: date,
        siteId: "S003",
        dailyWorkId: workId,
        type: "작업비",
        description: "무상 보수 작업비",
        vendor: "",
        quantity: 1,
        unit: "식",
        supplyAmount: 100000,
        vat: 0,
        paymentMethod: "회사계좌이체",
        evidenceType: "증빙없음",
        purchaser: "최기계",
        workerId: "W004",
        isWorkerAdvance: false,
        settled: false,
        settlementDate: null,
        notes: "",
        receiptFileKey: null,
      })
      .expect(201);
    const f = (await request(http).get("/api/sites/S003/finance").expect(200))
      .body;
    assert.equal(f.asCost, 100000);
    assert.equal(f.originalRevenue, original.contractAmount);
    assert.equal(f.siteProfit, original.contractAmount - f.totalExpenses);
    r = (await request(http).get(`/api/after-service/${r.id}`).expect(200))
      .body;
    r = (
      await request(http)
        .put(`/api/after-service/${r.id}`)
        .send({
          ...r,
          status: "처리완료",
          completedDate: date,
          result: "오동작 해소",
          finalAction: "감지기 교체",
          normalOperation: true,
        })
        .expect(200)
    ).body;
    assert.equal(r.workIds.length, 1);
    const binary = (res: any, cb: any) => {
      const a: Buffer[] = [];
      res.on("data", (b: Buffer) => a.push(b));
      res.on("end", () => cb(null, Buffer.concat(a)));
    };
    for (const mode of [
      "처리결과 + 전후사진",
      "사진대지만",
      "처리결과 내역만", "처리결과만",
    ]) {
      const pdf = await request(http)
        .post(`/api/after-service/${r.id}/report`)
        .send({ mode, save: true })
        .buffer(true)
        .parse(binary)
        .expect(201);
      assert.ok(pdf.body.length > 10000);
      const parsed = await PDFDocument.load(pdf.body);
      assert.ok(parsed.getPageCount() >= 1);
    }
    await request(http)
      .put(`/api/after-service/${r.id}`)
      .send({ ...r, status: "종결", resultConfirmed: true })
      .expect(200);
    const repeated = (
      await request(http)
        .post("/api/after-service")
        .send({ ...input, previousId: r.id })
        .expect(201)
    ).body;
    assert.equal(repeated.recurrenceCount, 2);
    await request(http)
      .put(`/api/after-service/${repeated.id}`)
      .send({ ...repeated, previousId: repeated.id })
      .expect(400);
    const paid = (
      await request(http)
        .post("/api/after-service")
        .send({ ...input, billing: "유상", request: "추가 유상보수" })
        .expect(201)
    ).body;
    let q = (
      await request(http)
        .post(`/api/after-service/${paid.id}/quote`)
        .expect(201)
    ).body;
    assert.equal(q.siteId, "S003");
    assert.equal(q.totals.totalAmount, 0);
    q.sections[0].items[0].saleUnitPrice = 200000;
    q.sections[0].items[0].pricePending = false;
    q.status = "승인";
    q = (await request(http).put(`/api/quotes/${q.id}`).send(q).expect(200))
      .body;
    const siteCount = (await request(http).get("/api/sites").expect(200)).body
      .length;
    await request(http)
      .post(`/api/quotes/${q.id}/convert`)
      .send({})
      .expect(201);
    assert.equal(
      (await request(http).get("/api/sites").expect(200)).body.length,
      siteCount,
    );
    const total = (
      await request(http).get("/api/sites/S003/finance").expect(200)
    ).body;
    assert.equal(total.asRevenue, q.totals.totalAmount);
    assert.equal(
      total.contractAmount,
      original.contractAmount + q.totals.totalAmount,
    );
    assert.equal(
      (await request(http).get("/api/sites/S003").expect(200)).body
        .contractAmount,
      original.contractAmount,
    );
    await request(http).delete(`/api/after-service/${paid.id}`).expect(200);
    assert.equal(
      (await request(http).get("/api/sites/S003/finance").expect(200)).body
        .asRevenue,
      q.totals.totalAmount,
    );
  } finally {
    await app.close();
  }
});
test("A/S 서버 권한: 회사 격리·본인만 조회·작업 입력·사진·재배정/금액/타인 금융 차단", async () => {
  const app = await setup(),
    service = app.get(AfterServiceService),
    context = app.get(CompanyContext),
    provider = app.get<CompanyIdentityProvider>(COMPANY_IDENTITY),
    http = app.getHttpServer();
  try {
    const a = service.save({
      ...input,
      managerId: "W004",
      plannedDate: date,
      plannedStart: "12:00",
      plannedEnd: "13:00",
    });
    const b = service.save({ ...input, request: "타인 요청" });
    const identity = {
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
    provider.resolve = () => identity;
    const list = (await request(http).get("/api/after-service").expect(200))
      .body;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, a.id);
    assert.equal(list[0].financial, undefined);
    assert.equal(list[0].chargeAmount, undefined);
    assert.equal(list[0].expenses, undefined);
    await request(http).get(`/api/after-service/${b.id}`).expect(403);
    await request(http)
      .put(`/api/after-service/${a.id}`)
      .send({ ...a, chargeAmount: 1000 })
      .expect(403);
    await request(http).post(`/api/after-service/${a.id}/quote`).expect(403);
    await request(http).delete(`/api/after-service/${a.id}`).expect(403);
    await request(http).get("/api/sites/S003/finance").expect(403);
    await request(http).get("/api/expenses").expect(403);
    await request(http).get("/api/dashboard").expect(403);
    await request(http)
      .put(`/api/after-service/${a.id}/work`)
      .send({
        dailyWorkId: a.workIds[0],
        content: "본인 처리내용",
        cause: "현장 확인",
      })
      .expect(200);
    const image = readFileSync("fixtures/photos/sample-1.png");
    await request(http)
      .post(
        `/api/after-service/${a.id}/photos/${encodeURIComponent("작업 전")}`,
      )
      .attach("files", image, {
        filename: "before.png",
        contentType: "image/png",
      })
      .expect(201);
    await request(http).get("/api/photos/P001/file").expect(403);
    const other = {
      ...DEFAULT_COMPANY,
      id: "as-other",
      displayName: "다른 회사",
    };
    context.register(other);
    context.run(
      {
        companyId: other.id,
        userId: "other",
        memberships: [{ companyId: other.id, userId: "other", role: "admin" }],
      },
      () => {
        assert.equal(service.list().length, 0);
        assert.throws(() => service.detail(a.id));
        assert.throws(() => service.save(input));
      },
    );
  } finally {
    await app.close();
  }
});

test("A/S 확장: 배정/긴급/변경 알림, 완료요청 권한·필수입력·이력, 유상/무상 비용과 종결", async () => {
  const app = await setup(),
    http = app.getHttpServer(),
    provider = app.get<CompanyIdentityProvider>(COMPANY_IDENTITY);
  let identity = structuredClone(SAMPLE_IDENTITY);
  provider.resolve = () => identity;
  try {
    const originalSite=(await request(http).get('/api/sites/S003').expect(200)).body;
    await request(http).put('/api/sites/S003').send({...originalSite,managerId:null,manager:null,status:'완료'}).expect(200);

    let a = (
      await request(http)
        .post("/api/after-service")
        .send({
          ...input,
          managerId: "W004",
          plannedDate: date,
          plannedStart: "12:00",
          plannedEnd: "13:00",
          urgent: true,
        })
        .expect(201)
    ).body;
    const preservedSite=(await request(http).get('/api/sites/S003').expect(200)).body;
    assert.equal(preservedSite.status,'완료');assert.equal(preservedSite.managerId,null);
    let events = (
      await request(http)
        .get("/api/work-instructions/notifications")
        .expect(200)
    ).body.filter((e: any) => e.asId === a.id);
    assert.ok(events.some((e: any) => e.kind === "as_assigned"));
    assert.ok(events.some((e: any) => e.kind === "as_urgent"));
    const eventCount = events.length;
    await request(http)
      .post("/api/after-service")
      .send({
        ...input,
        managerId: "W006",
        plannedDate: date,
        plannedStart: "12:00",
        plannedEnd: "13:00",
      })
      .expect(409);
    a = (
      await request(http).put(`/api/after-service/${a.id}`).send(a).expect(200)
    ).body;
    assert.equal(
      (
        await request(http)
          .get("/api/work-instructions/notifications")
          .expect(200)
      ).body.filter((e: any) => e.asId === a.id).length,
      eventCount,
    );
    await request(http)
      .post(`/api/after-service/${a.id}/complete-request`)
      .send({
        cause: "불량",
        finalAction: "교체",
        testResult: "정상",
        result: "완료",
      })
      .expect(400);
    const tomorrow = new Date(Date.parse(date) + 86400000)
      .toISOString()
      .slice(0, 10);
    await request(http)
      .post("/api/worker-schedule/assign")
      .send({
        asId: a.id,
        dailyWorkId: a.workIds[0],
        siteId: a.siteId,
        date: tomorrow,
        start: "12:00",
        end: "13:00",
        managerId: "W004",
        participantIds: [],
        kind: "A/S",
        urgent: true,
        force: true,
      })
      .expect(201);
    a = (await request(http).get(`/api/after-service/${a.id}`).expect(200))
      .body;
    a = (
      await request(http)
        .put(`/api/after-service/${a.id}`)
        .send({ ...a, participantIds: ["W006"], force: true })
        .expect(200)
    ).body;
    events = (
      await request(http)
        .get("/api/work-instructions/notifications")
        .expect(200)
    ).body;
    assert.equal(events.filter((e:any)=>e.asId===a.id&&e.kind==="as_worker_changed"&&e.recipientWorkerId==="W004").length,1);
    for (const kind of ["as_date_changed", "as_worker_changed"])
      assert.ok(events.some((e: any) => e.asId === a.id && e.kind === kind));
    identity = {
      ...SAMPLE_IDENTITY,
      workerId: "W004",
      memberships: SAMPLE_IDENTITY.memberships.map((m) => ({
        ...m,
        role: "viewer" as const,
      })),
    };
    await request(http).put(`/api/after-service/${a.id}/work`).send({dailyWorkId:a.workIds[0],status:'관리자확인완료'}).expect(403);
    const ev = (
      await request(http)
        .get("/api/work-instructions/notifications")
        .expect(200)
    ).body.find((e: any) => e.asId === a.id);
    await request(http)
      .post(`/api/work-instructions/notifications/${ev.id}/read`)
      .expect(201);
    assert.ok(
      (
        await request(http)
          .get("/api/work-instructions/notifications")
          .expect(200)
      ).body.find((e: any) => e.id === ev.id).readAt,
    );
    await request(http)
      .put(`/api/after-service/${a.id}/work`)
      .send({
        dailyWorkId: a.workIds[0],
        status: "작업완료",
        startTime: "12:00",
        endTime: "13:00",
        content: "감지기 교체",
      })
      .expect(200);
    await request(http)
      .post(`/api/after-service/${a.id}/complete-request`)
      .send({ cause: "" })
      .expect(400);
    a = (
      await request(http)
        .post(`/api/after-service/${a.id}/complete-request`)
        .send({
          cause: "불량",
          finalAction: "교체",
          testResult: "정상",
          result: "완료",
          normalOperation: true,
          needsVisit: false,
          needsQuote: false,
        })
        .expect(201)
    ).body;
    assert.equal(a.status, "처리완료");
    assert.equal(a.resultConfirmed, false);
    assert.equal(a.financial, undefined);
    assert.equal(a.chargeAmount, undefined);
    assert.ok(a.statusHistory.some((h: any) => h.to === "처리완료"));
    await request(http)
      .put(`/api/after-service/${a.id}`)
      .send({ ...a, status: "종결" })
      .expect(403);
    identity = structuredClone(SAMPLE_IDENTITY);
    await request(http)
      .post("/api/expenses")
      .send({
        expenseDate: date,
        siteId: "S003",
        dailyWorkId: a.workIds[0],
        type: "작업비",
        description: "A/S 내부 작업비",
        vendor: "",
        quantity: 1,
        unit: "식",
        supplyAmount: 90000,
        vat: 0,
        paymentMethod: "회사계좌이체",
        evidenceType: "증빙없음",
        purchaser: "최기계",
        workerId: "W004",
        isWorkerAdvance: false,
        settled: false,
        settlementDate: null,
        notes: "",
        receiptFileKey: null,
      })
      .expect(201);
    let f = (await request(http).get("/api/sites/S003/finance").expect(200))
      .body;
    assert.equal(f.asFreeCost, 90000);
    assert.equal(f.asPaidCost, 0);
    a = (await request(http).get(`/api/after-service/${a.id}`).expect(200))
      .body;
    a = (
      await request(http)
        .put(`/api/after-service/${a.id}`)
        .send({ ...a, billing: "유상" })
        .expect(200)
    ).body;
    f = (await request(http).get("/api/sites/S003/finance").expect(200)).body;
    assert.equal(f.asFreeCost, 0);
    assert.equal(f.asPaidCost, 90000);
    assert.equal(f.asCost, f.asFreeCost + f.asPaidCost + f.asPendingCost);
    a = (
      await request(http)
        .put(`/api/after-service/${a.id}`)
        .send({ ...a, status: "재확인필요" })
        .expect(200)
    ).body;
    await request(http)
      .put(`/api/after-service/${a.id}`)
      .send({ ...a, status: "종결", resultConfirmed: true })
      .expect(200);
    events = (
      await request(http)
        .get("/api/work-instructions/notifications")
        .expect(200)
    ).body;
    for (const kind of ["as_completed", "as_review", "as_closed"])
      assert.ok(events.some((e: any) => e.asId === a.id && e.kind === kind));
  } finally {
    await app.close();
  }
});
