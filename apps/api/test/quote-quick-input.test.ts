import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import {
  accumulateQuoteItems,
  priceToQuoteItem,
  DEFAULT_COMPANY,
} from "@jongno/shared";
import { AppModule } from "../src/app.module";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { StandardWorkService } from "../src/standard-work.service";
test("빠른입력 동일품목 누적, 규격 분리, 수정단가 보존, 자동/수동 정책 및 OFF", () => {
  const p = {
    id: "M1",
    companyId: "jongno",
    name: "백관",
    specification: "25A",
    unit: "m",
    category: "재료비" as const,
    cost: 100,
    salePrice: 200,
  };
  const a = priceToQuoteItem(p),
    b = priceToQuoteItem(p, true, "favorite");
  const rows = accumulateQuoteItems([a], [b, b]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  assert.deepEqual(rows[0].entrySources, ["catalog", "favorite"]);
  assert.equal(a.quantity, 1);
  const changed = { ...rows[0], saleUnitPrice: 777 };
  assert.equal(
    accumulateQuoteItems(
      [changed],
      [priceToQuoteItem({ ...p, salePrice: 900 })],
    )[0].saleUnitPrice,
    777,
  );
  assert.equal(
    accumulateQuoteItems([a], [{ ...b, specification: "32A" }]).length,
    2,
  );
  assert.equal(accumulateQuoteItems([a], [{ ...b, unit: "개" }]).length, 2);
  assert.equal(
    accumulateQuoteItems([a], [{ ...b, name: "다른품목" }]).length,
    2,
  );
  assert.equal(
    accumulateQuoteItems([a], [{ ...b, materialCode: "M2" }]).length,
    2,
  );
  assert.equal(accumulateQuoteItems([a], [b], false).length, 2);
  const manual = { ...a, entrySources: ["manual" as const] };
  assert.equal(accumulateQuoteItems([a], [manual], true, false).length, 2);
  assert.equal(accumulateQuoteItems([a], [manual], true, true)[0].quantity, 2);
  assert.equal(
    accumulateQuoteItems(
      [a],
      [{ ...b, entrySources: ["standard"] }],
      true,
      false,
    ).length,
    1,
  );
  assert.equal(priceToQuoteItem(p, false).saleUnitPrice, 0);
});
test("회사 즐겨찾기 순서·검증·권한·격리, 회사 기본값 및 표준작업 공통 합산", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const data = (await request(http).get("/api/standard-work").expect(200))
      .body;
    const initial = (
      await request(http).get("/api/standard-work/favorites").expect(200)
    ).body;
    assert(initial.priceIds.length >= 10);
    assert.equal(initial.userId, null);
    const ids = initial.priceIds.slice().reverse();
    assert.deepEqual(
      (
        await request(http)
          .put("/api/standard-work/favorites")
          .send({ priceIds: ids })
          .expect(200)
      ).body.priceIds,
      ids,
    );
    await request(http)
      .put("/api/standard-work/favorites")
      .send({ priceIds: [ids[0], ids[0]] })
      .expect(400);
    await request(http)
      .put("/api/standard-work/favorites")
      .send({ priceIds: ["unknown"] })
      .expect(400);
    await request(http)
      .put("/api/company/quote-preferences")
      .send({ autoPrice: false })
      .expect(200);
    assert.equal(
      (await request(http).get("/api/company/current")).body.company
        .quotePreferences.autoPrice,
      false,
    );
    const template = data.templates.find(
      (t: { name: string }) => t.name === "화재감지기 증설",
    );
    const calc = (
      await request(http)
        .post(`/api/standard-work/${template.id}/calculate`)
        .send({
          quantity: 1,
          lengths: { 배선: 0, 배관: 0 },
          reuse: [],
          overrides: {},
        })
        .expect(201)
    ).body;
    const merged = accumulateQuoteItems(calc.items, calc.items);
    assert.equal(merged.length, calc.items.length);
    for (let i = 0; i < merged.length; i++)
      assert.equal(
        merged[i].quantity,
        calc.items[i].quantity * (calc.items[i].accumulation === "max" ? 1 : 2),
      );
    const price = data.prices.find(
      (p: { id: string }) => p.id === merged[0].materialCode,
    );
    const withFav = accumulateQuoteItems(merged, [
      priceToQuoteItem(price, true, "favorite"),
    ]);
    assert.equal(withFav[0].quantity, 3);
    const seed = (await request(http).get("/api/quotes")).body[0];
    const saved = (
      await request(http)
        .post("/api/quotes")
        .send({
          ...seed,
          status: "작성중",
          mergeDuplicates: true,
          mergeAcrossSources: false,
          sections: [{ kind: "전기", items: withFav }],
        })
        .expect(201)
    ).body;
    assert.equal(saved.autoPrice, false);
    assert.equal(saved.mergeAcrossSources, false);
    assert.equal(saved.sections[0].items[0].materialCode, price.id);
    assert(saved.sections[0].items[0].entrySources.includes("favorite"));
    const publicQ = (
      await request(http).get(`/api/quotes/${saved.id}/customer`)
    ).body;
    assert(
      !/entrySources|standardSources|materialCode|UnitCost/.test(
        JSON.stringify(publicQ),
      ),
    );
    const context = app.get(CompanyContext),
      service = app.get(StandardWorkService);
    context.register({ ...DEFAULT_COMPANY, id: "favorite-other" });
    context.run(
      {
        companyId: "favorite-other",
        userId: "a",
        memberships: [
          { companyId: "favorite-other", userId: "a", role: "admin" },
        ],
      },
      () => {
        assert.deepEqual(service.favorites().priceIds, []);
        assert.throws(() => service.saveFavorites({ priceIds: ids }));
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
      () => assert.throws(() => service.saveFavorites({ priceIds: [] })),
    );
  } finally {
    await app.close();
  }
});
