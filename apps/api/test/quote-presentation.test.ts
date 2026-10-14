import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { AppModule } from "../src/app.module";
import { CompanyContext, CompanyIdentity } from "../src/company-context";
import { QuotesService } from "../src/quotes.service";
import { QuoteExcelService } from "../src/quote-excel.service";
import { DEFAULT_COMPANY } from "@jongro/shared";
async function app() {
  const a = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  a.useBodyParser("json", { limit: "10mb" });
  a.setGlobalPrefix("api");
  await a.init();
  return a;
}
const binary = (
  res: NodeJS.ReadableStream,
  done: (err: Error | null, buffer: Buffer) => void,
) => {
  const parts: Buffer[] = [];
  res.on("data", (b) => parts.push(Buffer.from(b)));
  res.on("end", () => done(null, Buffer.concat(parts)));
};
test("회사·견적 스냅샷, PNG/JPG 직인, 고객 PDF/Excel, 복사와 회사 격리", async () => {
  const a = await app();
  try {
    const admin = request.agent(a.getHttpServer());
    await admin.post("/api/auth/demo").send({ account: "admin" }).expect(201);
    const company = (await admin.get("/api/company/current").expect(200)).body
      .company;
    const before = (await admin.get("/api/quotes/Q001").expect(200)).body;
    const png = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 4,
        background: { r: 180, g: 0, b: 0, alpha: 0.6 },
      },
    })
      .png()
      .toBuffer();
    const pngSeal = (
      await admin
        .post("/api/company/quote-assets/seal")
        .attach("file", png, {
          filename: "transparent.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body;
    assert.equal(pngSeal.dataUrl, pngSeal.originalDataUrl);
    assert.equal(pngSeal.backgroundRemoved, false);
    const red = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 200, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const jpg = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: red, left: 25, top: 25 }])
      .jpeg({ quality: 95 })
      .toBuffer();
    const seal = (
      await admin
        .post("/api/company/quote-assets/seal")
        .attach("file", jpg, {
          filename: "white.jpg",
          contentType: "image/jpeg",
        })
        .expect(201)
    ).body;
    assert.match(seal.dataUrl, /^data:image\/png/);
    assert.equal(seal.backgroundRemoved, true);
    const decoded = await sharp(
      Buffer.from(seal.dataUrl.split(",")[1], "base64"),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(decoded[3], 0);
    assert(decoded[(50 * 100 + 50) * 4] > 150);
    assert.equal(decoded[(50 * 100 + 50) * 4 + 3], 255);
    const logo = (
      await admin
        .post("/api/company/quote-assets/logo")
        .attach("file", png, { filename: "logo.png", contentType: "image/png" })
        .expect(201)
    ).body;
    const p = {
      ...company.quoteProfile,
      name: "검증 소방회사",
      representative: "검증대표",
      registrationNumber: "123-45-67890",
      address: "검증주소",
      phone: "02-111-2222",
      fax: "",
      email: "quote@example.test",
      website: "",
      contactName: "견적담당",
      contactPhone: "010-1234-5678",
      bankInfo: "검증은행 123-456",
      footer: "유효기간 내 확인 바랍니다.",
      logo,
      seal,
    };
    await admin
      .put("/api/company/settings")
      .send({
        ...company,
        name: p.name,
        address: p.address,
        phone: p.phone,
        email: p.email,
        quoteProfile: p,
      })
      .expect(200);
    assert.deepEqual(
      (await admin.get("/api/quotes/Q001")).body.companySnapshot,
      before.companySnapshot,
    );
    const input = {
      ...before,
      id: undefined,
      customerId: "",
      customerSnapshot: undefined,
      companySnapshot: undefined,
      siteId: null,
      siteName: "제출용 검증",
      address: "서울 중구 을지로 100",
      status: "작성중",
      workPeriod: "계약일부터 30일",
      sections: [
        before.sections[0],
        {
          kind: "전기",
          items: [
            {
              ...before.sections[0].items[0],
              trade: "소방전기",
              name: "감지기",
              specification: "연기식",
            },
          ],
        },
      ],
    };
    const q = (await admin.post("/api/quotes").send(input).expect(201)).body;
    assert.equal(q.customerName, "");
    assert.equal(q.companySnapshot.name, p.name);
    assert.equal(q.companySnapshot.phone, p.phone);
    const edited = (
      await admin
        .put("/api/quotes/" + q.id)
        .send({
          ...q,
          companySnapshot: { ...q.companySnapshot, phone: "02-999-8888" },
        })
        .expect(200)
    ).body;
    assert.equal(edited.companySnapshot.phone, "02-999-8888");
    await admin
      .put("/api/company/settings")
      .send({
        ...company,
        name: "이후 회사",
        quoteProfile: { ...p, name: "이후 회사", phone: "02-333-4444" },
      })
      .expect(200);
    const preserved = (await admin.get("/api/quotes/" + q.id)).body;
    assert.equal(preserved.companySnapshot.name, p.name);
    assert.equal(preserved.companySnapshot.phone, "02-999-8888");
    const clone = (
      await admin.post("/api/quotes/" + q.id + "/copy").expect(201)
    ).body;
    assert.deepEqual(clone.companySnapshot, preserved.companySnapshot);
    assert.deepEqual(clone.customerSnapshot, preserved.customerSnapshot);
    const dto = (
      await admin.get("/api/quotes/" + q.id + "/customer").expect(200)
    ).body;
    assert.equal(dto.companySnapshot.seal.dataUrl, seal.dataUrl);
    assert(!JSON.stringify(dto).includes("materialUnitCost"));
    assert(!JSON.stringify(dto).includes("margin"));
    const pdf = await admin
      .get("/api/quotes/" + q.id + "/pdf")
      .buffer(true)
      .parse(binary)
      .expect(200);
    assert.equal(pdf.body.subarray(0, 4).toString(), "%PDF");
    assert.match(pdf.body.toString("latin1"), /\/Subtype \/Image/);
    const excel = await admin
      .get("/api/quotes/" + q.id + "/excel")
      .buffer(true)
      .parse(binary)
      .expect(200);
    const files = unzipSync(excel.body);
    const all = Object.entries(files)
      .filter(([k]) => k.endsWith(".xml"))
      .map(([, v]) => strFromU8(v))
      .join("");
    assert.doesNotMatch(all, /갑지|을지\(|internalGeneralCost|margin/);
    assert.match(all, /02-999-8888/);
    assert.match(all, /을지로 100/);
    assert.doesNotMatch(all, /02-333-4444/);
    assert.deepEqual(
      files["xl/media/quoteseal.png"],
      new Uint8Array(Buffer.from(seal.dataUrl.split(",")[1], "base64")),
    );
    const wb = strFromU8(files["xl/workbook.xml"]);
    assert(wb.indexOf("견적 요약") < wb.indexOf("기계 상세 내역서"));
    assert(wb.indexOf("기계 상세 내역서") < wb.indexOf("전기 상세 내역서"));
    assert(!files["xl/media/image1.png"]);
    await admin
      .put("/api/quotes/" + q.id)
      .send({
        ...preserved,
        companySnapshot: { ...preserved.companySnapshot, companyId: "other" },
      })
      .expect(403);
    const worker = request.agent(a.getHttpServer());
    await worker
      .post("/api/auth/demo")
      .send({ account: "worker1" })
      .expect(201);
    assert(
      !(await worker.get("/api/company/current").expect(200)).body.company
        .quoteProfile,
    );
    const sessionCompany = (await admin.get("/api/auth/me").expect(200)).body
      .company;
    assert(!sessionCompany.quoteProfile);
    assert.match(sessionCompany.logoUrl, /^\/api\/company\/branding\/logo/);
    await admin.get(sessionCompany.logoUrl).expect(200);
    await admin
      .get(sessionCompany.logoUrl.replace("company=jongro", "company=other"))
      .expect(404);
    await worker
      .post("/api/company/quote-assets/seal")
      .attach("file", jpg, { filename: "seal.jpg" })
      .expect(403);
    const context = a.get(CompanyContext),
      foreign = {
        ...structuredClone(DEFAULT_COMPANY),
        id: "other",
        name: "다른회사",
        business: {
          ...DEFAULT_COMPANY.business,
          name: "다른회사",
          registrationNumber: "999-99-99999",
        },
        quoteTemplate: null,
        sealKey: null,
      };
    context.register(foreign);
    const identity: CompanyIdentity = {
      companyId: "other",
      userId: "other-admin",
      memberships: [
        { companyId: "other", userId: "other-admin", role: "admin" },
      ],
    };
    context.run(identity, () => {
      const service = a.get(QuotesService);
      const other = service.save({ ...input, companySnapshot: undefined });
      const x = a
        .get(QuoteExcelService)
        .generate(service.excelCustomer(other.id));
      const f = unzipSync(x);
      const xml = Object.values(f)
        .map((v) => strFromU8(v))
        .join("");
      assert(!f["xl/media/quoteseal.png"]);
      assert.doesNotMatch(xml, /검증 소방회사|647-86-00929/);
      assert.throws(() => service.find(q.id));
    });
  } finally {
    await a.close();
  }
});
test("거래처 입력 없음, 실제 검색/통계, 수정·삭제 후 스냅샷, 읽기 권한과 필터", async () => {
  const a = await app();
  try {
    const agent = request.agent(a.getHttpServer());
    await agent.post("/api/auth/demo").send({ account: "admin" }).expect(201);
    const seed = (await agent.get("/api/quotes/Q001")).body;
    const c = (
      await agent
        .post("/api/customers")
        .send({
          name: "삼성 검증",
          registrationNumber: "111-22-33333",
          contactName: "담당홍길동",
          phone: "010-2222-3333",
          address: "거래처 원주소",
        })
        .expect(201)
    ).body;
    const input = {
      ...seed,
      id: undefined,
      companySnapshot: undefined,
      customerSnapshot: undefined,
      customerId: c.id,
      siteName: "삼성 신규 검증",
      status: "검토중",
      siteId: null,
    };
    const q = (await agent.post("/api/quotes").send(input).expect(201)).body;
    assert.equal(q.customerName, c.name);
    assert.equal(q.customerSnapshot.phone, c.phone);
    const rows = (await agent.get("/api/customers")).body;
    assert.equal(rows.find((r: any) => r.id === c.id).quoteCount, 1);
    assert.equal(
      (await agent.get("/api/customers/" + c.id)).body.quotes.length,
      1,
    );
    await agent
      .put("/api/customers/" + c.id)
      .send({ ...c, name: "수정된 거래처", phone: "010-9999-8888" })
      .expect(200);
    assert.equal(
      (await agent.get("/api/quotes/" + q.id)).body.customerSnapshot.phone,
      c.phone,
    );
    assert.equal(
      (await agent.get("/api/quotes/" + q.id)).body.customerName,
      c.name,
    );
    await agent.delete("/api/customers/" + c.id).expect(200);
    await agent.get("/api/customers/" + c.id).expect(404);
    const old = (await agent.get("/api/quotes/" + q.id)).body;
    assert.equal(old.customerName, c.name);
    await agent
      .put("/api/quotes/" + q.id)
      .send({ ...old, notes: "삭제 후에도 수정 가능" })
      .expect(200);
    const results = (
      await agent
        .get(
          "/api/quotes?search=" +
            encodeURIComponent("삼성") +
            "&status=" +
            encodeURIComponent("검토중") +
            "&trade=" +
            encodeURIComponent("기계") +
            "&sort=amount",
        )
        .expect(200)
    ).body;
    assert(results.some((r: any) => r.id === q.id));
    assert(!results[0].companySnapshot);
    const index = (await agent.get("/api/quotes/index").expect(200)).body;
    assert(index.some((r: any) => r.id === q.id));
    assert(!JSON.stringify(index).includes("data:image"));
    assert(!JSON.stringify(index).includes("materialUnitCost"));
    await agent.get("/api/quotes?sort=bad").expect(400);
    const none = (
      await agent
        .post("/api/quotes")
        .send({
          ...input,
          customerId: "",
          customerSnapshot: undefined,
          siteName: "거래처 미입력",
          status: "작성중",
        })
        .expect(201)
    ).body;
    assert.equal(none.customerName, "");
    assert.equal(none.customerSnapshot.recipient, "");
    await agent.get("/api/quotes/" + none.id + "/pdf").expect(200);
    await agent.get("/api/quotes/" + none.id + "/excel").expect(200);
    const staff = request.agent(a.getHttpServer());
    await staff.post("/api/auth/demo").send({ account: "staff" }).expect(201);
    await staff.put("/api/customers/C001").send(c).expect(403);
    await staff.delete("/api/customers/C001").expect(403);
  } finally {
    await a.close();
  }
});
