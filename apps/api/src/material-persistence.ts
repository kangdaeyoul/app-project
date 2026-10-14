import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from "@nestjs/common";
import { defer, lastValueFrom } from "rxjs";
import { DEFAULT_COMPANY } from "@jongro/shared";
import { CompanyContext } from "./company-context";
import { companyRepository } from "./company-repository";
import {
  MaterialCatalogSnapshot,
  MemoryStandardWorkRepository,
  StandardWorkRepository,
} from "./standard-work.repository";

export interface CatalogDatabase {
  transaction<T>(
    companyId: string,
    seed: () => MaterialCatalogSnapshot,
    work: (
      state: MaterialCatalogSnapshot,
    ) => Promise<{ state: MaterialCatalogSnapshot; result: T }>,
  ): Promise<T>;
  close(): Promise<void>;
}
const empty = (): MaterialCatalogSnapshot =>
  new MemoryStandardWorkRepository(false).snapshot();
const sqliteSchema = `CREATE TABLE IF NOT EXISTS mm_catalogs(company_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);`;
export class SqliteCatalogDatabase implements CatalogDatabase {
  private db: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(filename: string) {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;",
    );
    this.db.exec(sqliteSchema);
  }
  transaction<T>(
    companyId: string,
    seed: () => MaterialCatalogSnapshot,
    work: (
      state: MaterialCatalogSnapshot,
    ) => Promise<{ state: MaterialCatalogSnapshot; result: T }>,
  ) {
    const op = this.queue.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const row = this.db
          .prepare("SELECT payload FROM mm_catalogs WHERE company_id=?")
          .get(companyId) as { payload: string } | undefined;
        const state = row ? JSON.parse(row.payload) : seed();
        const outcome = await work(state);
        const payload = JSON.stringify(outcome.state);
        if (!row || row.payload !== payload)
          this.db
            .prepare(
              "INSERT INTO mm_catalogs(company_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(company_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
            )
            .run(companyId, payload, new Date().toISOString());
        this.db.exec("COMMIT");
        return outcome.result;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    });
    this.queue = op.catch(() => {});
    return op;
  }
  async close() {
    await this.queue;
    this.db.close();
  }
}
export type SqlClient = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};
// Row locks serialize company catalog updates across API instances. No unscoped queries.
export async function postgresCatalogTransaction<T>(
  client: SqlClient,
  companyId: string,
  seed: () => MaterialCatalogSnapshot,
  work: (
    state: MaterialCatalogSnapshot,
  ) => Promise<{ state: MaterialCatalogSnapshot; result: T }>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const inserted = await client.query(
      "INSERT INTO material_management.catalogs(company_id,auxiliary) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING company_id",
      [companyId, {}],
    );
    const row = (
      await client.query(
        "SELECT auxiliary FROM material_management.catalogs WHERE company_id=$1 FOR UPDATE",
        [companyId],
      )
    ).rows[0];
    const load = async (table: string) =>
      (
        await client.query(
          `SELECT payload FROM material_management.${table} WHERE company_id=$1`,
          [companyId],
        )
      ).rows.map((r) => r.payload);
    const state: MaterialCatalogSnapshot = inserted.rows.length
      ? seed()
      : {
          prices: await load("materials"),
          histories: await load("price_history"),
          jobs: await load("import_jobs"),
          versions: row.auxiliary.versions ?? [],
          favoriteIds: row.auxiliary.favoriteIds ?? [],
        };
    const before = JSON.stringify(state);
    const out = await work(state);
    if (inserted.rows.length || before !== JSON.stringify(out.state)) {
      for (const p of out.state.prices)
        await client.query(
          "INSERT INTO material_management.materials(company_id,id,material_code,payload) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,id) DO UPDATE SET material_code=excluded.material_code,payload=excluded.payload",
          [companyId, p.id, p.materialCode ?? p.id, p],
        );
      for (const h of out.state.histories)
        await client.query(
          "INSERT INTO material_management.price_history(company_id,id,material_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [companyId, h.id, h.materialId, h],
        );
      for (const j of out.state.jobs)
        await client.query(
          "INSERT INTO material_management.import_jobs(company_id,id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,id) DO UPDATE SET status=excluded.status,payload=excluded.payload",
          [companyId, j.id, j.status, j],
        );
      await client.query(
        "UPDATE material_management.catalogs SET auxiliary=$2,updated_at=now() WHERE company_id=$1",
        [
          companyId,
          { versions: out.state.versions, favoriteIds: out.state.favoriteIds },
        ],
      );
    }
    await client.query("COMMIT");
    return out.result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
export class PostgresCatalogDatabase implements CatalogDatabase {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10000,
      ssl:
        process.env.MATERIAL_DB_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
    });
  }
  async check() {
    await this.pool.query(
      "SELECT company_id FROM material_management.catalogs LIMIT 0",
    );
  }
  async transaction<T>(
    companyId: string,
    seed: () => MaterialCatalogSnapshot,
    work: (
      state: MaterialCatalogSnapshot,
    ) => Promise<{ state: MaterialCatalogSnapshot; result: T }>,
  ) {
    const c = await this.pool.connect();
    try {
      return await postgresCatalogTransaction(c, companyId, seed, work);
    } finally {
      c.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
@Injectable()
export class MaterialPersistence implements OnModuleInit, OnModuleDestroy {
  readonly mode = process.env.MATERIAL_STORAGE ?? "memory";
  private database?: CatalogDatabase;
  private readonly local =
    new AsyncLocalStorage<MemoryStandardWorkRepository>();
  readonly repository: StandardWorkRepository;
  constructor(@Inject(CompanyContext) private context: CompanyContext) {
    if (!["memory", "sqlite", "postgres"].includes(this.mode))
      throw Error("MATERIAL_STORAGE: memory/sqlite/postgres를 선택하세요.");
    if (this.mode === "sqlite")
      this.database = new SqliteCatalogDatabase(
        process.env.MATERIAL_SQLITE_PATH ?? resolve(".local/materials.sqlite"),
      );
    if (this.mode === "postgres") {
      if (!process.env.MATERIAL_DATABASE_URL)
        throw Error(
          "MATERIAL_DATABASE_URL이 필요합니다. 비밀 환경변수로 설정하세요.",
        );
      this.database = new PostgresCatalogDatabase(
        process.env.MATERIAL_DATABASE_URL,
      );
    }
    const memory = companyRepository(
      context,
      (seed) => new MemoryStandardWorkRepository(seed),
    );
    this.repository = new Proxy({} as StandardWorkRepository, {
      get: (_t, key) => {
        if (key === "then") return undefined;
        if (key === "companyId") return context.companyId;
        const method = (memory as any)[key];
        if (typeof method !== "function") return undefined;
        return (...args: any[]) => {
          const scoped = this.local.getStore();
          if (!this.database) return method(...args);
          if (!scoped)
            throw Error("영구 자재 저장소의 트랜잭션 범위가 없습니다.");
          const check = (v: any) => {
            if (v && typeof v === "object") {
              if (v.companyId && v.companyId !== context.companyId)
                throw new ForbiddenException();
              for (const x of Object.values(v)) check(x);
            }
          };
          args.forEach(check);
          return (scoped as any)[key](...args);
        };
      },
    });
  }
  async onModuleInit() {
    if (this.database instanceof PostgresCatalogDatabase)
      try {
        await this.database.check();
      } catch {
        throw Error(
          "자재 PostgreSQL 연결 또는 스키마 확인 실패. 접속 설정과 승인된 materials:migrate 실행 여부를 확인하세요.",
        );
      }
  }
  async onModuleDestroy() {
    await this.database?.close();
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (!this.database) return work();
    return this.database.transaction(
      this.context.companyId,
      () =>
        process.env.MATERIAL_SEED_SAMPLES === "true" &&
        this.context.companyId === DEFAULT_COMPANY.id
          ? new MemoryStandardWorkRepository(true).snapshot()
          : empty(),
      async (state) => {
        const repo = new MemoryStandardWorkRepository(false);
        repo.loadSnapshot(state);
        return this.local.run(repo, async () => ({
          result: await work(),
          state: repo.snapshot(),
        }));
      },
    );
  }
}
@Injectable()
export class MaterialTransactionInterceptor implements NestInterceptor {
  constructor(
    @Inject(MaterialPersistence) private store: MaterialPersistence,
  ) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const controller = ctx.getClass().name;
    if (
      ![
        "MaterialExcelController",
        "MaterialCatalogController",
        "UniversalMaterialExcelController",
        "StandardWorkController",
      ].includes(controller)
    )
      return next.handle();
    return defer(() => this.store.run(() => lastValueFrom(next.handle())));
  }
}
