import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { NestFactory } from "@nestjs/core";
import { DEFAULT_COMPANY, Company } from "@jongno/shared";
import { AppModule } from "../src/app.module";
import {
  CompanyContext,
  CompanyIdentity,
  SAMPLE_IDENTITY,
} from "../src/company-context";
import { SITES_REPOSITORY, SitesRepository } from "../src/sites.repository";
import {
  WORKERS_REPOSITORY,
  WorkersRepository,
} from "../src/workers.repository";
import {
  CUSTOMERS_REPOSITORY,
  CustomersRepository,
} from "../src/customers.repository";
import { QUOTES_REPOSITORY, QuotesRepository } from "../src/quotes.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "../src/daily-work.repository";
import { PHOTO_REPOSITORY, PhotoRepository } from "../src/photo.repository";
import {
  EXPENSES_REPOSITORY,
  ExpensesRepository,
} from "../src/expenses.repository";
import {
  FINANCE_REPOSITORY,
  FinanceRepository,
} from "../src/finance.repository";
import {
  INVOICES_REPOSITORY,
  InvoicesRepository,
} from "../src/invoices.repository";
import { FILE_STORAGE, FileStorage } from "../src/file-storage";
import {
  PHOTO_REPORT_STORAGE,
  PhotoReportStorage,
} from "../src/photo-report-storage";
import { CompanyTemplateResolver } from "../src/company-template";
import { QuotesService } from "../src/quotes.service";
import { DailyWorkService } from "../src/daily-work.service";
import { SitesService } from "../src/sites.service";
import { QuotePdfService } from "../src/quote-pdf.service";
import {
  COMPANY_IDENTITY,
  CompanyIdentityProvider,
} from "../src/company-identity";
import { QUOTE_ADMIN_ACCESS, QuoteAdminAccess } from "../src/quote-access";
const other: Company = {
  ...structuredClone(DEFAULT_COMPANY),
  id: "other",
  name: "다른 소방 주식회사",
  displayName: "다른 소방",
  quoteTemplate: null,
};
const identity: CompanyIdentity = {
  companyId: "other",
  userId: "other-admin",
  memberships: [{ companyId: "other", userId: "other-admin", role: "admin" }],
};
test("회사별 전체 저장소/자식 데이터/동일 ID/파일/출력 양식/권한 및 비동기 문맥 분리", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  try {
    const context = app.get(CompanyContext);
    context.register(other);
    const sites = app.get<SitesRepository>(SITES_REPOSITORY),
      workers = app.get<WorkersRepository>(WORKERS_REPOSITORY),
      customers = app.get<CustomersRepository>(CUSTOMERS_REPOSITORY),
      quotes = app.get<QuotesRepository>(QUOTES_REPOSITORY),
      daily = app.get<DailyWorkRepository>(DAILY_WORK_REPOSITORY),
      photos = app.get<PhotoRepository>(PHOTO_REPOSITORY),
      expenses = app.get<ExpensesRepository>(EXPENSES_REPOSITORY),
      finance = app.get<FinanceRepository>(FINANCE_REPOSITORY),
      invoices = app.get<InvoicesRepository>(INVOICES_REPOSITORY),
      files = app.get<FileStorage>(FILE_STORAGE),
      reports = app.get<PhotoReportStorage>(PHOTO_REPORT_STORAGE);
    const originalQuote = quotes.find("Q001")!,
      originalWork = daily.find("D001")!,
      originalPhoto = photos.find("P001")!,
      originalReceipt = finance.receipts()[0],
      originalExpense = expenses.list()[0];
    assert.equal(sites.list().length, 5);
    files.put("same-key", {
      buffer: Buffer.from("jongno"),
      mimeType: "text/plain",
    });
    reports.put("same-report", Buffer.from("jongno"));
    await context.run(identity, async () => {
      for (const repo of [
        sites,
        workers,
        customers,
        quotes,
        daily,
        photos,
        expenses,
      ])
        assert.deepEqual(repo.list(), []);
      assert.deepEqual(finance.receipts(), []);
      assert.deepEqual(finance.payments(), []);
      assert.deepEqual(finance.allocations(), []);
      assert.equal(invoices.sale("S001"), undefined);
      assert.equal(invoices.purchase(originalExpense.id), undefined);
      assert.equal(invoices.worker("S001", "W001"), undefined);
      assert.equal(files.get("sample-1.png"), undefined);
      assert.equal(files.get("same-key"), undefined);
      assert.equal(reports.get("same-report"), undefined);
      assert.throws(() => app.get(SitesService).find("S001"));
      assert.throws(() =>
        app
          .get(DailyWorkService)
          .create({ ...originalWork, participantIds: [] }),
      );
      assert.throws(() =>
        app.get(QuotesService).save({ ...originalQuote, status: "작성중" }),
      );
      assert.throws(() => app.get(CompanyTemplateResolver).quotePath());
      const customer = customers.create({
        name: "다른 회사 거래처",
        address: "",
        contactName: "",
        phone: "",
      });
      const worker = workers.create({
        name: "다른 작업자",
        displayName: "다른 소장",
        phone: "",
        role: "소장",
        memo: "",
        defaultAvailability: "근무가능",
      });
      const site = sites.create({
        name: "다른 현장",
        client: customer.name,
        address: "주소",
        description: "공사",
        contactName: "",
        phone: "",
        startDate: "2026-10-06",
        endDate: "2026-10-06",
        contractAmount: 1000,
        status: "미배정",
        manager: null,
        managerId: null,
      });
      assert.equal(workers.availability("W001").length, 0);
      assert.equal(workers.work("W001").length, 0);
      const q = app.get(QuotesService).save({
        ...originalQuote,
        customerId: customer.id,
        siteId: site.id,
        status: "작성중",
        siteName: "다른 견적",
      });
      const pdf = await app.get(QuotePdfService).render(q.id, "전체 상세");
      assert.ok(pdf.buffer.length > 1000);
      const work = app.get(DailyWorkService).create({
        ...originalWork,
        siteId: site.id,
        managerId: worker.id,
        participantIds: [worker.id],
        materials: [
          {
            name: "회사별 자재",
            specification: "25A",
            quantity: 1,
            unit: "m",
            notes: "",
          },
        ],
      });
      assert.equal(work.materialCount, 1);
      assert.equal(work.beforePhotoCount, 0);
      photos.save({ ...originalPhoto, dailyWorkId: work.id });
      assert.equal(daily.find(work.id)!.beforePhotoCount, 1);
      expenses.save(
        { ...originalExpense, siteId: site.id, supplyAmount: 222, vat: 22 },
        { expenseId: originalExpense.id, quantity: 1, unit: "식" },
        {
          expenseId: originalExpense.id,
          workerId: worker.id,
          displayName: worker.displayName,
        },
      );
      assert.equal(expenses.find(originalExpense.id)!.totalAmount, 244);
      const originalInvoice = invoices.sale("S001");
      assert.equal(originalInvoice, undefined);
      invoices.saveWorker({
        siteId: site.id,
        workerId: worker.id,
        status: "발행완료",
        date: "2026-10-06",
        approvalNumber: "OTHER",
        notes: "",
      });
      assert.equal(
        invoices.worker(site.id, worker.id)!.approvalNumber,
        "OTHER",
      );
      finance.savePayment(
        {
          id: "other-pay",
          siteId: site.id,
          workerId: worker.id,
          paymentDate: "2026-10-06",
          amount: 100,
          notes: "",
          createdAt: new Date().toISOString(),
        },
        [
          {
            paymentId: "other-pay",
            expenseId: originalExpense.id,
            amount: 100,
          },
        ],
      );
      assert.equal(finance.payments()[0].amount, 100);
      assert.equal(finance.allocations()[0].expenseId, originalExpense.id);
      finance.saveReceipt({ ...originalReceipt, siteId: site.id, amount: 111 });
      assert.equal(finance.receipts().length, 1);
      // Even identical IDs are partitioned; editing a same-ID record never changes another company.
      quotes.save({ ...q, id: "Q001" });
      assert.equal(quotes.find("Q001")!.siteName, "다른 견적");
      files.put("same-key", {
        buffer: Buffer.from("other"),
        mimeType: "text/plain",
      });
      reports.put("same-report", Buffer.from("other"));
      assert.throws(() =>
        customers.create({
          name: "bad",
          address: "",
          contactName: "",
          phone: "",
          companyId: "jongno",
        } as never),
      );
    });
    assert.equal(quotes.find("Q001")!.siteName, originalQuote.siteName);
    assert.equal(photos.find("P001")!.dailyWorkId, "D001");
    assert.equal(files.get("same-key")!.buffer.toString(), "jongno");
    assert.equal(reports.get("same-report")!.toString(), "jongno");
    assert.equal(finance.receipts()[0].amount, originalReceipt.amount);
    assert.throws(() =>
      context.run({ ...identity, memberships: [] }, () => sites.list()),
    );
    const viewer = {
      ...identity,
      memberships: [
        { companyId: "other", userId: "other-admin", role: "viewer" as const },
      ],
    };
    context.run(viewer, () => {
      assert.ok(sites.list().length);
      assert.throws(() =>
        customers.create({
          name: "denied",
          address: "",
          contactName: "",
          phone: "",
        }),
      );
      assert.throws(() =>
        app.get<QuoteAdminAccess>(QUOTE_ADMIN_ACCESS).assertAdmin(),
      );
    });
    const member = {
      ...identity,
      memberships: [
        { companyId: "other", userId: "other-admin", role: "member" as const },
      ],
    };
    context.run(member, () =>
      assert.throws(() =>
        app.get<QuoteAdminAccess>(QUOTE_ADMIN_ACCESS).assertAdmin(),
      ),
    );
    await Promise.all([
      context.run(identity, async () => {
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(context.companyId, "other");
        assert.equal(files.get("same-key")!.buffer.toString(), "other");
      }),
      context.run(SAMPLE_IDENTITY, async () => {
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(context.companyId, "jongno");
        assert.equal(files.get("same-key")!.buffer.toString(), "jongno");
      }),
    ]);
    assert.equal(context.companyId, "jongno");
    assert.equal(
      expenses.find(originalExpense.id)!.totalAmount,
      originalExpense.totalAmount,
    );
    assert.equal(finance.payments().length, 0);
  } finally {
    await app.close();
  }
});
test("HTTP 샘플 회사 유지, 회사 헤더/본문 위조 차단, 회사 설정 조회", async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  try {
    const http = app.getHttpServer();
    const settings = await request(http)
      .get("/api/company/current")
      .expect(200);
    assert.equal(settings.body.company.id, "jongno");
    assert.equal(settings.body.appBrand.provisional, true);
    await request(http)
      .get("/api/sites")
      .set("x-company-id", "other")
      .expect(403);
    await request(http)
      .post("/api/customers")
      .send({ name: "위조", companyId: "other" })
      .expect(403);
    await request(http).get("/api/quotes/Q001/excel").expect(200);
    await request(http).get("/api/photos/P001/file").expect(200);
    const context = app.get(CompanyContext);
    context.register(other);
    // Trusted fake authentication only in this app instance; browser company claims alone still do not select a tenant.
    app.get<CompanyIdentityProvider>(COMPANY_IDENTITY).resolve = (
      req: unknown,
    ) =>
      (req as { headers: Record<string, string> }).headers["x-test-auth"] ===
      "other"
        ? structuredClone(identity)
        : structuredClone(SAMPLE_IDENTITY);
    const own = await request(http)
      .get("/api/company/current")
      .set("x-test-auth", "other")
      .expect(200);
    assert.equal(own.body.company.id, "other");
    const empty = await request(http)
      .get("/api/sites")
      .set("x-test-auth", "other")
      .expect(200);
    assert.deepEqual(empty.body, []);
    await request(http)
      .get("/api/sites/S001")
      .set("x-test-auth", "other")
      .expect(404);
    await request(http)
      .get("/api/photos/P001/file")
      .set("x-test-auth", "other")
      .expect(404);
    await request(http)
      .get("/api/quotes/Q001/excel")
      .set("x-test-auth", "other")
      .expect(404);
    await request(http)
      .post("/api/customers")
      .set("x-test-auth", "other")
      .send({ name: "HTTP 다른 회사", address: "", contactName: "", phone: "" })
      .expect(201);
    const otherCustomers = await request(http)
      .get("/api/customers")
      .set("x-test-auth", "other")
      .expect(200);
    assert.equal(otherCustomers.body.length, 1);
    const firstCustomers = await request(http)
      .get("/api/customers")
      .expect(200);
    assert.equal(firstCustomers.body.length, 5);
  } finally {
    await app.close();
  }
});
