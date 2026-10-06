import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { seoulToday } from "../src/date";
async function setup() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
const input = () => ({
  expenseDate: seoulToday(),
  siteId: "S001",
  dailyWorkId: "D001",
  type: "작업진행자 대납 자재구매",
  description: "대납 구매 검증",
  vendor: "검증 거래처",
  quantity: 12,
  unit: "개",
  supplyAmount: 170000,
  vat: 17000,
  paymentMethod: "작업진행자 대납",
  evidenceType: "카드전표",
  purchaser: "위조 표시명",
  workerId: "W002",
  isWorkerAdvance: true,
  settled: false,
  settlementDate: null,
  notes: "실제 사용과 별도",
  receiptFileKey: "future-receipt-key",
});
test("지출 등록·수정·삭제, 현장 집계, 사용자재 보존, 작업진행자 정산 반영", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const before = (await request(http).get("/api/daily-work/D001").expect(200))
      .body;
    const seeds = (
      await request(http).get("/api/expenses?siteId=S001").expect(200)
    ).body;
    assert.deepEqual(seeds.totals, {
      directMaterials: 110000,
      workerAdvances: 187000,
      labor: 350000,
      other: 22000,
      total: 669000,
    });
    const kim = (await request(http).get("/api/workers/W001").expect(200)).body;
    assert.deepEqual(kim.expenseSettlement, {
      labor: 350000,
      advances: 187000,
      totalPayable: 537000,
      settledAmount: 0,
      unpaidAmount: 537000,
    });
    const expense = (
      await request(http)
        .post("/api/expenses")
        .send({ ...input(), totalAmount: 1 })
        .expect(201)
    ).body;
    assert.equal(expense.totalAmount, 187000);
    assert.equal(expense.workerId, "W002");
    assert.equal(expense.purchaser, "박진행 팀장");
    assert.equal(expense.workerDisplayName, "박진행 팀장");
    assert.deepEqual(
      (await request(http).get("/api/daily-work/D001").expect(200)).body
        .materials,
      before.materials,
    );
    let worker = (await request(http).get("/api/workers/W002").expect(200))
      .body;
    assert.equal(worker.expenseSettlement.unpaidAmount, 187000);
    assert.equal(worker.unpaidAmount, 837000);
    assert.equal(worker.monthlyPayable, 1187000);
    assert.equal(
      (await request(http).get("/api/expenses?siteId=S001").expect(200)).body
        .totals.total,
      856000,
    );
    await request(http)
      .put(`/api/expenses/${expense.id}`)
      .send({
        ...expense,
        supplyAmount: 200000,
        vat: 20000,
        settled: true,
        settlementDate: seoulToday(),
      })
      .expect(200);
    worker = (await request(http).get("/api/workers/W002").expect(200)).body;
    assert.equal(worker.expenseSettlement.totalPayable, 220000);
    assert.equal(worker.expenseSettlement.settledAmount, 220000);
    assert.equal(worker.expenseSettlement.unpaidAmount, 0);
    assert.equal(worker.unpaidAmount, 650000);
    const updated = (
      await request(http).get(`/api/expenses/${expense.id}`).expect(200)
    ).body;
    assert.equal(updated.receiptFileKey, "future-receipt-key");
    await request(http).delete(`/api/expenses/${expense.id}`).expect(200);
    await request(http).get(`/api/expenses/${expense.id}`).expect(404);
    assert.equal(
      (await request(http).get("/api/expenses?siteId=S001").expect(200)).body
        .totals.total,
      669000,
    );
    assert.equal(
      (await request(http).get("/api/workers/W002").expect(200)).body
        .expenseSettlement.totalPayable,
      0,
    );
  } finally {
    await app.close();
  }
});
test("작업비+대납 지급예정과 정산, 현장/일일작업 관계 및 삭제된 작업진행자 기록 보존", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const advance = (
      await request(http)
        .post("/api/expenses")
        .send({ ...input(), totalAmount: 1 })
        .expect(201)
    ).body;
    const labor = (
      await request(http)
        .post("/api/expenses")
        .send({
          ...input(),
          type: "작업비",
          paymentMethod: "회사계좌이체",
          isWorkerAdvance: false,
          supplyAmount: 350000,
          vat: 0,
        })
        .expect(201)
    ).body;
    const totals = (
      await request(http).get("/api/expenses?workerId=W002").expect(200)
    ).body.workerTotals;
    assert.equal(totals.labor, 350000);
    assert.equal(totals.advances, 187000);
    assert.equal(totals.totalPayable, 537000);
    assert.equal(totals.unpaidAmount, 537000);
    const daily = (await request(http).get("/api/daily-work/D001").expect(200))
      .body;
    await request(http)
      .put("/api/daily-work/D001")
      .send({
        ...daily,
        siteId: "S002",
        participantIds: daily.participants.map(
          (p: { workerId: string }) => p.workerId,
        ),
      })
      .expect(409);
    await request(http).delete("/api/workers/W002").expect(200);
    await request(http)
      .put(`/api/expenses/${advance.id}`)
      .send({
        ...advance,
        notes: "삭제 이후 정산",
        settled: true,
        settlementDate: seoulToday(),
      })
      .expect(200);
    assert.equal(
      (await request(http).get(`/api/expenses/${advance.id}`).expect(200)).body
        .workerDisplayName,
      "박진행 팀장",
    );
    await request(http)
      .post("/api/expenses")
      .send({ ...input(), totalAmount: 1 })
      .expect(400);
    assert.equal(
      (await request(http).get("/api/workers/W002").expect(200)).body
        .expenseSettlement.unpaidAmount,
      350000,
    );
    await request(http)
      .put(`/api/expenses/${labor.id}`)
      .send({ ...labor, siteId: "S002", dailyWorkId: null })
      .expect(200);
    assert.equal(
      (
        await request(http)
          .get("/api/expenses?siteId=S002&workerId=W002")
          .expect(200)
      ).body.items.length,
      1,
    );
    // Other expenses may be reimbursed; category subtotals overlap but total never doubles.
    const misc = (
      await request(http)
        .post("/api/expenses")
        .send({
          ...input(),
          type: "기타경비",
          workerId: "W003",
          supplyAmount: 2000,
          vat: 0,
        })
        .expect(201)
    ).body;
    assert.equal(misc.isWorkerAdvance, true);
    const site = (
      await request(http).get("/api/expenses?siteId=S001").expect(200)
    ).body;
    assert.equal(site.totals.total, 858000);
    assert.equal(site.totals.other, 24000);
  } finally {
    await app.close();
  }
});
test("잘못된 지출·금액·관계·정산 값은 원장을 변경하지 않는다", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    for (const changes of [
      { expenseDate: "2026-02-30" },
      { siteId: "missing" },
      { siteId: "S002" },
      { dailyWorkId: "missing" },
      { type: "unknown" },
      { paymentMethod: "unknown" },
      { evidenceType: "unknown" },
      { quantity: 0 },
      { quantity: 1.0001 },
      { supplyAmount: -1 },
      { supplyAmount: 1.1 },
      { supplyAmount: Number.MAX_SAFE_INTEGER },
      { vat: "17000" },
      { workerId: null },
      { workerId: "missing" },
      { isWorkerAdvance: false },
      { isWorkerAdvance: "true" },
      { settled: "true" },
      { settled: true },
      { settled: true, settlementDate: "2000-01-01" },
      { settlementDate: seoulToday() },
      { receiptFileKey: 123 },
      { description: "" },
    ])
      await request(http)
        .post("/api/expenses")
        .send({ ...input(), ...changes })
        .expect(400);
    await request(http).get("/api/expenses?siteId=missing").expect(404);
    await request(http).get("/api/expenses?workerId=missing").expect(404);
    await request(http).put("/api/expenses/missing").send(input()).expect(404);
    await request(http).delete("/api/expenses/missing").expect(404);
    const initial = (await request(http).get("/api/expenses").expect(200)).body;
    assert.equal(initial.items.length, 4);
    assert.equal(initial.totals.total, 669000);
    await request(http)
      .post("/api/expenses")
      .send({
        ...input(),
        type: "회사 직접 자재구매",
        isWorkerAdvance: false,
        paymentMethod: "법인카드",
        workerId: null,
        purchaser: "회사",
        dailyWorkId: null,
      })
      .expect(201);
    const noVat = (
      await request(http)
        .post("/api/expenses")
        .send({
          ...input(),
          type: "기타경비",
          isWorkerAdvance: false,
          paymentMethod: "회사현금",
          workerId: null,
          purchaser: "회사",
          supplyAmount: 10000,
          vat: 0,
          quantity: 1.125,
          dailyWorkId: null,
          receiptFileKey: null,
        })
        .expect(201)
    ).body;
    assert.equal(noVat.totalAmount, 10000);
    assert.equal(noVat.quantity, 1.125);
  } finally {
    await app.close();
  }
});
