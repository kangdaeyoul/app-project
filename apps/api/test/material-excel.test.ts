import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import ExcelJS from "exceljs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { MaterialExcelService } from "../src/material-excel.service";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import {
  MATERIAL_EXCEL_COLUMNS,
  DEFAULT_COMPANY,
  priceToQuoteItem,
  reapplyLatestQuotePrices,
} from "@jongno/shared";
const parser = (
  res: NodeJS.ReadableStream,
  done: (e: Error | null, b: Buffer) => void,
) => {
  const b: Buffer[] = [];
  res.on("data", (c) => b.push(c));
  res.on("end", () => done(null, Buffer.concat(b)));
};
async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("자재단가");
  ws.addRow([...MATERIAL_EXCEL_COLUMNS]);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function setup() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
test("Excel 표준/회사 목록 다운로드, 신규·수정·무코드 매칭·정상행 반영·단가이력·견적 보존·격리", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const svc = app.get(MaterialExcelService);
    const template = await request(http)
      .get("/api/material-prices/template")
      .buffer(true)
      .parse(parser)
      .expect(200);
    const twb = new ExcelJS.Workbook();
    await twb.xlsx.load(template.body);
    assert.equal(twb.worksheets[0].rowCount, 6);
    assert.deepEqual(twb.worksheets[0].getRow(1).values.slice(1), [
      ...MATERIAL_EXCEL_COLUMNS,
    ]);
    const data = (await request(http).get("/api/standard-work")).body,
      existing = data.prices[0];
    const beforeQuote = (await request(http).get("/api/quotes")).body[0];
    const quoted = (
      await request(http)
        .post("/api/quotes")
        .send({
          ...beforeQuote,
          status: "작성중",
          sections: [{ kind: "전기", items: [priceToQuoteItem(existing)] }],
        })
        .expect(201)
    ).body;
    const exported = await request(http)
      .get("/api/material-prices/export")
      .buffer(true)
      .parse(parser)
      .expect(200);
    const preview = await request(http)
      .post("/api/material-prices/imports/preview")
      .attach("file", exported.body, "export.xlsx")
      .expect(201);
    assert.equal(preview.body.summary.unchanged, data.prices.length);
    assert.equal(preview.body.summary.errors, 0);
    const p2 = data.prices[1];
    const upload = await workbook([
      [
        "",
        "신규 소방용 테스트 자재",
        "X1",
        "개",
        "전기",
        "제조사",
        "공급업체",
        500,
        700,
        1000,
        "미포함",
        "2026-10-07",
        "테스트",
      ],
      [
        existing.id,
        existing.name,
        existing.specification,
        existing.unit,
        "전기",
        "",
        "",
        4500,
        6000,
        9000,
        "포함",
        "2026-10-07",
        "기존 코드 수정",
      ],
      [
        "",
        p2.name,
        p2.specification,
        p2.unit,
        "전기",
        "",
        "",
        111,
        222,
        333,
        "미포함",
        "2026-10-07",
        "무코드 기존 매칭",
      ],
      [
        "",
        "오류 품목",
        "X2",
        "",
        100,
        "",
        "",
        100,
        "문자",
        1000,
        "미포함",
        "2026-02-30",
        "",
      ],
    ]);
    const job = (
      await request(http)
        .post("/api/material-prices/imports/preview")
        .attach("file", upload, "bulk.xlsx")
        .expect(201)
    ).body;
    assert.deepEqual(job.summary, {
      total: 4,
      new: 1,
      updated: 2,
      unchanged: 0,
      errors: 1,
    });
    assert.equal(
      (await request(http).get("/api/standard-work")).body.prices.length,
      data.prices.length,
    );
    await request(http)
      .post(`/api/material-prices/imports/${job.id}/apply`)
      .send({ mode: "전체" })
      .expect(400);
    const applied = (
      await request(http)
        .post(`/api/material-prices/imports/${job.id}/apply`)
        .send({ mode: "정상행만" })
        .expect(201)
    ).body;
    assert.equal(applied.appliedCount, 3);
    await request(http)
      .post(`/api/material-prices/imports/${job.id}/apply`)
      .send({ mode: "정상행만" })
      .expect(201);
    const after = (await request(http).get("/api/standard-work")).body.prices;
    assert.equal(after.length, data.prices.length + 1);
    assert.equal(
      after.find((p: { id: string }) => p.id === existing.id).salePrice,
      9000,
    );
    assert.equal(
      after.find((p: { id: string }) => p.id === p2.id).salePrice,
      333,
    );
    const history = (
      await request(http)
        .get(`/api/material-prices/${existing.id}/history`)
        .expect(200)
    ).body;
    assert.equal(history.length, 1);
    assert.equal(history[0].beforeCost, existing.cost);
    assert.equal(history[0].afterCost, 6000);
    assert.equal(history[0].afterPurchasePrice, 4500);
    assert.equal(history[0].method, "Excel 업로드");
    assert.equal(history[0].effectiveDate, "2026-10-07");
    const old = (await request(http).get(`/api/quotes/${quoted.id}`)).body;
    assert.equal(old.sections[0].items[0].saleUnitPrice, existing.salePrice);
    const latest = priceToQuoteItem(
      after.find((p: { id: string }) => p.id === existing.id),
    );
    assert.equal(latest.saleUnitPrice, 9000);
    assert.equal(priceToQuoteItem(after[0], false).saleUnitPrice, 0);
    assert.equal(
      reapplyLatestQuotePrices(old.sections[0].items, after)[0].saleUnitPrice,
      9000,
    );
    await request(http)
      .put(`/api/standard-work/prices/${existing.id}`)
      .send({
        ...after.find((p: { id: string }) => p.id === existing.id),
        salePrice: 9500,
      })
      .expect(200);
    const manual = (
      await request(http).get(`/api/material-prices/${existing.id}/history`)
    ).body;
    assert.equal(manual.length, 2);
    assert.equal(manual[1].method, "수동");
    assert.equal(manual[1].beforeSalePrice, 9000);
    const context = app.get(CompanyContext);
    context.register({ ...DEFAULT_COMPANY, id: "excel-other" });
    await context.run(
      {
        companyId: "excel-other",
        userId: "a",
        memberships: [{ companyId: "excel-other", userId: "a", role: "admin" }],
      },
      async () => {
        assert.throws(() => svc.job(job.id));
        assert.throws(() => svc.history(existing.id));
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(
          (await svc.download(false)) as unknown as Parameters<
            typeof wb.xlsx.load
          >[0],
        );
        assert.equal(wb.worksheets[0].rowCount, 1);
      },
    );
    context.run(
      {
        ...SAMPLE_IDENTITY,
        memberships: [
          {
            companyId: DEFAULT_COMPANY.id,
            userId: SAMPLE_IDENTITY.userId,
            role: "member",
          },
        ],
      },
      () => assert.throws(() => svc.job(job.id)),
    );
  } finally {
    await app.close();
  }
});
test("중복 코드/동일품목/누락/문자 단가/잘못된 날짜/수식 검증 및 미리보기 충돌", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const row = [
      "CODE-X",
      "품목",
      "25A",
      "개",
      "",
      "",
      "",
      1,
      2,
      3,
      "미포함",
      "2026-10-07",
      "",
    ];
    const file = await workbook([
      row,
      row,
      [
        "CODE-Y",
        "",
        "25A",
        "",
        "",
        "",
        "",
        "문자",
        2,
        3,
        "미포함",
        "2026-13-01",
        "",
      ],
      [
        "CODE-Z",
        "수식 품목",
        "X",
        "개",
        "",
        "",
        "",
        0,
        1,
        { formula: "1+1" },
        "미포함",
        "2026-10-07",
        "",
      ],
    ]);
    const j = (
      await request(http)
        .post("/api/material-prices/imports/preview")
        .attach("file", file, "bad.xlsx")
        .expect(201)
    ).body;
    assert.equal(j.summary.errors, 4);
    assert(j.rows[0].errors.some((s: string) => s.includes("중복 자재코드")));
    assert(j.rows[0].errors.some((s: string) => s.includes("동일 자재")));
    assert(j.rows[2].errors.some((s: string) => s.includes("자재명 누락")));
    assert(j.rows[3].errors.some((s: string) => s.includes("수식")));
    const data = (await request(http).get("/api/standard-work")).body,
      p = data.prices[0];
    const valid = await workbook([
      [
        p.id,
        p.name,
        p.specification,
        p.unit,
        "",
        "",
        "",
        0,
        p.cost,
        9900,
        "미포함",
        "2026-10-07",
        "",
      ],
    ]);
    const preview = (
      await request(http)
        .post("/api/material-prices/imports/preview")
        .attach("file", valid, "valid.xlsx")
    ).body;
    await request(http)
      .put(`/api/standard-work/prices/${p.id}`)
      .send({ ...p, salePrice: 8800 })
      .expect(200);
    await request(http)
      .post(`/api/material-prices/imports/${preview.id}/apply`)
      .send({ mode: "전체" })
      .expect(409);
    await request(http)
      .post("/api/material-prices/imports/preview")
      .attach("file", Buffer.from("not xlsx"), "bad.xlsx")
      .expect(400);
    await request(http)
      .post("/api/material-prices/imports/preview")
      .expect(400);
  } finally {
    await app.close();
  }
});

test("Excel 빈 판매단가는 미등록으로 보존하고 자동입력 금액을 확정하지 않는다", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const buffer = await workbook([
      [
        "",
        "미등록 단가 부속",
        "16mm",
        "개",
        "전기",
        "",
        "",
        "",
        "",
        "",
        "미포함",
        "2026-10-07",
        "현장 확인 필요",
      ],
    ]);
    const preview = (
      await request(http)
        .post("/api/material-prices/imports/preview")
        .attach("file", buffer, "blank-price.xlsx")
        .expect(201)
    ).body;
    assert.equal(preview.summary.new, 1);
    assert.equal(preview.rows[0].price.priceRegistered, false);
    await request(http)
      .post(`/api/material-prices/imports/${preview.id}/apply`)
      .send({ mode: "전체" })
      .expect(201);
    const material = (
      await request(http).get("/api/standard-work")
    ).body.prices.find((p: { name: string }) => p.name === "미등록 단가 부속");
    const item = priceToQuoteItem(material, true);
    assert.equal(item.saleUnitPrice, 0);
    assert.equal(item.pricePending, true);
    assert.equal(material.priceRegistered, false);
  } finally {
    await app.close();
  }
});
