import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { StandardWorkService } from "../src/standard-work.service";
import { DEFAULT_COMPANY, StandardWork } from "@jongno/shared";
const input = {
  quantity: 5,
  lengths: { 배선: 0, 배관: 0 },
  reuse: [],
  overrides: {},
};
test("기본 작업군 및 기존 계산방식, 다중 구성품 수량·재사용·직접입력·버전·회사 격리 및 고객 출력", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const data = (await request(http).get("/api/standard-work").expect(200))
      .body;
    assert.ok(data.templates.length > 100);
    assert.equal(
      new Set(data.templates.map((t: StandardWork) => t.name)).size,
      data.templates.length,
    );
    const updatedSeed = data.templates.find(
      (t: StandardWork) => t.name === "화재감지기 증설",
    );
    // Retain regression coverage of user-created legacy calculation modes.
    const legacy = (
      await request(http).get(`/api/standard-work/${updatedSeed.id}/history`)
    ).body[0];
    const detector = (
      await request(http)
        .post("/api/standard-work")
        .send({ ...legacy, name: "과거 방식 감지기 증설", integrated: false })
        .expect(201)
    ).body;
    let calc = (
      await request(http)
        .post(`/api/standard-work/${detector.id}/calculate`)
        .send(input)
        .expect(201)
    ).body;
    const q = (name: string) =>
      calc.items.find((i: { name: string }) => i.name === name)?.quantity;
    assert.equal(q("화재감지기"), 5);
    assert.equal(q("소방용전선"), 35);
    assert.equal(q("전선관"), 25);
    assert.equal(q("잡자재"), 1);
    assert.equal(
      calc.items
        .filter((i: { priceCategory: string }) => i.priceCategory === "노무비")
        .reduce((s: number, i: { quantity: number }) => s + i.quantity, 0),
      0.8,
    );
    const original = calc;
    calc = (
      await request(http)
        .post(`/api/standard-work/${detector.id}/calculate`)
        .send({
          ...input,
          reuse: ["기존 감지기 재사용", "기존 간선 활용", "기존 배관 활용"],
        })
        .expect(201)
    ).body;
    assert.equal(q("화재감지기"), undefined);
    assert.equal(q("소방용전선"), undefined);
    assert.equal(q("전선관"), undefined);
    for (const name of [
      "발신기세트 교체",
      "수신반 교체",
      "스프링클러헤드 증설",
    ]) {
      const t = data.templates.find((t: StandardWork) => t.name === name);
      assert.ok(t.components.length >= 8);
    }
    const component = detector.components[0];
    component.mode = "관리자 직접입력";
    detector.reason = "과거 견적 분석 기준 보정";
    const v2 = (
      await request(http)
        .put(`/api/standard-work/${detector.id}`)
        .send(detector)
        .expect(200)
    ).body;
    assert.equal(v2.version, 2);
    await request(http)
      .put(`/api/standard-work/${detector.id}`)
      .send(detector)
      .expect(409);
    await request(http)
      .post(`/api/standard-work/${detector.id}/calculate`)
      .send(input)
      .expect(400);
    calc = (
      await request(http)
        .post(`/api/standard-work/${detector.id}/calculate`)
        .send({ ...input, overrides: { [component.id]: 9 } })
        .expect(201)
    ).body;
    assert.equal(q("화재감지기"), 9);
    const h = (
      await request(http)
        .get(`/api/standard-work/${detector.id}/history`)
        .expect(200)
    ).body;
    assert.equal(h.length, 2);
    assert.equal(h[0].components[0].mode, "작업수량에 비례");
    assert.ok(h[0].priceSnapshot.length);
    const seed = (await request(http).get("/api/quotes").expect(200)).body[0];
    const quote = {
      ...seed,
      status: "작성중",
      groupComponents: true,
      sections: [{ kind: "전기", items: original.items }],
    };
    const saved = (
      await request(http).post("/api/quotes").send(quote).expect(201)
    ).body;
    const customer = (
      await request(http).get(`/api/quotes/${saved.id}/customer`).expect(200)
    ).body;
    assert.ok(
      customer.sections[0].items.some(
        (i: { name: string }) => i.name === "부속류",
      ),
    );
    assert.ok(
      !customer.sections[0].items.some(
        (i: { name: string }) => i.name === "단자류",
      ),
    );
    assert.equal(customer.totals.totalAmount, saved.totals.totalAmount);
    assert.ok(
      !/materialUnitCost|laborUnitCost|standardSource|priceSnapshot|margin/.test(
        JSON.stringify(customer),
      ),
    );
    const pdf = await request(http)
      .get(`/api/quotes/${saved.id}/pdf`)
      .expect(200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    await request(http).get(`/api/quotes/${saved.id}/excel`).expect(200);
    const fixed = structuredClone(v2);
    fixed.reason = "고정 및 길이 기준 검증";
    fixed.components[1].mode = "고정수량";
    fixed.components[1].factor = 12;
    await request(http)
      .put(`/api/standard-work/${detector.id}`)
      .send(fixed)
      .expect(200);
    const adjusted = (
      await request(http)
        .post(`/api/standard-work/${detector.id}/calculate`)
        .send({
          ...input,
          lengths: { 배선: 100, 배관: 18 },
          overrides: { [component.id]: 3 },
        })
        .expect(201)
    ).body;
    assert.equal(
      adjusted.items.find((i: { name: string }) => i.name === "소방용전선")
        .quantity,
      12,
    );
    assert.equal(
      adjusted.items.find((i: { name: string }) => i.name === "전선관")
        .quantity,
      18,
    );
    const oldPrice = data.prices[0];
    await request(http)
      .put(`/api/standard-work/prices/${oldPrice.id}`)
      .send({ ...oldPrice, cost: 9999, salePrice: 15000 })
      .expect(200);
    const historic = (
      await request(http)
        .get(`/api/standard-work/${detector.id}/history`)
        .expect(200)
    ).body;
    assert.equal(
      historic[0].priceSnapshot.find(
        (p: { id: string }) => p.id === oldPrice.id,
      ).cost,
      oldPrice.cost,
    );
    const unchanged = (
      await request(http).get(`/api/quotes/${saved.id}`).expect(200)
    ).body;
    assert.equal(
      unchanged.sections[0].items[0].materialUnitCost,
      original.items[0].materialUnitCost,
    );
    await request(http)
      .post("/api/standard-work/prices")
      .send({
        name: "추가 단자",
        specification: "표준",
        unit: "개",
        category: "재료비",
        cost: 500,
        salePrice: 800,
      })
      .expect(201);
    const context = app.get(CompanyContext),
      service = app.get(StandardWorkService);
    context.register({
      ...DEFAULT_COMPANY,
      id: "other-work",
      name: "다른 회사",
    });
    context.run(
      {
        companyId: "other-work",
        userId: "other",
        memberships: [
          { companyId: "other-work", userId: "other", role: "admin" },
        ],
      },
      () => {
        assert.equal(service.list().templates.length, 0);
        assert.throws(() => service.calculate(detector.id, input));
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
      () => assert.throws(() => service.list()),
    );
    await request(http)
      .post(`/api/standard-work/${detector.id}/calculate`)
      .send({ ...input, quantity: -1 })
      .expect(400);
  } finally {
    await app.close();
  }
});
