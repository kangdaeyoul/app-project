import { createTestApp } from "./test-app";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { AuditLog, DEFAULT_COMPANY } from "@jongno/shared";
import { AppModule } from "../src/app.module";
import {
  CompanyContext,
  CompanyIdentity,
  SAMPLE_IDENTITY,
} from "../src/company-context";
import {
  COMPANY_IDENTITY,
  CompanyIdentityProvider,
} from "../src/company-identity";
import { AuditService } from "../src/audit.service";
import { AUDIT_REPOSITORY, AuditRepository } from "../src/audit.repository";
import { SitesService } from "../src/sites.service";
const parseBinary = (
  res: NodeJS.ReadableStream,
  done: (e: Error | null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
};
async function setup() {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}
async function logs(http: unknown, query = "") {
  return (
    await request(http as Parameters<typeof request>[0])
      .get("/api/audit-logs?pageSize=100" + query)
      .expect(200)
  ).body.items as AuditLog[];
}
test("주요 변경/자재/사진/파일/지급/계산서: 신뢰된 행위자, 전후 값, 실패 제외 및 삭제 후 이력", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    assert.equal((await logs(http)).length, 0);
    const seedSite = (await request(http).get("/api/sites/S001").expect(200))
      .body;
    const site = (
      await request(http)
        .post("/api/sites")
        .send({
          ...seedSite,
          name: "감사로그 검증 현장",
          description: "원래 공사",
          managerId: null,
          auditReason: "관리자 등록 검증",
          userId: "fake-user",
          userDisplayName: "위조 이름",
        })
        .expect(201)
    ).body;
    const siteCreated = (await logs(http)).find((r) => r.targetId === site.id)!;
    assert.equal(siteCreated.action, "생성");
    assert.equal(siteCreated.companyId, "jongno");
    assert.equal(siteCreated.userId, "sample-admin");
    assert.equal(siteCreated.userDisplayName, "샘플 관리자");
    assert.equal(siteCreated.reason, "관리자 등록 검증");
    assert.equal(siteCreated.before, null);
    await request(http)
      .put("/api/sites/" + site.id)
      .send({ ...site, description: "변경 공사" })
      .expect(200);
    const changed = (await logs(http)).find(
      (r) => r.targetId === site.id && r.action === "수정",
    )!;
    assert.equal((changed.before as any).description, "원래 공사");
    assert.equal((changed.after as any).description, "변경 공사");
    const size = (await logs(http)).length;
    await request(http)
      .put("/api/sites/" + site.id)
      .send({ ...site, contractAmount: -1 })
      .expect(400);
    assert.equal((await logs(http)).length, size);
    const seedQuote = (await request(http).get("/api/quotes/Q001").expect(200))
      .body;
    const q = (
      await request(http)
        .post("/api/quotes")
        .send({
          ...seedQuote,
          status: "작성중",
          siteId: site.id,
          siteName: "감사 견적",
          sections: seedQuote.sections.map((s: any) => ({
            ...s,
            items: s.items.map((i: any) => ({
              ...i,
              materialUnitCost: 987654321,
            })),
          })),
        })
        .expect(201)
    ).body;
    const copy = (
      await request(http)
        .post("/api/quotes/" + q.id + "/copy")
        .send({})
        .expect(201)
    ).body;
    const copied = (await logs(http)).find((r) => r.targetId === copy.id)!;
    assert.equal(copied.action, "복사");
    assert.match(copied.reason, new RegExp(q.id));
    assert.equal(copied.before, null);
    await request(http)
      .put("/api/quotes/" + q.id)
      .send({ ...q, status: "승인" })
      .expect(200);
    const converted = (
      await request(http)
        .post("/api/quotes/" + q.id + "/convert")
        .send({ startDate: site.startDate, endDate: site.endDate })
        .expect(201)
    ).body;
    let rows = await logs(http);
    assert.equal(
      rows.filter((r) => r.targetId === q.id && r.action === "계약전환").length,
      1,
    );
    assert.ok(
      rows
        .find((r) => r.targetId === q.id && r.action === "계약전환")!
        .siteIds.includes(converted.id),
    );
    await request(http)
      .post("/api/quotes/" + q.id + "/convert")
      .send({ startDate: site.startDate, endDate: site.endDate })
      .expect(201);
    assert.equal(
      (await logs(http)).filter(
        (r) => r.targetId === q.id && r.action === "계약전환",
      ).length,
      1,
    );
    await request(http)
      .delete("/api/quotes/" + copy.id)
      .expect(200);
    assert.equal(
      (
        (await logs(http)).find(
          (r) => r.targetId === copy.id && r.action === "삭제",
        )!.before as any
      ).sections[0].items[0].materialUnitCost,
      987654321,
    );
    const worker = (
      await request(http)
        .post("/api/workers")
        .send({
          name: "감사 작업자",
          displayName: "감사 작업자 소장",
          phone: "010-0000-0000",
          role: "소장",
          memo: "등록 메모",
          defaultAvailability: "근무가능",
        })
        .expect(201)
    ).body;
    await request(http)
      .put("/api/workers/" + worker.id)
      .send({ ...worker, memo: "수정 메모" })
      .expect(200);
    await request(http)
      .put("/api/sites/" + site.id)
      .send({ ...site, managerId: worker.id })
      .expect(200);
    const seedWork = (
      await request(http).get("/api/daily-work/D001").expect(200)
    ).body;
    let work = (
      await request(http)
        .post("/api/daily-work")
        .send({
          ...seedWork,
          siteId: site.id,
          managerId: worker.id,
          participantIds: [worker.id, "W002"],
          startTime: "",
          endTime: "",
          status: "작업예정",
          materials: [
            {
              name: "백관",
              specification: "25A",
              quantity: 18,
              unit: "m",
              notes: "",
            },
            {
              name: "엘보",
              specification: "25A",
              quantity: 8,
              unit: "개",
              notes: "",
            },
          ],
        })
        .expect(201)
    ).body;
    const oldMaterial = work.materials[0],
      deletedMaterial = work.materials[1];
    work = (
      await request(http)
        .put("/api/daily-work/" + work.id)
        .send({
          ...work,
          participantIds: [worker.id, "W002"],
          content: "수정 작업",
          materials: [
            { ...oldMaterial, quantity: 20 },
            {
              name: "티",
              specification: "25A",
              quantity: 3,
              unit: "개",
              notes: "",
            },
          ],
        })
        .expect(200)
    ).body;
    rows = await logs(http);
    const materialChange = rows.find(
      (r) => r.targetId === oldMaterial.id && r.action === "수정",
    )!;
    assert.equal((materialChange.before as any).quantity, 18);
    assert.equal((materialChange.after as any).quantity, 20);
    assert.ok(
      rows.some(
        (r) => r.targetId === deletedMaterial.id && r.action === "삭제",
      ),
    );
    assert.equal(
      rows.filter((r) => r.targetType === "사용자재" && r.action === "추가")
        .length,
      3,
    );
    await request(http)
      .post("/api/daily-work/" + work.id + "/start")
      .expect(201);
    await request(http)
      .post("/api/daily-work/" + work.id + "/finish")
      .expect(201);
    assert.ok(
      (await logs(http)).some(
        (r) => r.targetId === work.id && r.action === "상태변경",
      ),
    );
    const photoData = readFileSync(
      join(__dirname, "../fixtures/photos/sample-1.png"),
    );
    const pictures = (
      await request(http)
        .post("/api/photos/upload")
        .field("dailyWorkId", work.id)
        .field("type", "작업 전")
        .field("location", "3층")
        .field("description", "감사 사진")
        .field("uploadedBy", "사용자 입력 표시")
        .attach("files", photoData, {
          filename: "audit-1.png",
          contentType: "image/png",
        })
        .attach("files", photoData, {
          filename: "audit-2.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body;
    await request(http)
      .put("/api/photos/order")
      .send({
        dailyWorkId: work.id,
        type: "작업 전",
        ids: pictures.map((p: any) => p.id).reverse(),
      })
      .expect(200);
    await request(http)
      .get("/api/photos/" + pictures[0].id + "/file")
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    await request(http)
      .delete("/api/photos/" + pictures[0].id)
      .expect(200);
    rows = await logs(http);
    assert.ok(
      rows.some((r) => r.targetType === "사진" && r.action === "순서변경"),
    );
    assert.ok(
      rows.some(
        (r) =>
          r.targetId === pictures[0].storageKey &&
          r.action === "생성" &&
          r.siteIds.includes(site.id),
      ),
    );
    assert.ok(
      rows.some(
        (r) => r.targetId === pictures[0].storageKey && r.action === "다운로드",
      ),
    );
    assert.ok(
      rows.some(
        (r) => r.targetId === pictures[0].storageKey && r.action === "삭제",
      ),
    );
    assert.doesNotMatch(JSON.stringify(rows), /"type":"Buffer"|"data":\[/);
    const seedExpense = (
      await request(http).get("/api/expenses/E001").expect(200)
    ).body;
    const expense = (
      await request(http)
        .post("/api/expenses")
        .send({
          ...seedExpense,
          siteId: site.id,
          dailyWorkId: work.id,
          type: "작업진행자 대납 자재구매",
          description: "감사 자재구매",
          supplyAmount: 170000,
          vat: 17000,
          paymentMethod: "작업진행자 대납",
          isWorkerAdvance: true,
          workerId: worker.id,
          settled: false,
          settlementDate: null,
          evidenceType: "카드전표",
        })
        .expect(201)
    ).body;
    const edited = (
      await request(http)
        .put("/api/expenses/" + expense.id)
        .send({
          ...expense,
          supplyAmount: 200000,
          vat: 20000,
          evidenceType: "증빙없음",
        })
        .expect(200)
    ).body;
    assert.ok(
      (await logs(http)).some(
        (r) =>
          r.targetId === expense.id &&
          r.targetType === "증빙" &&
          r.action === "상태변경" &&
          (r.before as any)?.evidenceType === "카드전표",
      ),
    );
    const p1 = (
      await request(http)
        .post("/api/worker-payments")
        .send({
          siteId: site.id,
          workerId: worker.id,
          paymentDate: site.startDate,
          amount: 50000,
          notes: "일부 지급",
        })
        .expect(201)
    ).body;
    const p2 = (
      await request(http)
        .post("/api/worker-payments")
        .send({
          siteId: site.id,
          workerId: worker.id,
          paymentDate: site.startDate,
          fullPayment: true,
          notes: "전액 지급",
        })
        .expect(201)
    ).body;
    rows = await logs(http);
    assert.ok(
      rows.some(
        (r) =>
          r.targetType === "작업진행자 지급" &&
          r.action === "상태변경" &&
          (r.after as any).status === "일부지급",
      ),
    );
    assert.ok(
      rows.some(
        (r) =>
          r.targetType === "작업진행자 지급" &&
          r.action === "상태변경" &&
          (r.after as any).status === "지급완료",
      ),
    );
    await request(http)
      .delete("/api/worker-payments/" + p1.id)
      .expect(200);
    await request(http)
      .delete("/api/worker-payments/" + p2.id)
      .expect(200);
    await request(http)
      .delete("/api/expenses/" + expense.id)
      .expect(200);
    assert.equal(
      (
        (await logs(http)).find(
          (r) => r.targetId === expense.id && r.action === "삭제",
        )!.before as any
      ).totalAmount,
      edited.totalAmount,
    );
    const receipt = (
      await request(http)
        .post("/api/payments-received")
        .send({
          siteId: site.id,
          receivedDate: site.startDate,
          amount: 1000,
          method: "계좌이체",
          payer: "감사 입금자",
          notes: "",
        })
        .expect(201)
    ).body;
    await request(http)
      .put("/api/payments-received/" + receipt.id)
      .send({ ...receipt, amount: 2000 })
      .expect(200);
    await request(http)
      .delete("/api/payments-received/" + receipt.id)
      .expect(200);
    assert.equal(
      (
        (await logs(http)).find(
          (r) => r.targetId === receipt.id && r.action === "삭제",
        )!.before as any
      ).amount,
      2000,
    );
    const sale = (
      await request(http).get("/api/invoices/sales/S002").expect(200)
    ).body;
    await request(http)
      .put("/api/invoices/sales/S002")
      .send({
        ...sale,
        status: "발행완료",
        date: site.startDate,
        approvalNumber: "AUDIT-SALE",
        receiptIds: [],
      })
      .expect(200);
    const purchase = (
      await request(http).get("/api/invoices").expect(200)
    ).body.purchases.find((r: any) => r.expenseId === "E102");
    await request(http)
      .put("/api/invoices/purchases/E102")
      .send({
        ...purchase,
        status: "수취완료",
        date: site.startDate,
        approvalNumber: "AUDIT-PURCHASE",
      })
      .expect(200);
    const workerInvoice = (await request(http).get("/api/invoices").expect(200))
      .body.workers[0];
    await request(http)
      .put(
        `/api/invoices/workers/${workerInvoice.siteId}/${workerInvoice.workerId}`,
      )
      .send({
        ...workerInvoice,
        status: "발행완료",
        date: site.startDate,
        approvalNumber: "AUDIT-WORKER",
      })
      .expect(200);
    await request(http)
      .delete("/api/workers/" + worker.id)
      .expect(200);
    assert.ok(
      (await logs(http)).some(
        (r) =>
          r.targetId === worker.id &&
          r.action === "비활성화" &&
          r.siteIds.includes(site.id),
      ),
    );
    const binaryCount = (await logs(http)).filter(
      (r) => r.targetType === "파일",
    ).length;
    await request(http)
      .get("/api/quotes/Q001/pdf")
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    await request(http)
      .get("/api/quotes/Q001/excel")
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    await request(http)
      .post("/api/sites/S001/photo-reports/generate")
      .send({ layout: "페이지당 4장" })
      .buffer(true)
      .parse(parseBinary)
      .expect(201);
    rows = await logs(http);
    assert.ok(
      rows.filter((r) => r.targetType === "파일").length >= binaryCount + 6,
    );
    assert.ok(
      rows.some(
        (r) =>
          r.targetType === "세금계산서" &&
          r.action === "상태변경" &&
          (r.after as any).approvalNumber === "AUDIT-SALE",
      ),
    );
    await request(http)
      .delete("/api/sites/" + site.id)
      .expect(200);
    await request(http)
      .get("/api/sites/" + site.id)
      .expect(404);
    const history = (
      await request(http)
        .get("/api/sites/" + site.id + "/audit-logs?pageSize=100")
        .expect(200)
    ).body;
    assert.ok(
      history.items.some(
        (r: AuditLog) =>
          r.targetType === "현장" &&
          r.action === "삭제" &&
          (r.after as any).deletedAt,
      ),
    );
    assert.ok(
      history.items.every((r: AuditLog) => r.siteIds.includes(site.id)),
    );
    assert.ok(history.items.some((r: AuditLog) => r.targetId === expense.id));
    for (let i = 1; i < history.items.length; i++)
      assert.ok(history.items[i - 1].sequence > history.items[i].sequence);
    const copyRows = app.get<AuditRepository>(AUDIT_REPOSITORY).list("jongno");
    const first = copyRows[0];
    first.reason = "위조";
    assert.notEqual(
      app.get<AuditRepository>(AUDIT_REPOSITORY).list("jongno")[0].reason,
      "위조",
    );
  } finally {
    await app.close();
  }
});
test("날짜/사용자/현장/작업/대상 필터, 페이지, 무효 입력 및 없는 파일은 다운로드 기록 없음", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const site = (await request(http).get("/api/sites/S001")).body;
    await request(http)
      .put("/api/sites/S001")
      .send({ ...site, description: "필터 검증" })
      .expect(200);
    await request(http)
      .put("/api/sites/S002")
      .send({ ...site, name: "다른 필터 현장" })
      .expect(200);
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
    }).format(new Date());
    const filtered = await logs(
      http,
      `&from=${today}&to=${today}&userId=sample-admin&siteId=S001&action=${encodeURIComponent("수정")}&targetType=${encodeURIComponent("현장")}`,
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].targetId, "S001");
    const paged = (
      await request(http).get("/api/audit-logs?page=2&pageSize=1").expect(200)
    ).body;
    assert.equal(paged.total, 2);
    assert.equal(paged.items.length, 1);
    for (const q of [
      "from=2026-02-30",
      "from=2026-10-10&to=2026-10-01",
      "action=없음",
      "targetType=없음",
      "page=0",
      "pageSize=101",
      "userId[]=x",
    ])
      await request(http)
        .get("/api/audit-logs?" + q)
        .expect(400);
    const count = app
      .get<AuditRepository>(AUDIT_REPOSITORY)
      .list("jongno").length;
    await request(http).get("/api/photos/missing/file").expect(404);
    await request(http).get("/api/quotes/missing/excel").expect(404);
    assert.equal(
      app.get<AuditRepository>(AUDIT_REPOSITORY).list("jongno").length,
      count,
    );
  } finally {
    await app.close();
  }
});
test("회사 격리, 일반 사용자 현장 권한 및 내부 원가 차단, 동시 신원, 관리자 전체 권한", async () => {
  const app = await setup(),
    http = app.getHttpServer();
  try {
    const context = app.get(CompanyContext);
    context.register({
      ...structuredClone(DEFAULT_COMPANY),
      id: "other",
      name: "다른 회사",
      displayName: "다른 회사",
      quoteTemplate: null,
    });
    const other: CompanyIdentity = {
      companyId: "other",
      userId: "other-admin",
      userDisplayName: "다른 회사 관리자",
      memberships: [
        { companyId: "other", userId: "other-admin", role: "admin" },
      ],
    };
    const member: CompanyIdentity = {
      companyId: "jongno",
      userId: "member",
      userDisplayName: "현장 사용자",
      memberships: [{ companyId: "jongno", userId: "member", role: "member" }],
      accessibleSiteIds: ["S001"],
    };
    app.get<CompanyIdentityProvider>(COMPANY_IDENTITY).resolve = (
      raw: unknown,
    ) => {
      const headers = (raw as { headers: Record<string, string> }).headers;
      return headers["x-test-auth"] === "other"
        ? other
        : headers["x-test-auth"] === "member"
          ? member
          : structuredClone(SAMPLE_IDENTITY);
    };
    const seed = (await request(http).get("/api/sites/S001").expect(200)).body;
    const quote = (await request(http).get("/api/quotes/Q001").expect(200))
      .body;
    await request(http)
      .put("/api/quotes/Q001")
      .send({
        ...quote,
        notes: "권한 검증",
        sections: quote.sections.map((s: any) => ({
          ...s,
          items: s.items.map((i: any) => ({
            ...i,
            materialUnitCost: 987654321,
            laborUnitCost: 24681357,
          })),
        })),
      })
      .expect(200);
    await Promise.all([
      request(http)
        .put("/api/sites/S001")
        .set("x-test-auth", "member")
        .send({ ...seed, description: "회원 변경" })
        .expect(200),
      request(http)
        .post("/api/sites")
        .set("x-test-auth", "other")
        .send({
          ...seed,
          name: "다른 회사 현장",
          managerId: null,
          clientId: null,
        })
        .expect(201),
    ]);
    const first = await logs(http);
    assert.ok(first.every((r) => r.companyId === "jongno"));
    assert.ok(
      first.some(
        (r) => r.userId === "member" && r.userDisplayName === "현장 사용자",
      ),
    );
    const otherRows = (
      await request(http)
        .get("/api/audit-logs")
        .set("x-test-auth", "other")
        .expect(200)
    ).body.items;
    assert.equal(otherRows.length, 1);
    assert.ok(otherRows.every((r: AuditLog) => r.companyId === "other"));
    await request(http)
      .get("/api/audit-logs?siteId=S001")
      .set("x-test-auth", "member")
      .expect(403);
    await request(http)
      .get("/api/sites/S002/audit-logs")
      .set("x-test-auth", "member")
      .expect(403);
    await request(http)
      .get("/api/sites/S001/audit-logs")
      .set("x-test-auth", "other")
      .expect(200)
      .then((r) => assert.equal(r.body.total, 0));
    const moving = (await request(http).get("/api/daily-work/D001").expect(200))
      .body;
    const movingRecord=(await request(http).post('/api/daily-work').send({...moving,participantIds:moving.participants.map((p:any)=>p.workerId)}).expect(201)).body;
    await request(http)
      .put('/api/daily-work/'+movingRecord.id)
      .send({
        ...movingRecord,
        siteId: "S002",
        participantIds: moving.participants.map((p: any) => p.workerId),
        content: "권한 밖으로 옮긴 비밀 작업",
      })
      .expect(200);
    const allowed = (
      await request(http)
        .get("/api/sites/S001/audit-logs")
        .set("x-test-auth", "member")
        .expect(200)
    ).body;
    assert.ok(allowed.items.length);
    assert.doesNotMatch(
      JSON.stringify(allowed),
      /materialUnitCost|laborUnitCost|987654321|24681357/,
    );
    assert.match(JSON.stringify(first), /987654321/);
    assert.doesNotMatch(JSON.stringify(allowed), /권한 밖으로 옮긴 비밀 작업/);
    assert.ok(
      allowed.items.some(
        (r: AuditLog) =>
          r.targetType === "일일작업" && (r.after as any).restricted,
      ),
    );
    await request(http)
      .post("/api/sites")
      .set("x-test-auth", "member")
      .send({
        ...seed,
        name: "사용자 ID 위조 불가",
        userId: "admin",
        userDisplayName: "가짜",
      })
      .expect(201);
    assert.ok(
      (await logs(http)).some(
        (r) => r.userId === "member" && r.userDisplayName === "현장 사용자",
      ),
    );
    context.run({ ...member, accessibleSiteIds: [] }, () =>
      assert.throws(() => app.get(AuditService).list({}, "S001")),
    );
  } finally {
    await app.close();
  }
});
