import { createTestApp } from "./test-app";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { DEFAULT_WORK_NAMES } from "../src/standard-work-defaults";
import { CompanyContext, SAMPLE_IDENTITY } from "../src/company-context";
import { StandardWorkService } from "../src/standard-work.service";
import {
  DEFAULT_COMPANY,
  StandardWork,
  WorkPrice,
  QuoteItemInput,
  accumulateQuoteItems,
  priceToQuoteItem,
} from "@jongno/shared";
const base = {
  quantity: 1,
  lengths: { 배선: 0, 배관: 0 },
  reuse: [],
  overrides: {},
  autoPrice: true,
};
const measurements = {
  routeLength: 10,
  wireStrands: 2,
  wireSlack: 3,
  conduitLength: 10,
  locations: 5,
  connections: 10,
  couplings: 3,
  fixingInterval: 2,
  screwsPerFixing: 2,
  anchorsPerFixing: 1,
  pipeLength: 12,
  circuits: 10,
};
test("통합 표준작업: 전체 기본 작업군·실제산출·미등록 단가·시공조건·공유경로·승인·견적/출력/회사 보존", async () => {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  try {
    const data = (await request(http).get("/api/standard-work").expect(200))
      .body as { templates: StandardWork[]; prices: WorkPrice[] };
    assert.equal(data.templates.length, DEFAULT_WORK_NAMES.length);
    for (const name of DEFAULT_WORK_NAMES)
      assert(data.templates.some((t) => t.name === name));
    assert(
      data.templates.every(
        (t) => t.integrated && t.reviewStatus === "검토필요",
      ),
    );
    assert(
      data.prices.every(
        (p) => p.cost === 0 && p.salePrice === 0 && p.priceRegistered === false,
      ),
    );
    const find = (name: string) => data.templates.find((t) => t.name === name)!;
    const calculate = async (
      name: string,
      quantity: number,
      estimate: object = {},
      conditions: object = {},
    ) =>
      (
        await request(http)
          .post(`/api/standard-work/${find(name).id}/calculate`)
          .send({ ...base, quantity, estimate, conditions })
          .expect(201)
      ).body;
    const qty = (items: QuoteItemInput[], name: string) =>
      items.find((i) => i.name === name)?.quantity;
    const quoteFixture = (await request(http).get("/api/quotes").expect(200))
      .body[0];
    for (const [name, count] of [
      ["화재감지기 증설", 5],
      ["유도등 교체", 3],
      ["유도등 신설", 3],
      ["발신기세트 교체", 2],
      ["수신반 교체", 1],
      ["스프링클러헤드 증설", 6],
      ["스프링클러헤드 이설", 10],
      ["소방 보조펌프 교체", 1],
      ["소방배관 누수보수", 1],
      ["완강기 설치", 1],
    ] as const) {
      const calc = await calculate(name, count, measurements);
      const scenarioQuote = (
        await request(http)
          .post("/api/quotes")
          .send({
            ...quoteFixture,
            status: "작성중",
            siteName: `시험 ${name} ${count}`,
            sections: [{ kind: calc.section, items: calc.items }],
          })
          .expect(201)
      ).body;
      const persisted = (
        await request(http).get(`/api/quotes/${scenarioQuote.id}`).expect(200)
      ).body;
      assert.equal(persisted.sections[0].items.length, calc.items.length);
      assert.deepEqual(
        persisted.sections[0].items.map((i: QuoteItemInput) => [
          i.name,
          i.quantity,
          i.saleUnitPrice,
          i.quantityPending,
        ]),
        calc.items.map((i: QuoteItemInput) => [
          i.name,
          i.quantity,
          i.saleUnitPrice,
          i.quantityPending ?? false,
        ]),
      );

      assert(
        calc.items.some((i: QuoteItemInput) => i.priceCategory === "노무비"),
      );
      assert(
        calc.items.some((i: QuoteItemInput) => i.priceCategory === "경비"),
      );
      assert(
        calc.items.some(
          (i: QuoteItemInput) =>
            i.customerGroup === "부속류" || i.customerGroup === "배관 및 부속",
        ),
      );
      assert(
        calc.items.every(
          (i: QuoteItemInput) => i.saleUnitPrice === 0 && i.pricePending,
        ),
      );
      assert(calc.warnings.some((w: string) => w.includes("예시수량")));
    }
    let d = await calculate("화재감지기 증설", 5, measurements);
    assert.equal(qty(d.items, "화재감지기(연기식)"), 5);
    assert.equal(qty(d.items, "소방용전선"), 23);
    assert.equal(qty(d.items, "강재전선관"), 10);
    assert.equal(qty(d.items, "아웃렛박스"), 5);
    assert.equal(qty(d.items, "새들"), 5);
    assert.equal(qty(d.items, "피스류"), 10);
    assert(!d.items.some((i: QuoteItemInput) => i.name === "감지기 베이스"));
    const unmeasured = await calculate("화재감지기 증설", 5);
    assert(
      unmeasured.items.some(
        (i: QuoteItemInput) =>
          i.name === "소방용전선" && i.quantity === 0 && i.quantityPending,
      ),
    );
    const pendingWires = await calculate("화재감지기 증설", 5, {
      ...measurements,
      wireSpec: "HFIX 2.5SQ",
      conduitType: "SF",
    });
    assert(
      pendingWires.items.some(
        (i: QuoteItemInput) =>
          i.name === "소방용전선" && i.specification === "HFIX 2.5SQ",
      ),
    );
    assert(
      pendingWires.items.some((i: QuoteItemInput) => i.name.includes("(SF)")),
    );
    assert(
      pendingWires.items
        .filter((i: QuoteItemInput) =>
          ["전선관 커넥터", "아웃렛박스", "새들"].includes(i.name),
        )
        .every((i: QuoteItemInput) => i.specification === "SF 16mm"),
    );
    const reused = await calculate(
      "화재감지기 증설",
      5,
      { ...measurements, concealed: true },
      { reusePiping: true, reuseEquipment: true },
    );
    assert(reused.items.some((i: QuoteItemInput) => i.name === "소방용전선"));
    assert(
      !reused.items.some(
        (i: QuoteItemInput) =>
          i.name.includes("전선관(SF)") ||
          i.name === "강재전선관" ||
          i.name === "화재감지기(연기식)" ||
          i.name === "새들",
      ),
    );
    assert(reused.items.some((i: QuoteItemInput) => i.name === "접속단자"));
    assert(
      reused.items.some((i: QuoteItemInput) => i.priceCategory === "노무비"),
    );
    const kit = await calculate("발신기세트 교체", 2, measurements);
    for (const name of ["발신기", "지구경종", "표시등", "발신기함"])
      assert.equal(qty(kit.items, name), 2);
    const complete = await calculate("발신기세트 교체", 2, {
      ...measurements,
      kitMode: "complete",
    });
    assert.equal(qty(complete.items, "발신기세트 완제품"), 2);
    assert(
      !complete.items.some((i: QuoteItemInput) =>
        ["발신기", "지구경종", "표시등", "발신기함"].includes(i.name),
      ),
    );
    const receiver = await calculate("수신반 교체", 1, {
      ...measurements,
      receiverType: "R형",
      programming: true,
      relaySetup: true,
      communicationTest: true,
      interlockTest: true,
    });
    assert.equal(qty(receiver.items, "결선노무"), 0.4);
    for (const name of [
      "R형 수신반",
      "프로그램 수정",
      "중계기 설정",
      "통신확인",
      "연동시험",
    ])
      assert(receiver.items.some((i: QuoteItemInput) => i.name === name));
    assert(
      receiver.items.some((i: QuoteItemInput) => i.name === "회로용 결선전선"),
    );
    const head = await calculate("스프링클러헤드 증설", 6, {
      ...measurements,
      manualQuantities: { 티: 6, 엘보: 6, 니플: 6 },
      headOrientation: "하향식",
      flexible: true,
    });
    assert.equal(qty(head.items, "스프링클러헤드"), 6);
    assert.equal(qty(head.items, "스프링클러 조인트"), 6);
    assert.equal(qty(head.items, "배관용탄소강관 백관"), 12);
    assert.equal(qty(head.items, "티"), 6);
    const up = await calculate("스프링클러헤드 증설", 6, {
      ...measurements,
      headOrientation: "상향식",
      flexible: true,
    });
    assert(
      !up.items.some((i: QuoteItemInput) => i.name === "스프링클러 조인트"),
    );
    const moved = await calculate(
      "스프링클러헤드 이설",
      10,
      { ...measurements, headOrientation: "하향식", flexible: true },
      { reuseEquipment: true },
    );
    assert(
      !moved.items.some((i: QuoteItemInput) => i.name === "스프링클러헤드"),
    );
    assert.equal(qty(moved.items, "스프링클러 조인트"), 10);
    const cpvc = await calculate("스프링클러헤드 증설", 6, {
      ...measurements,
      pipeType: "CPVC",
      jointMethod: "CPVC",
      manualQuantities: { 티: 6, 엘보: 3 },
    });
    assert.equal(qty(cpvc.items, "CPVC 티"), 6);
    assert(!cpvc.items.some((i: QuoteItemInput) => i.name === "니플"));
    const grooved = await calculate("스프링클러헤드 증설", 6, {
      ...measurements,
      jointMethod: "그루빙",
      manualQuantities: { 티: 6, 커플링: 2 },
    });
    assert.equal(qty(grooved.items, "그루브 티"), 6);
    assert.equal(qty(grooved.items, "그루브 커플링"), 2);
    assert(!grooved.items.some((i: QuoteItemInput) => i.name === "니플"));
    const connector = find("화재감지기 증설").components.find(
      (c) => c.selector === "electrical-accessory:전선관 커넥터",
    )!;
    const wrong = await calculate("화재감지기 증설", 5, {
      ...measurements,
      conduitType: "GW",
      materialSelections: { [connector.id]: connector.variants!["강재|16mm"] },
    });
    assert(wrong.warnings.some((w: string) => w.includes("규격이 서로 맞지")));
    const composite = (
      await request(http)
        .post("/api/standard-work/composite")
        .send({
          batchId: "동일 현장",
          autoPrice: true,
          routes: [{ id: "공통 주경로", options: measurements }],
          tasks: [
            ["화재감지기 증설", 5],
            ["유도등 신설", 3],
          ].map(([name, count], n) => ({
            id: String(n),
            templateId: find(name as string).id,
            request: {
              ...base,
              quantity: count,
              estimate: { routeGroup: "공통 주경로" },
            },
          })),
        })
        .expect(201)
    ).body;
    const items = composite.sections[0].items;
    assert.equal(qty(items, "화재감지기(연기식)"), 5);
    assert.equal(qty(items, "유도등"), 3);
    assert.equal(qty(items, "소방용전선"), 23);
    assert.equal(qty(items, "강재전선관"), 10);
    assert.equal(qty(items, "전기 잡자재"), 1);
    assert.equal(qty(items, "회로시험 및 동작확인"), 1);
    assert.equal(qty(items, "아웃렛박스"), 5);
    const repeated = accumulateQuoteItems(d.items, d.items);
    assert.equal(qty(repeated, "화재감지기(연기식)"), 10);
    assert.equal(qty(repeated, "전기 잡자재"), 1);
    const prior = {
      ...d.items[0],
      saleUnitPrice: 7777,
      quantity: 9,
      manualQuantity: true,
    };
    assert.equal(
      accumulateQuoteItems([prior], [d.items[0]])[0].saleUnitPrice,
      7777,
    );
    assert.equal(
      accumulateQuoteItems(
        [prior],
        [
          priceToQuoteItem(
            data.prices.find((p) => p.id === prior.materialCode)!,
            true,
            "favorite",
          ),
        ],
      )[0].quantity,
      10,
    );
    const material = data.prices.find((p) => p.id === d.items[0].materialCode)!;
    await request(http)
      .put(`/api/standard-work/prices/${material.id}`)
      .send({ ...material, cost: 9000, salePrice: 12345 })
      .expect(200);
    d = await calculate("화재감지기 증설", 5, measurements);
    assert.equal(d.items[0].saleUnitPrice, 12345);
    const off = (
      await request(http)
        .post(`/api/standard-work/${find("화재감지기 증설").id}/calculate`)
        .send({
          ...base,
          quantity: 5,
          estimate: measurements,
          autoPrice: false,
        })
        .expect(201)
    ).body;
    assert(
      off.items.every(
        (i: QuoteItemInput) =>
          i.saleUnitPrice === 0 &&
          i.materialUnitCost === 0 &&
          i.laborUnitCost === 0 &&
          i.pricePending,
      ),
    );
    const oldQuote = (await request(http).get("/api/quotes")).body[0];
    const oldStored = (await request(http).get(`/api/quotes/${oldQuote.id}`))
      .body;
    const quote = (
      await request(http)
        .post("/api/quotes")
        .send({
          ...oldQuote,
          status: "작성중",
          siteName: "통합 자동견적 시험",
          groupComponents: true,
          sections: [
            {
              kind: "전기",
              items: [{ ...prior, quantity: 7 }, ...unmeasured.items.slice(1)],
            },
          ],
        })
        .expect(201)
    ).body;
    const reopened = (
      await request(http).get(`/api/quotes/${quote.id}`).expect(200)
    ).body;
    assert.equal(reopened.sections[0].items[0].saleUnitPrice, 7777);
    assert.equal(reopened.sections[0].items[0].quantity, 7);
    assert.equal(reopened.sections[0].items[0].manualQuantity, true);
    assert(
      reopened.sections[0].items.some((i: QuoteItemInput) => i.quantityPending),
    );
    await request(http)
      .put(`/api/quotes/${quote.id}`)
      .send({ ...reopened, status: "제출완료" })
      .expect(400);
    const customer = (
      await request(http).get(`/api/quotes/${quote.id}/customer`).expect(200)
    ).body;
    assert(
      !/UnitCost|margin|priceSnapshot|calculationBasis|materialCode|standardSource/.test(
        JSON.stringify(customer),
      ),
    );
    assert(customer.notes.includes("현장산출 필요"));
    assert(
      customer.sections[0].items.some(
        (i: { name: string }) => i.name === "부속류",
      ),
    );
    await request(http).get(`/api/quotes/${quote.id}/pdf`).expect(200);
    await request(http).get(`/api/quotes/${quote.id}/excel`).expect(200);
    const fixedTemplate = (
      await request(http)
        .post("/api/standard-work")
        .send({
          ...find("화재감지기 증설"),
          name: "관리자 고정수량 작업",
          components: [
            {
              ...find("화재감지기 증설").components[0],
              quantityRule: undefined,
              variants: undefined,
              selector: undefined,
              mode: "고정수량",
              factor: 3,
            },
          ],
        })
        .expect(201)
    ).body;
    const fixedCalc = (
      await request(http)
        .post(`/api/standard-work/${fixedTemplate.id}/calculate`)
        .send({ ...base, quantity: 8 })
        .expect(201)
    ).body;
    assert.equal(fixedCalc.items[0].quantity, 3);
    const approved = (
      await request(http)
        .put(`/api/standard-work/${find("화재감지기 증설").id}`)
        .send({
          ...find("화재감지기 증설"),
          reviewStatus: "사용승인",
          reason: "실제 구성품 검토",
        })
        .expect(200)
    ).body;
    assert(approved.reviewedAt && approved.reviewedBy);
    assert.equal(
      (await calculate("화재감지기 증설", 5, measurements)).reviewStatus,
      "사용승인",
    );
    assert.deepEqual(
      (
        await request(http)
          .post("/api/standard-work/initialize-defaults")
          .send({})
          .expect(201)
      ).body,
      { templateCount: 0, materialCount: 0 },
    );
    assert.deepEqual(
      (await request(http).get(`/api/quotes/${oldQuote.id}`)).body,
      oldStored,
    );
    assert.equal(
      (await request(http).get(`/api/quotes/${quote.id}`)).body.sections[0]
        .items[0].saleUnitPrice,
      7777,
    );
    const archived = find("압력계 교체");
    await request(http).delete(`/api/standard-work/${archived.id}`).expect(200);
    await request(http)
      .post("/api/standard-work/initialize-defaults")
      .send({})
      .expect(201);
    assert(
      !(await request(http).get("/api/standard-work")).body.templates.some(
        (t: StandardWork) => t.id === archived.id,
      ),
    );
    const ctx = app.get(CompanyContext),
      svc = app.get(StandardWorkService);
    ctx.register({ ...DEFAULT_COMPANY, id: "integrated-other" });
    ctx.run(
      {
        companyId: "integrated-other",
        userId: "a",
        memberships: [
          { companyId: "integrated-other", userId: "a", role: "admin" },
        ],
      },
      () => {
        assert.equal(svc.list().templates.length, 0);
        assert.throws(() => svc.calculate(find("화재감지기 증설").id, base));
        assert.equal(
          svc.initializeDefaults().templateCount,
          DEFAULT_WORK_NAMES.length,
        );
        assert.equal(svc.initializeDefaults().templateCount, 0);
        assert(
          svc
            .list()
            .prices.every(
              (p) =>
                p.companyId === "integrated-other" &&
                p.priceRegistered === false,
            ),
        );
        assert.throws(() =>
          svc.calculate(svc.list().templates[0].id, {
            ...base,
            estimate: { materialSelections: { C1: material.id } },
          }),
        );
      },
    );
    ctx.run(
      {
        ...SAMPLE_IDENTITY,
        memberships: [
          {
            companyId: "jongno",
            userId: SAMPLE_IDENTITY.userId,
            role: "member",
          },
        ],
      },
      () => {
        assert.throws(() => svc.initializeDefaults());
        assert.throws(() =>
          svc.composite({ batchId: "a", tasks: [], routes: [] }),
        );
      },
    );
    await request(http)
      .post(`/api/standard-work/${find("화재감지기 증설").id}/calculate`)
      .send({ ...base, estimate: { wireStrands: -1 } })
      .expect(400);
  } finally {
    await app.close();
  }
});

test("기본+추가 노무 누적 및 공유경로 수동수량·시공조건 보호", () => {
  const item = priceToQuoteItem({
    id: "L",
    companyId: "jongno",
    name: "전기공 노무",
    specification: "",
    unit: "인",
    category: "노무비",
    cost: 0,
    salePrice: 0,
  });
  const first = {
    ...item,
    quantity: 0.7,
    laborBasis: { templateId: "T", base: 0.5, extra: 0.1, workQuantity: 3 },
    constructionKey: "노출|노무:T",
  };
  const second = {
    ...first,
    quantity: 0.6,
    laborBasis: { ...first.laborBasis, workQuantity: 2 },
  };
  assert.equal(accumulateQuoteItems([first], [second])[0].quantity, 0.9);
  assert.equal(
    accumulateQuoteItems([first], [second])[0].laborBasis?.workQuantity,
    5,
  );
  assert.equal(
    accumulateQuoteItems(
      [first],
      [{ ...second, constructionKey: "은폐|노무:T" }],
    ).length,
    2,
  );
  const shared = {
    ...item,
    quantity: 12,
    manualQuantity: true,
    accumulation: "max" as const,
    accumulationScope: "batch|route",
    quantityPending: false,
  };
  assert.equal(
    accumulateQuoteItems(
      [shared],
      [
        {
          ...shared,
          quantity: 0,
          manualQuantity: false,
          quantityPending: true,
        },
      ],
    )[0].quantity,
    12,
  );
  assert.equal(
    accumulateQuoteItems(
      [shared],
      [
        {
          ...shared,
          quantity: 0,
          manualQuantity: false,
          quantityPending: true,
        },
      ],
    )[0].quantityPending,
    false,
  );
  assert.equal(
    accumulateQuoteItems(
      [shared],
      [{ ...shared, accumulationScope: "another|route" }],
    ).length,
    2,
  );
});
