import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import ExcelJS from "exceljs";
import * as XLSX from "@e965/xlsx";
import { AppModule } from "../src/app.module";
async function fixture() {
  const app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  const login = async (
    email = "admin@jongro.test",
    password = "Jongro2026!",
  ) => {
    const agent = request.agent(http);
    await agent
      .post("/api/auth/login")
      .send({ login: email, password })
      .expect(201);
    return agent;
  };
  return { app, http, login };
}
test("가입 승인·잠금·본인정보·비밀번호·회사 격리", async () => {
  const { app, http, login } = await fixture();
  try {
    const b = {
      name: "가입 직원",
      email: "join@example.test",
      phone: "010-1234-5678",
      companyName: "주식회사 종로소방",
      password: "JoinPass123!",
      role: "staff",
    };
    await request(http)
      .post("/api/auth/signup")
      .send({ ...b, role: "admin" })
      .expect(400);
    await request(http).post("/api/auth/signup").send(b).expect(201);
    await request(http)
      .post("/api/auth/login")
      .send({ login: b.email, password: b.password })
      .expect(401);
    const admin = await login();
    let u = (await admin.get("/api/users").expect(200)).body.find(
      (u: any) => u.email === b.email,
    );
    assert.equal(u.approvalStatus, "승인대기");
    await admin
      .put("/api/users/" + u.id)
      .send({ ...u, approvalStatus: "승인", active: true })
      .expect(200);
    const staff = await login(b.email, b.password);
    await staff.put("/api/auth/profile").send({ role: "admin" }).expect(403);
    const profile = (
      await staff
        .put("/api/auth/profile")
        .send({ displayName: "검증 표시명", phone: "010-9999-0000" })
        .expect(200)
    ).body;
    assert.equal(profile.displayName, "검증 표시명");
    await staff
      .put("/api/auth/profile")
      .send({ password: "NewJoin123!", currentPassword: b.password })
      .expect(200);
    await staff.get("/api/auth/me").expect(401);
    const changed = await login(b.email, "NewJoin123!");
    await admin
      .put("/api/users/" + u.id)
      .send({ ...u, approvalStatus: "승인", active: true, locked: true })
      .expect(200);
    await changed.get("/api/auth/me").expect(401);
    await request(http)
      .post("/api/auth/signup")
      .send({
        ...b,
        email: "otherjoin@example.test",
        companyName: "테스트 소방회사",
      })
      .expect(201);
    assert(
      !(await admin.get("/api/users")).body.some(
        (u: any) => u.email === "otherjoin@example.test",
      ),
    );
    const other = await login("admin@demo.test");
    assert(
      (await other.get("/api/users")).body.some(
        (u: any) => u.email === "otherjoin@example.test",
      ),
    );
    const current = (await admin.get("/api/users")).body.find(
      (u: any) => u.role === "admin",
    );
    await admin
      .put("/api/users/" + current.id)
      .send({ ...current, approvalStatus: "거절" })
      .expect(400);
  } finally {
    await app.close();
  }
});
test("수금 상태·월간 집계·완료현장 실적 검토·Excel/CSV·권한", async () => {
  const { app, login } = await fixture();
  try {
    const a = await login();
    const c = (await a.get("/api/business-reports/collections").expect(200))
      .body;
    assert.equal(c.length, 5);
    assert(c.every((r: any) => r.supplyAmount + r.vat === r.contractAmount));
    const site = c[0];
    await a
      .post("/api/payments-received")
      .send({
        siteId: site.siteId,
        receivedDate: "2026-10-11",
        amount: site.contractAmount + 1,
        method: "계좌이체",
        payer: "실적 검증",
        notes: "",
      })
      .expect(201);
    const over = (await a.get("/api/business-reports/collections")).body.find(
      (r: any) => r.siteId === site.siteId,
    );
    assert.equal(over.collectionStatus, "초과입금");
    assert(over.overpayment > 0);
    assert.equal(over.outstanding, 0);
    const month = (
      await a.get("/api/business-reports/monthly?month=2026-10").expect(200)
    ).body;
    assert(month.received >= site.contractAmount + 1);
    const sites = (await a.get("/api/sites")).body;
    const done = sites.find((s: any) => s.status === "완료");
    const year = Number(done.endDate.slice(0, 4));
    const annual = (
      await a.get("/api/business-reports/performance?year=" + year).expect(200)
    ).body;
    const r = annual.rows.find((r: any) => r.siteId === done.id);
    assert(r);
    assert.equal(r.status, "검토필요");
    assert.equal(r.completedDate, "");
    const review = {
      year,
      status: "실적신고 대상",
      contractDate: done.startDate,
      completedDate: done.endDate,
      mechanical: done.contractAmount,
      electrical: 0,
      constructionType: "소방기계",
      workType: "개보수",
      notes: "관리자 확인",
    };
    await a
      .put("/api/business-reports/performance/" + done.id)
      .send({ ...review, mechanical: null })
      .expect(400);
    await a
      .put("/api/business-reports/performance/" + done.id)
      .send(review)
      .expect(200);
    assert.equal(
      (await a.get("/api/business-reports/performance?year=" + year)).body
        .summary.targetSites,
      1,
    );
    const x = await a
      .get(
        "/api/business-reports/performance/export?year=" +
          year +
          "&format=xlsx",
      )
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    assert.equal(wb.worksheets[0].getCell("A1").text, "연도");
    const csv = await a
      .get(
        "/api/business-reports/performance/export?year=" + year + "&format=csv",
      )
      .expect(200);
    assert(csv.text.includes(done.name));
    const worker = await login("worker1@jongro.test");
    await worker.get("/api/business-reports/collections").expect(403);
    const other = await login("admin@demo.test");
    assert.equal(
      (await other.get("/api/business-reports/performance?year=" + year)).body
        .rows.length,
      0,
    );
  } finally {
    await app.close();
  }
});
test("범용 XLS/XLSX 매핑·단가이력·중복정책·양식 재사용·회사 격리", async () => {
  const { app, login } = await fixture();
  try {
    const a = await login();
    const rows = [
      ["상품명", "사이즈", "단위", "판매가", "매입가"],
      ["범용 검증품", "25A", "개", 5000, 3000],
      ["오류품", "32A", "개", "문자", 2000],
    ];
    const make = (bookType: "xls" | "xlsx", data: any[][]) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "거래처");
      return XLSX.write(wb, { type: "buffer", bookType });
    };
    const inspect = await a
      .post("/api/material-prices/universal/inspect")
      .attach("file", make("xls", rows), "vendor.xls")
      .expect(201);
    const body = {
      sheetName: "거래처",
      headerRow: 1,
      mapping: { name: 0, specification: 1, unit: 2, salePrice: 3, cost: 4 },
      policy: "전체정보 업데이트",
      templateName: "검증 거래처",
    };
    const preview = (
      await a
        .post("/api/material-prices/universal/" + inspect.body.id + "/preview")
        .send(body)
        .expect(201)
    ).body;
    assert.equal(preview.summary.new, 1);
    assert.equal(preview.summary.errors, 1);
    await a
      .post("/api/material-prices/imports/" + preview.id + "/apply")
      .send({ mode: "전체" })
      .expect(400);
    await a
      .post("/api/material-prices/imports/" + preview.id + "/apply")
      .send({ mode: "정상행만" })
      .expect(201);
    const price = (await a.get("/api/standard-work")).body.prices.find(
      (p: any) => p.name === "범용 검증품",
    );
    assert.equal(price.salePrice, 5000);
    const changed = [rows[0], ["범용 검증품", "25A", "개", 6500, 3500]];
    const i = (
      await a
        .post("/api/material-prices/universal/inspect")
        .attach("file", make("xlsx", changed), "vendor.xlsx")
        .expect(201)
    ).body;
    assert.equal(i.formats[0].name, "검증 거래처");
    const p = (
      await a
        .post("/api/material-prices/universal/" + i.id + "/preview")
        .send({ ...body, policy: "단가 업데이트" })
        .expect(201)
    ).body;
    assert.equal(p.summary.updated, 1);
    await a
      .post("/api/material-prices/imports/" + p.id + "/apply")
      .send({ mode: "전체" })
      .expect(201);
    const history = (
      await a.get("/api/material-prices/" + price.id + "/history").expect(200)
    ).body;
    assert(
      history.some(
        (h: any) =>
          h.afterSalePrice === 6500 ||
          h.salePriceAfter === 6500 ||
          JSON.stringify(h).includes("6500"),
      ),
    );
    const keep = (
      await a
        .post("/api/material-prices/universal/" + i.id + "/preview")
        .send({ ...body, policy: "기존값 유지" })
    ).body;
    assert.equal(keep.summary.unchanged, 1);
    const other = await login("admin@demo.test");
    await other
      .post("/api/material-prices/universal/" + i.id + "/preview")
      .send(body)
      .expect(404);
    assert(
      !(await other.get("/api/standard-work")).body.prices.some(
        (p: any) => p.name === "범용 검증품",
      ),
    );
  } finally {
    await app.close();
  }
});
