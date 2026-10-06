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
const receipt = () => ({
  receivedDate: seoulToday(),
  siteId: "S002",
  amount: 500000,
  method: "계좌이체",
  payer: "수금 검증 거래처",
  notes: "실제 원장 검증",
});
const payment = (amount = 200000) => ({
  siteId: "S002",
  workerId: "W003",
  paymentDate: seoulToday(),
  amount,
  notes: "지급 검증",
});
test("예시 현장 수금·미수·차익과 수금 다건 등록/수정/삭제, 대시보드 동기화", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const f = (await request(http).get("/api/sites/S002/finance").expect(200))
      .body;
    assert.deepEqual(f, {
      siteId: "S002",
      contractAmount: 5500000,
      collectedAmount: 4000000,
      receivables: 1500000,
      directMaterials: 820000,
      materialAdvances: 310000,
      labor: 1200000,
      other: 120000,
      totalExpenses: 2450000,
      siteProfit: 3050000,
      unpaidWorkerAmount: 1510000,
    });
    const before = (await request(http).get("/api/dashboard").expect(200)).body
      .summary;
    const created = (
      await request(http)
        .post("/api/payments-received")
        .send(receipt())
        .expect(201)
    ).body;
    const other = (
      await request(http)
        .post("/api/payments-received")
        .send({ ...receipt(), method: "현금" })
        .expect(201)
    ).body;
    assert.equal(
      (await request(http).get("/api/sites/S002").expect(200)).body
        .collectedAmount,
      5000000,
    );
    assert.equal(
      (await request(http).get("/api/sites/S002/finance").expect(200)).body
        .receivables,
      500000,
    );
    const after = (await request(http).get("/api/dashboard").expect(200)).body
      .summary;
    assert.equal(after.collected, before.collected + 1000000);
    assert.equal(after.receivables, before.receivables - 1000000);
    await request(http)
      .put(`/api/payments-received/${created.id}`)
      .send({ ...receipt(), amount: 1000000 })
      .expect(200);
    assert.equal(
      (await request(http).get("/api/sites/S002/finance").expect(200)).body
        .receivables,
      0,
    );
    await request(http)
      .put(`/api/payments-received/${created.id}`)
      .send({ ...receipt(), amount: 1500000 })
      .expect(200);
    assert.equal(
      (await request(http).get("/api/sites/S002/finance").expect(200)).body
        .receivables,
      -500000,
    );
    await request(http)
      .delete(`/api/payments-received/${created.id}`)
      .expect(200);
    await request(http)
      .delete(`/api/payments-received/${other.id}`)
      .expect(200);
    assert.equal(
      (
        await request(http)
          .get("/api/payments-received?siteId=S002")
          .expect(200)
      ).body.length,
      2,
    );
    const site = (await request(http).get("/api/sites/S002").expect(200)).body;
    await request(http)
      .put("/api/sites/S002")
      .send({
        ...site,
        contractAmount: 6000000,
        collectedAmount: 123,
        unpaidWorkerAmount: 123,
      })
      .expect(200);
    const updated = (
      await request(http).get("/api/sites/S002/finance").expect(200)
    ).body;
    assert.equal(updated.receivables, 2000000);
    assert.equal(updated.collectedAmount, 4000000);
    assert.equal(updated.siteProfit, 3550000);
  } finally {
    await app.close();
  }
});
test("일부지급→지급완료, 현장/작업진행자/대시보드 합계, 중복 전액 거부 및 지급취소", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const month = seoulToday().slice(0, 7);
    const baseline = (await request(http).get("/api/dashboard").expect(200))
      .body.summary;
    const partial = (
      await request(http)
        .post("/api/worker-payments")
        .send(payment())
        .expect(201)
    ).body;
    let set = (
      await request(http).get("/api/settlements?workerId=W003").expect(200)
    ).body;
    assert.equal(set.rows[0].status, "일부지급");
    assert.equal(set.rows[0].paidAmount, 200000);
    assert.equal(set.rows[0].unpaidAmount, 1310000);
    assert.equal(set.rows[0].materialAdvances, 310000);
    assert.equal(set.rows[0].labor, 1200000);
    assert.equal(set.rows[0].lastPaymentDate, seoulToday());
    assert.equal(set.monthly.paidAmount, 200000);
    assert.equal(
      (await request(http).get("/api/workers/W003").expect(200)).body
        .unpaidAmount,
      1310000,
    );
    assert.equal(
      (await request(http).get("/api/sites/S002").expect(200)).body
        .unpaidWorkerAmount,
      1310000,
    );
    const dash = (await request(http).get("/api/dashboard").expect(200)).body
      .summary;
    assert.equal(dash.unpaidWorkers, baseline.unpaidWorkers - 200000);
    assert.equal(dash.totalExpenses, baseline.totalExpenses);
    assert.equal(dash.siteProfit, baseline.siteProfit);
    const remaining = (
      await request(http)
        .post("/api/worker-payments")
        .send({ ...payment(), fullPayment: true })
        .expect(201)
    ).body;
    assert.equal(remaining.amount, 1310000);
    await request(http)
      .post("/api/worker-payments")
      .send({ ...payment(), fullPayment: true })
      .expect(409);
    set = (
      await request(http)
        .get("/api/settlements?siteId=S002&workerId=W003&month=" + month)
        .expect(200)
    ).body;
    assert.equal(set.rows[0].status, "지급완료");
    assert.equal(set.totals.unpaidAmount, 0);
    assert.equal(set.totals.paidAmount, 1510000);
    await request(http)
      .delete(`/api/worker-payments/${remaining.id}`)
      .expect(200);
    assert.equal(
      (await request(http).get("/api/settlements?siteId=S002").expect(200)).body
        .rows[0].status,
      "일부지급",
    );
    await request(http)
      .delete(`/api/worker-payments/${partial.id}`)
      .expect(200);
    assert.equal(
      (await request(http).get("/api/settlements?siteId=S002").expect(200)).body
        .rows[0].status,
      "미지급",
    );
  } finally {
    await app.close();
  }
});
test("입력 검증 및 지급 원장 보존, 기타정산 집계, 월별 발생/지급 기준", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    for (const change of [
      { amount: 0 },
      { amount: -1 },
      { amount: 0.5 },
      { amount: "10" },
      { amount: Number.MAX_SAFE_INTEGER },
      { receivedDate: "2026-02-30" },
      { siteId: "missing" },
      { payer: "" },
      { method: "법인카드" },
    ])
      await request(http)
        .post("/api/payments-received")
        .send({ ...receipt(), ...change })
        .expect(change.siteId ? 404 : 400);
    for (const change of [
      { amount: 0 },
      { amount: 1510001 },
      { workerId: "W001" },
      { workerId: "missing" },
      { siteId: "missing" },
      { paymentDate: "2026-02-30" },
      { paymentDate: "2000-01-01" },
      { fullPayment: "true" },
    ])
      await request(http)
        .post("/api/worker-payments")
        .send({ ...payment(), ...change })
        .expect(
          change.workerId === "W001"
            ? 409
            : change.workerId === "missing" || change.siteId
              ? 404
              : 400,
        );
    await request(http).get("/api/settlements?month=invalid").expect(400);
    await request(http).get("/api/settlements?workerId=missing").expect(404);
    await request(http).delete("/api/worker-payments/missing").expect(404);
    const paid = (
      await request(http)
        .post("/api/worker-payments")
        .send(payment(100000))
        .expect(201)
    ).body;
    const expense = (await request(http).get("/api/expenses/E102").expect(200))
      .body;
    for (const change of [
      { supplyAmount: 50000, vat: 0 },
      { workerId: "W001" },
      { siteId: "S001" },
      { type: "기타경비" },
      { expenseDate: "2099-01-01" },
    ])
      await request(http)
        .put("/api/expenses/E102")
        .send({ ...expense, ...change })
        .expect(409);
    await request(http).delete("/api/expenses/E102").expect(409);
    await request(http).delete(`/api/worker-payments/${paid.id}`).expect(200);
    const oldMonth = "2000-01";
    const other = (
      await request(http)
        .post("/api/expenses")
        .send({
          ...expense,
          description: "기타정산 검증",
          type: "기타경비",
          supplyAmount: 10000,
          vat: 0,
          expenseDate: oldMonth + "-05",
          dailyWorkId: null,
          settled: false,
          settlementDate: null,
        })
        .expect(201)
    ).body;
    const otherPay = (
      await request(http)
        .post("/api/worker-payments")
        .send(payment(10000))
        .expect(201)
    ).body;
    const set = (
      await request(http)
        .get("/api/settlements?workerId=W003&month=" + oldMonth)
        .expect(200)
    ).body;
    assert.equal(set.rows[0].other, 10000);
    assert.equal(set.monthly.totalPayable, 10000);
    assert.equal(set.monthly.paidAmount, 0);
    assert.equal(set.monthly.unpaidAmount, 0);
    assert.equal(set.rows[0].totalPayable, 1520000);
    await request(http).delete("/api/workers/W003").expect(200);
    assert.equal(
      (await request(http).get("/api/settlements?workerId=W003").expect(200))
        .body.rows[0].totalPayable,
      1520000,
    );
    await request(http)
      .delete(`/api/worker-payments/${otherPay.id}`)
      .expect(200);
    await request(http).delete(`/api/expenses/${other.id}`).expect(200);
  } finally {
    await app.close();
  }
});
