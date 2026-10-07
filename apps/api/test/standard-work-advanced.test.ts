import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import {
  DEFAULT_COMPANY,
  accumulateQuoteItems,
  priceToQuoteItem,
} from "@jongno/shared";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { StandardWorkService } from "../src/standard-work.service";
const input = {
  quantity: 5,
  lengths: { 배선: 0, 배관: 0 },
  reuse: [],
  overrides: {},
  conditions: {
    workType: "증설",
    installation: "노출",
    reuseWiring: false,
    reusePiping: false,
    reuseEquipment: false,
    ceiling: "텍스",
    height: 3,
    night: false,
    demolition: true,
  },
  autoPrice: true,
};
test("작업세트 생성·수정·복사·순서·삭제 및 조건·최신 단가·견적 합산·고객 출력·회사 격리", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const data = (await request(http).get("/api/standard-work")).body;
    assert.equal(data.templates.length, 16);
    assert(
      data.templates.every(
        (t: { active: boolean; workType: string }) => t.active && t.workType,
      ),
    );
    const seed = data.templates.find(
      (t: { name: string }) => t.name === "화재감지기 증설",
    );
    const copy = (
      await request(http)
        .post(`/api/standard-work/${seed.id}/copy`)
        .send({})
        .expect(201)
    ).body;
    assert.notEqual(copy.id, seed.id);
    assert.equal(copy.version, 1);
    assert(copy.name.endsWith("(복사)"));
    const create = {
      ...seed,
      name: "현장 특화 감지기 증설",
      description: "텍스 천장 야간 조건 예시",
      baseQuantity: 2,
      conditions: [{ key: "height", operator: "이상", value: 2 }],
      reason: "관리자 신규 작업세트",
      components: [
        ...seed.components,
        {
          ...seed.components[0],
          id: "night-labor",
          priceId: data.prices.find(
            (p: { category: string }) => p.category === "노무비",
          ).id,
          role: "설치노무",
          factor: 0.2,
          includeWhen: [{ key: "night", operator: "같음", value: true }],
          excludeWhen: [
            { key: "ceiling", operator: "같음", value: "콘크리트" },
          ],
          customerGroup: "설치 및 결선비",
        },
      ],
    };
    const custom = (
      await request(http).post("/api/standard-work").send(create).expect(201)
    ).body;
    assert.equal(custom.version, 1);
    assert.equal(custom.components.length, seed.components.length + 1);
    let c = (
      await request(http)
        .post(`/api/standard-work/${custom.id}/calculate`)
        .send(input)
        .expect(201)
    ).body;
    assert(
      !c.items.some(
        (i: { standardSource: { componentId: string } }) =>
          i.standardSource.componentId === "night-labor",
      ),
    );
    c = (
      await request(http)
        .post(`/api/standard-work/${custom.id}/calculate`)
        .send({ ...input, conditions: { ...input.conditions, night: true } })
        .expect(201)
    ).body;
    assert(
      c.items.some(
        (i: { standardSource: { componentId: string } }) =>
          i.standardSource.componentId === "night-labor",
      ),
    );
    const omitted = (
      await request(http)
        .post(`/api/standard-work/${custom.id}/calculate`)
        .send({
          ...input,
          conditions: {
            ...input.conditions,
            night: true,
            ceiling: "콘크리트",
            reuseWiring: true,
            reusePiping: true,
            reuseEquipment: true,
            demolition: false,
          },
        })
        .expect(201)
    ).body;
    assert(
      !omitted.items.some((i: { name: string }) =>
        ["화재감지기", "소방용전선", "전선관"].includes(i.name),
      ),
    );
    assert(
      !omitted.items.some(
        (i: { standardSource: { componentId: string } }) =>
          i.standardSource.componentId === "night-labor",
      ),
    );
    await request(http)
      .post(`/api/standard-work/${custom.id}/calculate`)
      .send({ ...input, conditions: { ...input.conditions, height: 1 } })
      .expect(400);
    const firstPrice = data.prices.find(
      (p: { id: string }) => p.id === seed.components[0].priceId,
    );
    await request(http)
      .put(`/api/standard-work/prices/${firstPrice.id}`)
      .send({ ...firstPrice, salePrice: 43210 })
      .expect(200);
    const latest = (
      await request(http)
        .post(`/api/standard-work/${custom.id}/calculate`)
        .send({ ...input, quantity: 3 })
        .expect(201)
    ).body;
    assert.equal(latest.items[0].saleUnitPrice, 43210);
    const off = (
      await request(http)
        .post(`/api/standard-work/${custom.id}/calculate`)
        .send({ ...input, autoPrice: false })
        .expect(201)
    ).body;
    assert(
      off.items.every(
        (i: {
          saleUnitPrice: number;
          materialUnitCost: number;
          laborUnitCost: number;
        }) =>
          i.saleUnitPrice === 0 &&
          i.materialUnitCost === 0 &&
          i.laborUnitCost === 0,
      ),
    );
    const two = (
      await request(http)
        .post(`/api/standard-work/${custom.id}/calculate`)
        .send({ ...input, quantity: 2 })
        .expect(201)
    ).body;
    const existing = latest.items.map((i: object, n: number) =>
      n ? i : { ...i, saleUnitPrice: 7777 },
    );
    const merged = accumulateQuoteItems(existing, two.items);
    assert.equal(merged[0].quantity, 5);
    assert.equal(merged[0].saleUnitPrice, 7777);
    assert.equal(merged.find((i) => i.name === "소방용전선")?.quantity, 35);
    assert.equal(merged.find((i) => i.name === "잡자재")?.quantity, 2);
    assert.equal(
      accumulateQuoteItems(merged, [
        priceToQuoteItem(firstPrice, true, "favorite"),
      ])[0].quantity,
      6,
    );
    const quoteSeed = (await request(http).get("/api/quotes")).body[0];
    const saved = (
      await request(http)
        .post("/api/quotes")
        .send({
          ...quoteSeed,
          status: "작성중",
          groupComponents: true,
          sections: [{ kind: "전기", items: merged }],
        })
        .expect(201)
    ).body;
    const customer = (
      await request(http).get(`/api/quotes/${saved.id}/customer`).expect(200)
    ).body;
    assert(!/UnitCost|margin|standardSource/.test(JSON.stringify(customer)));
    assert(
      customer.sections[0].items.some(
        (i: { name: string }) => i.name === "설치 및 결선비",
      ),
    );
    await request(http).get(`/api/quotes/${saved.id}/pdf`).expect(200);
    await request(http).get(`/api/quotes/${saved.id}/excel`).expect(200);
    const reversed = {
      ...custom,
      components: custom.components.slice().reverse(),
      reason: "구성품 순서 변경",
      active: false,
    };
    const v2 = (
      await request(http)
        .put(`/api/standard-work/${custom.id}`)
        .send(reversed)
        .expect(200)
    ).body;
    assert.equal(v2.version, 2);
    assert.equal(v2.components[0].id, "night-labor");
    await request(http)
      .post(`/api/standard-work/${custom.id}/calculate`)
      .send(input)
      .expect(409);
    await request(http)
      .put(`/api/standard-work/${custom.id}`)
      .send({ ...v2, active: true, reason: "재활성화" })
      .expect(200);
    await request(http).delete(`/api/standard-work/${custom.id}`).expect(200);
    assert(
      !(await request(http).get("/api/standard-work")).body.templates.some(
        (t: { id: string }) => t.id === custom.id,
      ),
    );
    const history = (
      await request(http)
        .get(`/api/standard-work/${custom.id}/history`)
        .expect(200)
    ).body;
    assert.equal(history.length, 4);
    assert(history.at(-1).deletedAt);
    assert.equal(
      (await request(http).get(`/api/quotes/${saved.id}`)).body.sections[0]
        .items[0].saleUnitPrice,
      7777,
    );
    const context = app.get(CompanyContext),
      svc = app.get(StandardWorkService);
    context.register({ ...DEFAULT_COMPANY, id: "advanced-other" });
    context.run(
      {
        companyId: "advanced-other",
        userId: "a",
        memberships: [
          { companyId: "advanced-other", userId: "a", role: "admin" },
        ],
      },
      () => {
        assert.equal(svc.list().templates.length, 0);
        assert.throws(() => svc.copy(seed.id));
        assert.throws(() => svc.create(create));
        assert.throws(() => svc.history(custom.id));
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
      () => assert.throws(() => svc.create(create)),
    );
  } finally {
    await app.close();
  }
});
