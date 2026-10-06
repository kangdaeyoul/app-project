import {
  INSPECTION_REPORT_REPOSITORY,
  MemoryInspectionReportRepository,
} from "./inspection-report.repository";
import {
  INSPECTION_REPORT_STORAGE,
  TemporaryInspectionReportStorage,
} from "./inspection-report-storage";
import {
  COMPLETION_REPORT_STORAGE,
  TemporaryCompletionReportStorage,
} from "./completion-report-storage";
import { auditedRepository } from "./audited-repository";
import { AuditRecorder } from "./audit-recorder";
import { Provider } from "@nestjs/common";
import { CompanyContext } from "./company-context";
import { companyRepository } from "./company-repository";
import { QUOTES_REPOSITORY, SampleQuotesRepository } from "./quotes.repository";
import {
  CUSTOMERS_REPOSITORY,
  SampleCustomersRepository,
} from "./customers.repository";
import {
  PHOTO_REPORT_STORAGE,
  TemporaryPhotoReportStorage,
} from "./photo-report-storage";
import {
  INVOICES_REPOSITORY,
  SampleInvoicesRepository,
} from "./invoices.repository";
import {
  FINANCE_REPOSITORY,
  SampleFinanceRepository,
} from "./finance.repository";
import {
  EXPENSES_REPOSITORY,
  SampleExpensesRepository,
} from "./expenses.repository";
import {
  PHOTO_REPOSITORY,
  PhotoRepository,
  SamplePhotoRepository,
} from "./photo.repository";
import { FILE_STORAGE, TemporaryFileStorage } from "./file-storage";
import {
  DAILY_WORK_REPOSITORY,
  SampleDailyWorkRepository,
} from "./daily-work.repository";
import {
  WORKERS_REPOSITORY,
  SampleWorkersRepository,
} from "./workers.repository";
import { SITES_REPOSITORY, SampleSitesRepository } from "./sites.repository";

export const COMPANY_DATA_PROVIDERS: Provider[] = [
  {
    provide: INSPECTION_REPORT_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(
        context,
        (seed) => new MemoryInspectionReportRepository(seed),
      ),
  },
  {
    provide: INSPECTION_REPORT_STORAGE,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          () => new TemporaryInspectionReportStorage(),
        ),
        "file",
        audit,
      ),
  },
  {
    provide: COMPLETION_REPORT_STORAGE,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          () => new TemporaryCompletionReportStorage(),
        ),
        "file",
        audit,
      ),
  },
  {
    provide: QUOTES_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(context, (seed) => new SampleQuotesRepository(seed)),
        "견적",
        audit,
      ),
  },
  {
    provide: CUSTOMERS_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      companyRepository(context, (seed) => new SampleCustomersRepository(seed)),
  },
  {
    provide: PHOTO_REPORT_STORAGE,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(context, (seed) => new TemporaryPhotoReportStorage()),
        "file",
        audit,
      ),
  },
  {
    provide: INVOICES_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          (seed) => new SampleInvoicesRepository(seed),
        ),
        "invoice",
        audit,
      ),
  },
  {
    provide: FINANCE_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          (seed) => new SampleFinanceRepository(undefined, seed),
        ),
        "finance",
        audit,
      ),
  },
  {
    provide: EXPENSES_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          (seed) => new SampleExpensesRepository(seed),
        ),
        "지출",
        audit,
      ),
  },
  {
    provide: PHOTO_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(context, (seed) => new SamplePhotoRepository(seed)),
        "사진",
        audit,
      ),
  },
  {
    provide: FILE_STORAGE,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(context, (seed) => new TemporaryFileStorage(seed)),
        "file",
        audit,
      ),
  },
  {
    provide: DAILY_WORK_REPOSITORY,
    inject: [CompanyContext, PHOTO_REPOSITORY, AuditRecorder],
    useFactory: (
      context: CompanyContext,
      photos: PhotoRepository,
      audit: AuditRecorder,
    ) =>
      auditedRepository(
        companyRepository(
          context,
          (seed) => new SampleDailyWorkRepository(photos, seed),
        ),
        "일일작업",
        audit,
      ),
  },
  {
    provide: WORKERS_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          (seed) => new SampleWorkersRepository(undefined, seed),
        ),
        "작업진행자",
        audit,
      ),
  },
  {
    provide: SITES_REPOSITORY,
    inject: [CompanyContext, AuditRecorder],
    useFactory: (context: CompanyContext, audit: AuditRecorder) =>
      auditedRepository(
        companyRepository(
          context,
          (seed) => new SampleSitesRepository(undefined, seed),
        ),
        "현장",
        audit,
      ),
  },
];
