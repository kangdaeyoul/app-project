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
    provide: QUOTES_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new SampleQuotesRepository(seed)),
  },
  {
    provide: CUSTOMERS_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new SampleCustomersRepository(seed)),
  },
  {
    provide: PHOTO_REPORT_STORAGE,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new TemporaryPhotoReportStorage()),
  },
  {
    provide: INVOICES_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new SampleInvoicesRepository(seed)),
  },
  {
    provide: FINANCE_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(
        context,
        (seed) => new SampleFinanceRepository(undefined, seed),
      ),
  },
  {
    provide: EXPENSES_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new SampleExpensesRepository(seed)),
  },
  {
    provide: PHOTO_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new SamplePhotoRepository(seed)),
  },
  {
    provide: FILE_STORAGE,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(context, (seed) => new TemporaryFileStorage(seed)),
  },
  {
    provide: DAILY_WORK_REPOSITORY,
    inject: [CompanyContext, PHOTO_REPOSITORY],
    useFactory: (context: CompanyContext, photos: PhotoRepository) =>
      companyRepository(
        context,
        (seed) => new SampleDailyWorkRepository(photos, seed),
      ),
  },
  {
    provide: WORKERS_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(
        context,
        (seed) => new SampleWorkersRepository(undefined, seed),
      ),
  },
  {
    provide: SITES_REPOSITORY,
    inject: [CompanyContext],
    useFactory: (context: CompanyContext) =>
      companyRepository(
        context,
        (seed) => new SampleSitesRepository(undefined, seed),
      ),
  },
];
