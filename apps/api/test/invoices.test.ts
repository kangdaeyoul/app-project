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
test("계산서 경고/매출 수정, 수금 연결과 사업자정보 보존, 금융금액 불변", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const initial = (await request(http).get("/api/invoices").expect(200)).body;
    assert.deepEqual(initial.warnings, {
      salesUnissued: 4,
      purchasesUnreceived: 5,
      noEvidence: 2,
      workerUnreceived: 2,
    });
    const finance = (
      await request(http).get("/api/sites/S002/finance").expect(200)
    ).body;
    const sale = initial.sales.find(
      (s: { siteId: string }) => s.siteId === "S002",
    );
    assert.equal(sale.totalAmount, 5500000);
    assert.equal(sale.collectedAmount, 4000000);
    const supplier = {
      ...sale.supplier,
      registrationNumber: "123-45-67890",
      name: "등록 공급자",
      address: "서울 종로",
    };
    const issued = (
      await request(http)
        .put("/api/invoices/sales/S002")
        .send({
          ...sale,
          status: "발행완료",
          date: seoulToday(),
          approvalNumber: "TEST-SALES-002",
          receiptIds: ["R003", "R004"],
          supplier,
        })
        .expect(200)
    ).body;
    assert.equal(issued.status, "발행완료");
    assert.deepEqual(issued.receiptIds, ["R003", "R004"]);
    assert.equal(issued.supplier.name, "등록 공급자");
    await request(http).delete("/api/payments-received/R003").expect(409);
    await request(http)
      .put("/api/payments-received/R003")
      .send({
        siteId: "S001",
        receivedDate: seoulToday(),
        amount: 2500000,
        method: "계좌이체",
        payer: "검증 거래처",
        notes: "",
      })
      .expect(409);
    const dashboard = (await request(http).get("/api/dashboard").expect(200))
      .body;
    assert.equal(dashboard.summary.taxWarnings.salesUnissued, 3);
    assert.deepEqual(
      (await request(http).get("/api/sites/S002/finance").expect(200)).body,
      finance,
    );
    await request(http)
      .put("/api/invoices/sales/S002")
      .send({ ...issued, status: "발행불필요", receiptIds: [] })
      .expect(200);
    await request(http).delete("/api/payments-received/R003").expect(200);
    const renewed = (
      await request(http).get("/api/invoices/sales/S002").expect(200)
    ).body;
    assert.equal(renewed.status, "발행불필요");
    assert.equal(renewed.collectedAmount, 1500000);
  } finally {
    await app.close();
  }
});
test("매입 수취와 증빙연결, 정산 계산서 상태, 완료 지출 변경 보호", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const invoices = (
      await request(http).get("/api/invoices?siteId=S002").expect(200)
    ).body;
    const purchase = invoices.purchases.find(
      (p: { expenseId: string }) => p.expenseId === "E102",
    );
    assert.equal(purchase.status, "미수취");
    assert.equal(purchase.totalAmount, 310000);
    await request(http)
      .put("/api/invoices/purchases/E102")
      .send({
        ...purchase,
        status: "수취완료",
        date: seoulToday(),
        approvalNumber: "TEST-PURCHASE-102",
      })
      .expect(200);
    const expense = (await request(http).get("/api/expenses/E102").expect(200))
      .body;
    assert.equal(expense.invoiceReceiptStatus, "수취완료");
    for (const change of [
      { supplyAmount: 300000 },
      { siteId: "S001" },
      { vendor: "변경업체" },
      { evidenceType: "카드전표" },
    ])
      await request(http)
        .put("/api/expenses/E102")
        .send({ ...expense, ...change })
        .expect(409);
    await request(http).delete("/api/expenses/E102").expect(409);
    let state = (
      await request(http).get("/api/invoices?siteId=S002").expect(200)
    ).body;
    assert.equal(state.warnings.purchasesUnreceived, 2);
    await request(http)
      .put("/api/invoices/workers/S002/W003")
      .send({
        status: "발행완료",
        date: seoulToday(),
        approvalNumber: "TEST-WORKER-003",
        notes: "정산 계산서 확인",
      })
      .expect(200);
    state = (await request(http).get("/api/invoices?workerId=W003").expect(200))
      .body;
    assert.equal(state.workers[0].status, "발행완료");
    assert.equal(state.warnings.workerUnreceived, 0);
    assert.equal(
      (await request(http).get("/api/settlements?workerId=W003").expect(200))
        .body.rows[0].invoiceStatus,
      "발행완료",
    );
    await request(http).delete("/api/workers/W003").expect(200);
    assert.equal(
      (await request(http).get("/api/invoices?workerId=W003").expect(200)).body
        .workers[0].status,
      "발행완료",
    );
    await request(http)
      .put("/api/invoices/purchases/E102")
      .send({ ...purchase, status: "해당없음" })
      .expect(200);
    await request(http)
      .put("/api/expenses/E102")
      .send({ ...expense, evidenceType: "카드전표" })
      .expect(200);
    state = (await request(http).get("/api/invoices?siteId=S002").expect(200))
      .body;
    assert(
      !state.purchases.some(
        (p: { expenseId: string }) => p.expenseId === "E102",
      ),
    );
    assert.equal(
      state.expenses.find((e: { id: string }) => e.id === "E102").receiptStatus,
      "해당없음",
    );
  } finally {
    await app.close();
  }
});
test("계산서 입력/관계 검증과 누락 기본상태, 경고 조회 범위", async () => {
  const app = await setup();
  const http = app.getHttpServer();
  try {
    const data = (await request(http).get("/api/invoices").expect(200)).body;
    const sale = data.sales[0];
    const purchase = data.purchases.find(
      (p: { expenseId: string }) => p.expenseId === "E102",
    );
    for (const change of [
      { status: "unknown" },
      { supplyAmount: -1 },
      { vat: 0.5 },
      { supplyAmount: Number.MAX_SAFE_INTEGER },
      { counterparty: "" },
      { date: "2026-02-30" },
      { status: "발행완료", date: null, approvalNumber: "" },
      { receiptIds: ["R003"] },
      { receiptIds: ["R001", "R001"] },
      { supplier: { name: 123 } },
    ])
      await request(http)
        .put("/api/invoices/sales/S001")
        .send({ ...sale, ...change })
        .expect(400);
    for (const change of [
      { status: "unknown" },
      { supplyAmount: 1 },
      { status: "수취완료", date: null, approvalNumber: "" },
    ])
      await request(http)
        .put("/api/invoices/purchases/E102")
        .send({ ...purchase, ...change })
        .expect(400);
    await request(http)
      .put("/api/invoices/purchases/E104")
      .send(purchase)
      .expect(409);
    await request(http)
      .put("/api/invoices/workers/S002/W003")
      .send({ status: "발행완료" })
      .expect(400);
    await request(http)
      .put("/api/invoices/workers/S002/W003")
      .send({ status: "해당없음" })
      .expect(200);
    await request(http).get("/api/invoices?siteId=missing").expect(404);
    await request(http).get("/api/invoices?workerId=missing").expect(404);
    await request(http)
      .put("/api/invoices/workers/S001/W002")
      .send({ status: "해당없음" })
      .expect(404);
    const missing = (
      await request(http)
        .post("/api/sites")
        .send({
          name: "계산서 기본값 검증",
          startDate: seoulToday(),
          contractAmount: 11000,
          status: "미배정",
        })
        .expect(201)
    ).body;
    const draft = (
      await request(http)
        .get("/api/invoices/sales/" + missing.id)
        .expect(200)
    ).body;
    assert.equal(draft.status, "미발행");
    assert.equal(draft.totalAmount, 11000);
    assert.equal(draft.supplyAmount, 10000);
    const historical = (
      await request(http).get("/api/dashboard?month=2000-01").expect(200)
    ).body.summary.taxWarnings;
    assert.deepEqual(historical, {
      salesUnissued: 0,
      purchasesUnreceived: 0,
      noEvidence: 0,
      workerUnreceived: 0,
    });
    const item = (await request(http).get("/api/expenses/E104").expect(200))
      .body;
    await request(http)
      .put("/api/expenses/E104")
      .send({ ...item, evidenceType: "현금영수증" })
      .expect(200);
    assert.equal(
      (await request(http).get("/api/invoices").expect(200)).body.warnings
        .noEvidence,
      1,
    );
  } finally {
    await app.close();
  }
});
