import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { ForbiddenException } from "@nestjs/common";
import { QUOTE_ADMIN_ACCESS, QuoteAdminAccess } from "../src/quote-access";
import { AppModule } from "../src/app.module";
import {
  QuoteInput,
  QuoteView,
  calculateQuote,
  QUOTE_PRINT_MODES,
} from "@jongno/shared";
const parser = (
  res: NodeJS.ReadableStream,
  done: (err: Error | null, body: Buffer) => void,
) => {
  const b: Buffer[] = [];
  res.on("data", (c) => b.push(c));
  res.on("end", () => done(null, Buffer.concat(b)));
};
async function setup() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
test("견적 CRUD, 거래처/현장 연결, 세 가지 샘플, 검색 및 독립 복사", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const seeds = (await request(http).get("/api/quotes").expect(200))
      .body as QuoteView[];
    assert.equal(seeds.length, 3);
    assert.ok(
      seeds.some(
        (q) => q.sections.length === 1 && q.sections[0].kind === "기계",
      ),
    );
    assert.ok(
      seeds.some(
        (q) => q.sections.length === 1 && q.sections[0].kind === "전기",
      ),
    );
    assert.ok(seeds.some((q) => q.sections.length === 2));
    const client = (
      await request(http)
        .post("/api/customers")
        .send({
          name: "견적 테스트 거래처",
          address: "종로구",
          contactName: "담당자",
          phone: "010-0000-0000",
        })
        .expect(201)
    ).body;
    const input = {
      ...seeds.find((q) => q.id === "Q003")!,
      customerId: client.id,
      siteId: "S002",
      siteName: "신규 기계 전기 견적",
      status: "작성중",
    };
    const created = (
      await request(http).post("/api/quotes").send(input).expect(201)
    ).body as QuoteView;
    assert.equal(created.customerName, client.name);
    assert.equal(created.siteId, "S002");
    assert.equal(
      created.totals.totalAmount,
      calculateQuote(input as QuoteInput).totals.totalAmount,
    );
    input.siteName = "changed caller";
    assert.equal(
      (await request(http).get("/api/quotes/" + created.id)).body.siteName,
      "신규 기계 전기 견적",
    );
    const edited = (
      await request(http)
        .put("/api/quotes/" + created.id)
        .send({ ...created, notes: "수정 테스트", status: "수정요청" })
        .expect(200)
    ).body;
    assert.equal(edited.status, "수정요청");
    assert.equal(edited.notes, "수정 테스트");
    assert.equal(
      (
        await request(http)
          .get(
            "/api/quotes?search=" +
              encodeURIComponent(client.name) +
              "&status=" +
              encodeURIComponent("수정요청"),
          )
          .expect(200)
      ).body.length,
      1,
    );
    assert.equal(
      (
        await request(http)
          .get("/api/quotes?from=1990-01-01&to=1999-01-01")
          .expect(200)
      ).body.length,
      0,
    );
    const copy = (
      await request(http)
        .post("/api/quotes/" + created.id + "/copy")
        .expect(201)
    ).body;
    assert.notEqual(copy.id, created.id);
    assert.equal(copy.status, "작성중");
    assert.deepEqual(copy.sections, edited.sections);
    copy.sections[0].items[0].saleUnitPrice = 1;
    await request(http)
      .put("/api/quotes/" + copy.id)
      .send(copy)
      .expect(200);
    assert.notEqual(
      (await request(http).get("/api/quotes/" + created.id)).body.sections[0]
        .items[0].saleUnitPrice,
      1,
    );
    await request(http)
      .delete("/api/quotes/" + copy.id)
      .expect(200);
    await request(http)
      .get("/api/quotes/" + copy.id)
      .expect(404);
    await request(http)
      .delete("/api/quotes/" + created.id)
      .expect(200);
  } finally {
    await app.close();
  }
});
test("승인 견적 계약전환, 금액/거래처/공종 전달, 중복 방지와 원본 보호", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    await request(http)
      .post("/api/quotes/Q001/convert")
      .send({ startDate: "2026-10-06", endDate: "" })
      .expect(409);
    const q = (await request(http).get("/api/quotes/Q003")).body as QuoteView;
    const count = (await request(http).get("/api/sites")).body.length;
    const original = (await request(http).get("/api/sites/S003")).body;
    const site = (
      await request(http)
        .post("/api/quotes/Q003/convert")
        .send({ startDate: "2026-10-06", endDate: "2026-10-20" })
        .expect(201)
    ).body;
    assert.equal(site.contractAmount, q.totals.totalAmount);
    assert.equal(site.name, q.siteName);
    assert.equal(site.client, q.customerName);
    assert.equal(site.clientId, q.customerId);
    assert.equal(site.address, q.address);
    assert.equal(site.description, q.workContent);
    assert.deepEqual(site.trades, ["기계", "전기"]);
    assert.deepEqual(site.tradeNames, ["스프링클러", "자동화재탐지"]);
    assert.equal(
      (await request(http).get("/api/sites")).body.length,
      count + 1,
    );
    const again = (
      await request(http)
        .post("/api/quotes/Q003/convert")
        .send({ startDate: "2026-11-01", endDate: "" })
        .expect(201)
    ).body;
    assert.equal(again.id, site.id);
    assert.equal(
      (await request(http).get("/api/sites")).body.length,
      count + 1,
    );
    const converted = (await request(http).get("/api/quotes/Q003")).body;
    assert.equal(converted.status, "계약전환");
    assert.equal(converted.convertedSiteId, site.id);
    await request(http).put("/api/quotes/Q003").send(q).expect(409);
    await request(http).delete("/api/quotes/Q003").expect(409);
    const copy = (await request(http).post("/api/quotes/Q003/copy").expect(201))
      .body;
    assert.equal(copy.status, "작성중");
    assert.equal(copy.convertedSiteId, null);
    assert.deepEqual(
      (await request(http).get("/api/sites/S003")).body,
      original,
    );
    const { id, collectedAmount, unpaidWorkerAmount, ...input } = site;
    await request(http)
      .put("/api/sites/" + id)
      .send(input)
      .expect(200);
    assert.deepEqual(
      (await request(http).get("/api/sites/" + id)).body.trades,
      ["기계", "전기"],
    );
    assert.equal(
      (await request(http).get("/api/sites/" + site.id + "/finance")).body
        .contractAmount,
      q.totals.totalAmount,
    );
  } finally {
    await app.close();
  }
});
test("고객 DTO와 5가지 한글 PDF는 내부 원가에 영향받지 않는다", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const initial = (
      await request(http).get("/api/quotes/Q001/customer").expect(200)
    ).body;
    const q = (await request(http).get("/api/quotes/Q001")).body as QuoteView;
    const changed = structuredClone(q);
    changed.sections[0].items[0].materialUnitCost = 987654321;
    changed.sections[0].items[0].laborUnitCost = 24681357;
    changed.internalGeneralCost = 135791357;
    const edited = (
      await request(http).put("/api/quotes/Q001").send(changed).expect(200)
    ).body;
    assert.notEqual(edited.internal.totalCost, q.internal.totalCost);
    assert.deepEqual(edited.totals, q.totals);
    assert.deepEqual(
      (await request(http).get("/api/quotes/Q001/customer")).body,
      initial,
    );
    const serialized = JSON.stringify(initial);
    for (const key of [
      "materialUnitCost",
      "laborUnitCost",
      "expenseUnitCost",
      "internalGeneralCost",
      "internalSupportCost",
      "internal",
      "margin",
      "priceCategory",
    ])
      assert.ok(!serialized.includes('"' + key + '"'));
    for (const mode of QUOTE_PRINT_MODES) {
      const pdf = await request(http)
        .get("/api/quotes/Q001/pdf?mode=" + encodeURIComponent(mode))
        .buffer(true)
        .parse(parser)
        .expect(200)
        .expect("Content-Type", /application\/pdf/);
      assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.body.length > 5000);
      assert.ok(pdf.body.toString("latin1").includes("/FontFile2"));
      assert.ok(
        decodeURIComponent(pdf.headers["content-disposition"]).includes(
          "_견적서_",
        ),
      );
    }
    await request(http).get("/api/quotes/Q001/pdf?mode=invalid").expect(400);
    const many = {
      ...changed,
      siteName: "여러 페이지 견적 검증",
      sections: [
        {
          kind: "기계",
          items: Array.from({ length: 40 }, (_, index) => ({
            ...changed.sections[0].items[0],
            name: `배관 항목 ${index + 1}`,
            notes: index === 39 ? "긴 고객 비고 ".repeat(100) : "",
          })),
        },
      ],
    };
    const large = (
      await request(http).post("/api/quotes").send(many).expect(201)
    ).body;
    const pages = await request(http)
      .get("/api/quotes/" + large.id + "/pdf")
      .buffer(true)
      .parse(parser)
      .expect(200);
    assert.ok(
      (pages.body.toString("latin1").match(/\/Type \/Page\b/g) || []).length >=
        4,
    );
    app.get<QuoteAdminAccess>(QUOTE_ADMIN_ACCESS).assertAdmin = () => {
      throw new ForbiddenException("관리자 권한이 필요합니다.");
    };
    await request(http).get("/api/quotes").expect(403);
    await request(http).get("/api/quotes/Q001").expect(403);
    await request(http).put("/api/quotes/Q001").send(changed).expect(403);
    assert.deepEqual(
      (await request(http).get("/api/quotes/Q001/customer").expect(200)).body,
      initial,
    );
    await request(http)
      .get("/api/quotes/Q001/pdf")
      .buffer(true)
      .parse(parser)
      .expect(200);
  } finally {
    await app.close();
  }
});
test("견적 입력/관계/범위 검증은 저장 전 실패하고 원장을 보존한다", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const q = (await request(http).get("/api/quotes/Q001")).body;
    const item = q.sections[0].items[0];
    for (const patch of [
      { customerId: "missing" },
      { siteId: "missing" },
      { status: "계약전환" },
      { status: "unknown" },
      { quoteDate: "2026-02-30" },
      { validUntil: "1999-01-01" },
      { rounding: "invalid" },
      { sections: [] },
      { sections: [q.sections[0], q.sections[0]] },
      { generalFee: -1 },
      { sections: [{ kind: "기계", items: [{ ...item, quantity: 0 }] }] },
      { sections: [{ kind: "기계", items: [{ ...item, quantity: 0.0001 }] }] },
      {
        sections: [{ kind: "기계", items: [{ ...item, saleUnitPrice: 1.5 }] }],
      },
      {
        sections: [
          {
            kind: "기계",
            items: [
              {
                ...item,
                quantity: 1000000,
                saleUnitPrice: Number.MAX_SAFE_INTEGER,
              },
            ],
          },
        ],
      },
      { sections: [{ kind: "기계", items: [{ ...item, name: "" }] }] },
    ]) {
      const result = await request(http)
        .put("/api/quotes/Q001")
        .send({ ...q, ...patch });
      assert.ok([400, 404].includes(result.status));
    }
    assert.deepEqual((await request(http).get("/api/quotes/Q001")).body, q);
    await request(http).post("/api/customers").send({ name: "" }).expect(400);
    await request(http).get("/api/quotes?from=2026-02-30").expect(400);
    await request(http)
      .post("/api/quotes/Q003/convert")
      .send({ startDate: "2026-02-30", endDate: "" })
      .expect(400);
    await request(http).get("/api/quotes/unknown").expect(404);
  } finally {
    await app.close();
  }
});
test("견적 금액은 소수 수량, 원가 분리, 천원 반올림 및 합계 일치를 보장한다", () => {
  const input: QuoteInput = {
    customerId: "C001",
    siteId: null,
    siteName: "test",
    address: "",
    workContent: "",
    quoteDate: "2026-10-06",
    validUntil: "2026-10-30",
    status: "작성중",
    notes: "",
    generalFee: 10,
    supportFee: 20,
    internalGeneralCost: 7,
    internalSupportCost: 3,
    rounding: "반올림 없음",
    displayUnit: "만원",
    sections: [
      {
        kind: "기계",
        items: [
          {
            trade: "기계",
            name: "배관",
            specification: "25A",
            quantity: 1.125,
            unit: "m",
            materialUnitCost: 100,
            laborUnitCost: 20,
            expenseUnitCost: 5,
            saleUnitPrice: 1234,
            priceCategory: "재료비",
            notes: "",
          },
        ],
      },
    ],
  };
  const a = calculateQuote(input);
  assert.equal(a.totals.material, 1388);
  assert.equal(a.totals.supplyAmount, 1418);
  assert.equal(a.totals.vat, 142);
  assert.equal(a.totals.totalAmount, 1560);
  assert.equal(a.internal.totalCost, 152);
  const b = calculateQuote({ ...input, rounding: "천원 반올림" });
  assert.equal(b.totals.totalAmount, 2000);
  assert.equal(b.totals.supplyAmount + b.totals.vat, 2000);
  assert.equal(
    b.totals.material +
      b.totals.labor +
      b.totals.expense +
      b.totals.generalFee +
      b.totals.supportFee +
      b.totals.adjustment,
    b.totals.supplyAmount,
  );
  assert.equal(b.internal.totalCost, a.internal.totalCost);
});
