import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Put,
} from "@nestjs/common";
import { quoteCompanyDefaults } from "@jongro/shared";
import { CompanyContext } from "./company-context";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import {
  CUSTOMERS_REPOSITORY,
  CustomersRepository,
} from "./customers.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { MaterialPersistence } from "./material-persistence";
@Injectable()
export class InitialSetupStore {
  private rows = new Map<string, Record<string, boolean>>();
  get(key: string) {
    return { ...this.rows.get(key) };
  }
  save(key: string, value: Record<string, boolean>) {
    this.rows.set(key, { ...this.get(key), ...value });
  }
}
@Controller("initial-setup")
export class InitialSetupController {
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(CUSTOMERS_REPOSITORY) private customers: CustomersRepository,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
    @Inject(MaterialPersistence) private materials: MaterialPersistence,
    @Inject(InitialSetupStore) private store: InitialSetupStore,
  ) {}
  private key() {
    this.company.assertMember(true);
    return JSON.stringify([
      this.company.companyId,
      this.company.identity.userId,
    ]);
  }
  @Get() status() {
    const key = this.key(),
      profile = quoteCompanyDefaults(this.company.settings()),
      review = this.store.get(key);
    const checks = {
      company: !!(
        profile.name.trim() &&
        profile.representative.trim() &&
        profile.registrationNumber.trim() &&
        profile.address.trim() &&
        profile.phone.trim()
      ),
      assets:
        !!(profile.logo && profile.seal) || review.assetsOptional === true,
      users: review.users === true,
      workers: this.workers.list().some((w) => !w.deletedAt),
      customers: this.customers.list().length > 0,
      materials: this.materials.repository
        .list()
        .prices.some((p) => p.active !== false),
      quote: review.quote === true,
      sites: this.sites.list().length > 0,
    };
    return {
      companyId: this.company.companyId,
      userId: this.company.identity.userId,
      checks,
      completed: Object.values(checks).filter(Boolean).length,
      total: 8,
      review,
    };
  }
  @Put() save(@Body() body: unknown) {
    const key = this.key();
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.entries(body).some(
        ([k, v]) =>
          !["users", "quote", "assetsOptional", "introSeen"].includes(k) ||
          typeof v !== "boolean",
      )
    )
      throw new BadRequestException("초기설정 확인 항목을 확인해 주세요.");
    this.store.save(key, body as Record<string, boolean>);
    return this.status();
  }
}
