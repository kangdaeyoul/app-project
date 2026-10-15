import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { postgresCatalogTransaction } from "../src/material-persistence";
import { MemoryStandardWorkRepository } from "../src/standard-work.repository";
import { MATERIAL_EXCEL_COLUMNS, priceToQuoteItem } from "@jongro/shared";
const binary = (res: any, done: any) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};
async function file(rows: any[][]) {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("자재단가");
  s.addRow([...MATERIAL_EXCEL_COLUMNS]);
  for (const r of rows) s.addRow(r);
  return Buffer.from(await w.xlsx.writeBuffer());
}
async function app() {
  const a = await NestFactory.create(AppModule, { logger: false });
  a.setGlobalPrefix("api");
  await a.init();
  return a;
}
async function login(http: any, email = "admin@jongro.test") {
  const a = request.agent(http);
  await a
    .post("/api/auth/login")
    .send({ login: email, password: "Jongro2026!" })
    .expect(201);
  return a;
}
test("영구 자재관리: 표준 양식·수정 검토·취소·승인·이력·코드 충돌·역할·재시작·과거 견적", async () => {
  const dir = mkdtempSync(join(tmpdir(), "material-db-"));
  const previous = {
    mode: process.env.MATERIAL_STORAGE,
    path: process.env.MATERIAL_SQLITE_PATH,
    seed: process.env.MATERIAL_SEED_SAMPLES,
  };
  process.env.MATERIAL_STORAGE = "sqlite";
  process.env.MATERIAL_SQLITE_PATH = join(dir, "catalog.sqlite");
  process.env.MATERIAL_SEED_SAMPLES = "true";
  let a = await app();
  try {
    let admin = await login(a.getHttpServer());
    const initial = (
      await admin.get("/api/material-prices/catalog").expect(200)
    ).body;
    assert.equal((await admin.get("/api/initial-setup").expect(200)).body.checks.materials,true);
    assert.equal(initial.persistent, true);
    assert(initial.prices.some((p: any) => p.id === "PRICE-1"));
    const template = await admin
      .get("/api/material-prices/template")
      .buffer(true)
      .parse(binary)
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template.body);
    assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), [
      ...MATERIAL_EXCEL_COLUMNS,
    ]);
    assert.equal(wb.worksheets[0].getCell("H2").value, "");
    const payload = await file([
      [
        "ENTERPRISE-1",
        "기업 자재",
        "25A",
        "m",
        "기계",
        "제조업체",
        "공급업체",
        "1,234",
        "2,345",
        "3,456",
        "포함",
        "2026-10-12",
        "검토",
      ],
      [
        "EMPTY-PRICE",
        "미입력 자재",
        "",
        "개",
        "전기",
        "",
        "",
        "",
        "",
        "",
        "미포함",
        "",
        "",
      ],
    ]);
    let job = (
      await admin
        .post("/api/material-prices/imports/preview")
        .attach("file", payload, "표준.xlsx")
        .expect(201)
    ).body;
    assert.equal(
      (await admin.get("/api/material-prices/catalog")).body.prices.length,
      initial.prices.length,
    );
    assert.equal(job.rows[0].price.purchasePrice, 1234);
    assert.equal(job.rows[0].price.cost, 2345);
    assert.equal(job.rows[0].price.salePrice, 3456);
    assert.equal(job.rows[1].price.priceRegistered, false);
    job.rows[0].values[9] = "4,567";
    job = (
      await admin
        .put(`/api/material-prices/imports/${job.id}/review`)
        .send({ rows: job.rows, revision: job.revision })
        .expect(200)
    ).body;
    assert.equal(job.rows[0].price.salePrice, 4567);
    assert.equal(
      (await admin.get("/api/material-prices/catalog")).body.prices.length,
      initial.prices.length,
    );
    job = (
      await admin
        .post(`/api/material-prices/imports/${job.id}/submit`)
        .send({ revision: job.revision })
        .expect(201)
    ).body;
    assert.equal(job.status, "승인대기");
    const staff = await login(a.getHttpServer(), "staff@jongro.test");
    await staff
      .post(`/api/material-prices/imports/${job.id}/apply`)
      .send({ mode: "전체" })
      .expect(403);
    await staff.post("/api/material-prices/catalog").send({}).expect(403);
    const read = (await staff.get("/api/material-prices/catalog").expect(200))
      .body;
    assert.equal(read.prices[0].cost, undefined);
    await staff.get("/api/material-prices/history").expect(403);
    const users = (await admin.get("/api/users")).body;
    const s = users.find((u: any) => u.email === "staff@jongro.test");
    await admin
      .put(`/api/users/${s.id}`)
      .send({ ...s, permissions: [...s.permissions, "manageMaterials"] })
      .expect(200);
    await staff
      .post(`/api/material-prices/imports/${job.id}/apply`)
      .send({ mode: "전체" })
      .expect(403);
    await staff
      .put(`/api/material-prices/imports/${job.id}/review`)
      .send({ revision: job.revision, rows: job.rows })
      .expect(200);
    job = (await admin.get(`/api/material-prices/imports/${job.id}`)).body;
    job = (
      await admin
        .post(`/api/material-prices/imports/${job.id}/submit`)
        .send({ revision: job.revision })
        .expect(201)
    ).body;
    await admin
      .post(`/api/material-prices/imports/${job.id}/apply`)
      .send({ mode: "전체", revision: job.revision, reason: "검토 완료" })
      .expect(201);
    let p = (await admin.get("/api/material-prices/catalog")).body.prices.find(
      (p: any) => p.materialCode === "ENTERPRISE-1",
    );
    assert.equal(p.salePrice, 4567);
    assert.equal(priceToQuoteItem(p).saleUnitPrice, 4152);
    const quote = (await admin.get("/api/quotes")).body[0];
    const q = (
      await admin
        .post("/api/quotes")
        .send({
          ...quote,
          status: "작성중",
          sections: [
            {
              kind: "기계",
              items: [{ ...priceToQuoteItem(p), saleUnitPrice: 7777 }],
            },
          ],
        })
        .expect(201)
    ).body;
    p = (
      await admin
        .put(`/api/material-prices/catalog/${p.id}`)
        .send({
          ...p,
          materialCode: "NEW-CODE",
          salePrice: 5500,
          auditReason: "가격 갱신",
        })
        .expect(200)
    ).body;
    assert.equal(p.id, "ENTERPRISE-1");
    await admin
      .put(`/api/material-prices/catalog/${p.id}`)
      .send({ ...p, revision: 0, salePrice: 999 })
      .expect(409);
    const saved = (await admin.get(`/api/quotes/${q.id}`)).body;
    assert.equal(saved.sections[0].items[0].saleUnitPrice, 7777);
    const hist = (
      await admin.get(`/api/material-prices/${p.id}/history`).expect(200)
    ).body;
    assert(hist.some((h: any) => h.approvedBy === "sample-admin"));
    assert(
      hist.some(
        (h: any) =>
          h.changes.some((c: any) => c.field === "materialCode") &&
          h.userId === "sample-admin",
      ),
    );
    let cancel = (
      await admin
        .post("/api/material-prices/imports/preview")
        .attach("file", payload, "취소.xlsx")
    ).body;
    await admin
      .post(`/api/material-prices/imports/${cancel.id}/cancel`)
      .expect(201);
    await admin
      .post(`/api/material-prices/imports/${cancel.id}/apply`)
      .send({ mode: "전체" })
      .expect(409);
    const collision = await file([
      [
        "NEW-CODE",
        "다른 품목",
        "50A",
        "개",
        "기계",
        "",
        "",
        5,
        6,
        7,
        "미포함",
        "",
        "",
      ],
    ]);
    let dup = (
      await admin
        .post("/api/material-prices/imports/preview")
        .attach("file", collision, "충돌.xlsx")
    ).body;
    assert.equal(dup.rows[0].duplicate, true);
    assert.equal(dup.summary.errors, 1);
    await admin
      .post(`/api/material-prices/imports/${dup.id}/apply`)
      .send({ mode: "전체" })
      .expect(400);
    dup.rows[0].action = "신규등록";
    dup.rows[0].values[0] = "UNIQUE-NEW";
    dup = (
      await admin
        .put(`/api/material-prices/imports/${dup.id}/review`)
        .send({ rows: dup.rows, revision: dup.revision })
    ).body;
    await admin
      .post(`/api/material-prices/imports/${dup.id}/apply`)
      .send({ mode: "전체" })
      .expect(201);
    const out = await admin
      .get("/api/material-prices/export")
      .buffer(true)
      .parse(binary)
      .expect(200);
    const roundtrip = (
      await admin
        .post("/api/material-prices/imports/preview")
        .attach("file", out.body, "복원.xlsx")
    ).body;
    assert.equal(roundtrip.summary.new, 0);
    assert.equal(roundtrip.summary.updated, 0);
    assert.equal(roundtrip.summary.errors, 0);
    const other = await login(a.getHttpServer(), "admin@demo.test");
    assert.equal(
      (await other.get("/api/material-prices/catalog")).body.prices.length,
      0,
    );
    await other.get(`/api/material-prices/imports/${job.id}`).expect(404);
    await a.close();
    a = await app();
    admin = await login(a.getHttpServer());
    const reopened = (await admin.get("/api/material-prices/catalog")).body
      .prices;
    assert.equal(
      reopened.find((v: any) => v.materialCode === "NEW-CODE").salePrice,
      5500,
    );
    assert(reopened.find((v: any) => v.materialCode === "UNIQUE-NEW"));
    assert.equal(
      (await admin.get(`/api/material-prices/imports/${job.id}`)).body.status,
      "반영완료",
    );
    assert(
      (await admin.get(`/api/material-prices/${p.id}/history`)).body.length >=
        2,
    );
    assert(
      (await admin.get("/api/material-prices/imports")).body.some(
        (j: any) => j.id === roundtrip.id,
      ),
    );
  } finally {
    await a.close();
    for (const [key, value] of [
      ["MATERIAL_STORAGE", previous.mode],
      ["MATERIAL_SQLITE_PATH", previous.path],
      ["MATERIAL_SEED_SAMPLES", previous.seed],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true });
  }
});
test("PostgreSQL 실제 엔진: 전용 스키마·원자적 롤백·회사 격리·재연결 저장", async () => {
  const dir = mkdtempSync(join(tmpdir(), "material-postgres-"));
  let db = new PGlite(dir);
  await db.exec(
    readFileSync(resolve("migrations/001-material-management.sql"), "utf8"),
  );
  const empty = () => new MemoryStandardWorkRepository(false).snapshot();
  const p = {
    id: "PERSIST",
    companyId: "jongro",
    name: "PG 자재",
    specification: "25A",
    unit: "개",
    category: "재료비" as const,
    cost: 100,
    salePrice: 130,
  };
  try {
    await postgresCatalogTransaction(db, "jongro", empty, async (state) => {
      state.prices.push(p);
      return { state, result: true };
    });
    await assert.rejects(
      postgresCatalogTransaction(db, "jongro", empty, async (state) => {
        state.prices[0].salePrice = 999;
        throw Error("승인 실패");
      }),
    );
    const persisted = await postgresCatalogTransaction(
      db,
      "jongro",
      empty,
      async (state) => ({ state, result: state.prices[0].salePrice }),
    );
    assert.equal(persisted, 130);
    const isolated = await postgresCatalogTransaction(
      db,
      "other",
      empty,
      async (state) => ({ state, result: state.prices.length }),
    );
    assert.equal(isolated, 0);
    await db.close();
    db = new PGlite(dir);
    assert.equal(
      await postgresCatalogTransaction(db, "jongro", empty, async (state) => ({
        state,
        result: state.prices[0].salePrice,
      })),
      130,
    );
  } finally {
    await db.close();
    rmSync(dir, { recursive: true });
  }
});

test("가격 정책: 세 가격 분리·미입력·가산율·소매가격·VAT 이중반영 방지", async () => {
  const { validateMaterial } = await import("../src/material-price");
  const input = {
    name: "판매정책 테스트",
    unit: "개",
    category: "재료비",
    purchasePrice: "",
    cost: "11,000",
    salePrice: "",
    vatIncluded: false,
    costVatIncluded: true,
    saleVatIncluded: false,
    salePriceSource: "원가가산",
    markupPercent: 30,
  };
  const p = validateMaterial(input, "jongro", "POLICY");
  assert.equal(p.purchasePriceRegistered, false);
  assert.equal(p.purchasePrice, 0);
  assert.equal(p.cost, 11000);
  assert.equal(p.salePrice, 13000);
  assert.equal(priceToQuoteItem(p).materialUnitCost, 10000);
  assert.equal(priceToQuoteItem(p).saleUnitPrice, 13000);
  const retail = validateMaterial(
    { ...input, salePriceSource: "소매가격", salePrice: 15000 },
    "jongro",
    "RETAIL",
  );
  assert.equal(retail.salePrice, 15000);
  assert.equal(retail.salePriceSource, "소매가격");
  const missing = validateMaterial(
    { ...input, cost: "", salePrice: "", salePriceSource: "직접입력" },
    "jongro",
    "MISSING",
  );
  assert.equal(missing.costRegistered, false);
  assert.equal(missing.priceRegistered, false);
  assert.equal(priceToQuoteItem(missing).pricePending, true);
  assert.throws(() =>
    validateMaterial(
      { ...input, cost: 1000000000, markupPercent: 1000 },
      "jongro",
      "EXCESS",
    ),
  );
});
