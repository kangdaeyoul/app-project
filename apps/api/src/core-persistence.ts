import {
  coreConnectionString,
  safeCoreDbError,
  coreDbTarget,
} from "./core-db-diagnostics";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Pool } from "pg";
import { Company, DEFAULT_COMPANY } from "@jongro/shared";
import { CompanyContext, CompanyIdentity } from "./company-context";
import { companyRepository } from "./company-repository";
import type { SqlClient } from "./material-persistence";

export type CoreKind = "customers" | "workers" | "sites" | "daily_work";
type Adapter = { snapshot(): any; loadSnapshot(state: any): void };
type States = Record<CoreKind, any>;
export interface CoreState {
  company: Company;
  states: States;
}
const kinds: CoreKind[] = ["customers", "workers", "sites", "daily_work"];
export function companyProfile(id: string, payload: Partial<Company>): Company {
  const base: Company =
    id === DEFAULT_COMPANY.id
      ? structuredClone(DEFAULT_COMPANY)
      : {
          id,
          name: id,
          displayName: id,
          logoUrl: null,
          sealKey: null,
          phone: "",
          fax: "",
          email: "",
          address: "",
          branchAddress: "",
          website: "",
          business: {
            name: id,
            registrationNumber: "",
            corporationNumber: "",
            representative: "",
            address: "",
            email: "",
            businessType: "",
            businessItem: "",
          },
          quoteTemplate: null,
          output: {
            photoReportTitle: "공사 사진대지",
            footer: "",
            quoteNotes: "",
          },
        };
  return { ...base, ...payload, id };
}
// The server connection is privileged. Company predicates and composite FKs are mandatory;
// browser access is independently restricted by RLS. Never expose this URL to the client.
export async function postgresCoreTransaction<T>(
  client: SqlClient,
  companyId: string,
  empty: () => States,
  work: (state: CoreState) => Promise<T>,
  identity?: CompanyIdentity,
): Promise<T> {
  if (!companyId || companyId.startsWith("trial_"))
    throw new ForbiddenException("체험 데이터는 DB에 저장할 수 없습니다.");
  await client.query("BEGIN");
  try {
    if (identity?.authenticated) {
      const m = (
        await client.query(
          `SELECT role,worker_id,site_ids,permissions FROM public.app_memberships
        WHERE user_id=$1 AND company_id=$2 AND approval_status='approved' AND active AND NOT locked FOR SHARE`,
          [identity.userId, companyId],
        )
      ).rows[0];
      const sameList = (a: string[] = [], b: string[] = []) =>
        JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
      if (
        !m ||
        m.role !== identity.appRole ||
        (m.role === "worker" &&
          (m.worker_id ?? undefined) !== identity.workerId) ||
        (m.role !== "admin" &&
          !sameList(m.site_ids, identity.accessibleSiteIds)) ||
        !sameList(m.permissions, identity.permissions)
      )
        throw new ForbiddenException(
          "회사 권한이 변경되었습니다. 다시 로그인하세요.",
        );
    }
    const row = (
      await client.query(
        "SELECT payload,auxiliary,to_jsonb(c)->>'active' AS company_active FROM app_core.companies c WHERE company_id=$1 FOR UPDATE",
        [companyId],
      )
    ).rows[0];
    if (!row)
      throw Error(
        "회사 DB 등록이 필요합니다. 006 마이그레이션과 회사 등록을 확인하세요.",
      );
    if (row.company_active === "false")
      throw new ForbiddenException("비활성 업체입니다.");
    const states = empty();
    const load = async (table: CoreKind) =>
      (
        await client.query(
          `SELECT payload FROM app_core.${table} WHERE company_id=$1 ORDER BY created_at,id`,
          [companyId],
        )
      ).rows.map((r) => r.payload);
    states.customers.records = await load("customers");
    states.workers.workers = await load("workers");
    states.workers.overrides = (
      await client.query(
        "SELECT worker_id,payload FROM app_core.worker_availability WHERE company_id=$1",
        [companyId],
      )
    ).rows.map((r) => [r.worker_id, r.payload]);
    states.workers.records = row.auxiliary.workerRecords ?? {};
    states.sites.sites = await load("sites");
    states.daily_work.records = await load("daily_work");
    states.daily_work.participants = (
      await client.query(
        "SELECT payload FROM app_core.daily_work_participants WHERE company_id=$1 AND deleted_at IS NULL",
        [companyId],
      )
    ).rows.map((r) => r.payload);
    states.daily_work.catalog = row.auxiliary.materialCatalog ?? [];
    states.daily_work.usages = row.auxiliary.materialUsages ?? [];
    const state: CoreState = {
      company: companyProfile(companyId, row.payload),
      states,
    };
    const before = JSON.stringify(state);
    const result = await work(state);
    if (before !== JSON.stringify(state)) {
      const upsert = async (table: CoreKind, rows: any[]) => {
        for (const value of rows) {
          if (value.companyId !== undefined && value.companyId !== companyId)
            throw new ForbiddenException();
          const extra =
            table === "sites"
              ? ["manager_id", "customer_id"]
              : table === "daily_work"
                ? ["site_id", "manager_id"]
                : [];
          const values =
            table === "sites"
              ? [value.managerId || null, value.clientId || null]
              : table === "daily_work"
                ? [value.siteId, value.managerId || null]
                : [];
          const columns = ["company_id", "id", "payload", ...extra];
          await client.query(
            `INSERT INTO app_core.${table}(${columns.join(",")}) VALUES(${columns.map((_, i) => "$" + (i + 1)).join(",")})
            ON CONFLICT(company_id,id) DO UPDATE SET ${["payload", ...extra].map((c) => `${c}=excluded.${c}`).join(",")},updated_at=now()`,
            [companyId, value.id, value, ...values],
          );
        }
      };
      await upsert("customers", states.customers.records);
      await upsert("workers", states.workers.workers);
      await upsert("sites", states.sites.sites);
      await upsert("daily_work", states.daily_work.records);
      for (const [workerId, entries] of states.workers.overrides)
        await client.query(
          `INSERT INTO app_core.worker_availability(company_id,worker_id,payload) VALUES($1,$2,$3)
          ON CONFLICT(company_id,worker_id) DO UPDATE SET payload=excluded.payload,updated_at=now()`,
          [companyId, workerId, JSON.stringify(entries)],
        );
      // Retain removed participation as history; never delete business rows.
      await client.query(
        "UPDATE app_core.daily_work_participants SET deleted_at=now(),updated_at=now() WHERE company_id=$1 AND deleted_at IS NULL",
        [companyId],
      );
      for (const p of states.daily_work.participants)
        await client.query(
          `INSERT INTO app_core.daily_work_participants(company_id,daily_work_id,worker_id,payload) VALUES($1,$2,$3,$4)
          ON CONFLICT(company_id,daily_work_id,worker_id) DO UPDATE SET payload=excluded.payload,deleted_at=NULL,updated_at=now()`,
          [companyId, p.dailyWorkId, p.workerId, p],
        );
      await client.query(
        "UPDATE app_core.companies SET payload=$2,auxiliary=$3,updated_at=now() WHERE company_id=$1",
        [
          companyId,
          state.company,
          {
            workerRecords: states.workers.records,
            materialCatalog: states.daily_work.catalog,
            materialUsages: states.daily_work.usages,
          },
        ],
      );
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

@Injectable()
export class CorePersistence implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CorePersistence.name);
  readonly mode = process.env.CORE_STORAGE ?? "memory"; // Explicit staged rollout; existing deployment stays compatible until SQL is applied.
  private pool?: Pool;
  private factories = new Map<CoreKind, () => Adapter>();
  private local = new AsyncLocalStorage<{
    companyId: string;
    adapters: Map<CoreKind, Adapter>;
    client: SqlClient;
  }>();
  constructor(@Inject(CompanyContext) private context: CompanyContext) {
    if (!["memory", "postgres"].includes(this.mode))
      throw Error("CORE_STORAGE: memory/postgres를 선택하세요.");
    if (this.mode === "postgres") {
      if (!process.env.CORE_DATABASE_URL)
        throw Error("CORE_DATABASE_URL 서버 비밀 환경변수가 필요합니다.");
      this.pool = new Pool({
        connectionString: coreConnectionString(process.env.CORE_DATABASE_URL),
        max: 5,
        connectionTimeoutMillis: 10000,
        query_timeout: 30000,
      });
    }
  }
  repository<T extends Adapter>(
    kind: CoreKind,
    create: (seed: boolean) => T,
  ): T {
    this.factories.set(kind, () => create(false));
    return companyRepository(this.context, create, () => {
      if (!this.pool || this.context.identity.trial) return undefined;
      const scope = this.local.getStore();
      if (scope && scope.companyId !== this.context.companyId)
        throw new ForbiddenException();
      const adapter = scope?.adapters.get(kind);
      if (!adapter) throw Error("업무 DB 트랜잭션 범위가 없습니다.");
      return adapter as T;
    });
  }
  async onModuleInit() {
    if (this.pool) {
      let stage = "connection";
      let table = "none";
      try {
        if (this.pool.options?.connectionString)
          this.logger.log(coreDbTarget(this.pool.options));
        await this.pool.query("SELECT 1");
        stage = "schema/table probe";
        for (const target of [
          "companies",
          ...kinds,
          "worker_availability",
          "daily_work_participants",
        ]) {
          table = target;
          await this.pool.query(
            `SELECT company_id FROM app_core.${table} LIMIT 0`,
          );
        }
      } catch (error) {
        const diagnostic = safeCoreDbError(error);
        const summary = `CORE_DB_INIT_FAILED code=${diagnostic.code} stage=${stage} table=${table} message=${diagnostic.message}`;
        this.logger.error(summary);
        // Do not attach the raw error as cause: Nest logs error stacks at startup.
        throw Error(`${summary}. SQL은 자동 실행하지 않습니다.`);
      }
    } else if (
      process.env.NODE_ENV === "production" &&
      process.env.APP_ENV !== "test"
    ) {
      console.warn(
        "CORE_STORAGE=memory: 업무 데이터는 재시작 시 소실됩니다. 006 적용 후 postgres로 전환하세요.",
      );
    }
  }
  // Reuse the existing configured pool and current request transaction. No new connection or SSL settings.
  async databaseQuery(sql: string, params?: any[]) {
    const client = this.local.getStore()?.client ?? this.pool;
    if (!client) throw Error("업체 등록에는 PostgreSQL 저장소가 필요합니다.");
    return client.query(sql, params);
  }
  async databaseTransaction<T>(
    work: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const scoped = this.local.getStore()?.client;
    if (scoped) return work(scoped);
    if (!this.pool)
      throw Error("업체 등록에는 PostgreSQL 저장소가 필요합니다.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool?.end();
  }
  async prepareCompany(id: string, workerId?: string) {
    if (!this.pool) return;
    if (!id || id.startsWith("trial_")) throw new ForbiddenException();
    const row = (
      await this.pool.query(
        "SELECT payload,to_jsonb(c)->>'active' AS company_active FROM app_core.companies c WHERE company_id=$1",
        [id],
      )
    ).rows[0];
    if (!row || row.company_active === "false")
      throw new ForbiddenException("등록된 활성 업체가 없습니다.");
    this.context.hydrate(companyProfile(id, row.payload));
    if (workerId) {
      const w = (
        await this.pool.query(
          "SELECT payload FROM app_core.workers WHERE company_id=$1 AND id=$2",
          [id, workerId],
        )
      ).rows[0];
      if (!w || w.payload.deletedAt)
        throw new ForbiddenException("유효한 작업진행자 연결이 필요합니다.");
    }
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (!this.pool || this.context.identity.trial) return work();
    const client = await this.pool.connect();
    try {
      return await postgresCoreTransaction(
        client,
        this.context.companyId,
        () =>
          Object.fromEntries(
            kinds.map((k) => [k, this.factories.get(k)!().snapshot()]),
          ) as States,
        async (state) => {
          const adapters = new Map(
            kinds.map((k) => {
              const a = this.factories.get(k)!();
              a.loadSnapshot(state.states[k]);
              return [k, a] as const;
            }),
          );
          return this.context.withCompanyState(state.company, () =>
            this.local.run(
              { companyId: this.context.companyId, adapters, client },
              async () => {
                const result = await work();
                for (const k of kinds)
                  state.states[k] = adapters.get(k)!.snapshot();
                return result;
              },
            ),
          );
        },
        this.context.identity,
      );
    } finally {
      client.release();
    }
  }
}
