import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import {
  coreConnectionString,
  safeCoreDbError,
} from "../src/core-db-diagnostics";
import { CorePersistence } from "../src/core-persistence";
import { CompanyContext } from "../src/company-context";

async function probe(failAt?: string, error?: unknown) {
  const store = new CorePersistence(new CompanyContext());
  const queries: string[] = [],
    logs: string[] = [];
  const prior = Logger.prototype.error;
  Logger.prototype.error = function (message: unknown) {
    logs.push(String(message));
  };
  (store as any).pool = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes(failAt ?? "NEVER")) throw error;
      return { rows: [] };
    },
    end: async () => {},
  };
  try {
    await store.onModuleInit();
    return { queries, logs, failure: "" };
  } catch (failure) {
    return { queries, logs, failure: String(failure) };
  } finally {
    Logger.prototype.error = prior;
    await store.onModuleDestroy();
  }
}
test("core init probes connection first, all seven tables next, and never runs DDL", async () => {
  const result = await probe();
  assert.equal(result.failure, "");
  assert.equal(result.logs.length, 0);
  assert.equal(result.queries[0], "SELECT 1");
  assert.equal(result.queries.length, 8);
  assert(
    result.queries
      .slice(1)
      .every((q) => /^SELECT company_id FROM app_core\.\w+ LIMIT 0$/.test(q)),
  );
});
test("core init safely distinguishes authentication, schema permission and missing table failures", async () => {
  for (const [target, code, message, stage, table] of [
    [
      "SELECT 1",
      "28P01",
      'password authentication failed for user "private-user"',
      "connection",
      "none",
    ],
    [
      "app_core.companies",
      "42501",
      "permission denied for schema app_core",
      "schema/table probe",
      "companies",
    ],
    [
      "app_core.daily_work",
      "42P01",
      'relation "app_core.daily_work" does not exist',
      "schema/table probe",
      "daily_work",
    ],
  ]) {
    const result = await probe(target, {
      code,
      message,
      stack: "SECRET stack",
      detail: "SECRET detail",
      connectionString: "postgres://SECRET",
    });
    assert(
      result.failure.includes(`code=${code} stage=${stage} table=${table}`),
    );
    assert.equal(result.logs.length, 1);
    assert(result.logs[0].startsWith("CORE_DB_INIT_FAILED"));
    assert(!JSON.stringify(result).includes("SECRET"));
    assert(!result.failure.includes("private-user"));
    assert.equal(result.queries.at(-1)?.includes(target), true);
  }
});
test("diagnostics never emit raw URLs, passwords, hostnames, IPs, tokens, stacks or arbitrary messages", async () => {
  const secrets = [
    "postgres://user:p%40ss@private.example:5432/db",
    "p@ss",
    "private.example",
    "203.0.113.9",
    "sb_secret_fake",
    "Bearer eyJ.fake.token",
  ];
  const raw = secrets.join(" ");
  for (const error of [
    { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND " + raw },
    { code: "ERR_TLS_CERT_ALTNAME_INVALID", message: raw },
    { code: "42501", message: "permission denied for schema " + raw },
    {
      code: "XX000",
      message: raw,
      stack: raw,
      detail: raw,
      hint: raw,
      cause: new Error(raw),
    },
    { code: raw, message: raw },
    new AggregateError(
      [Object.assign(new Error(raw), { code: "ECONNREFUSED" })],
      raw,
    ),
    raw,
    null,
  ]) {
    const safe = JSON.stringify(safeCoreDbError(error));
    const result = await probe("SELECT 1", error);
    for (const secret of secrets) {
      assert(!safe.includes(secret));
      assert(!result.failure.includes(secret));
      assert(!result.logs.join().includes(secret));
    }
  }
});
test("SSL aliases preserve current full verification; explicit settings are not weakened", () => {
  const base =
    "postgresql://user:p%40ss@private.example:6543/db?application_name=core";
  for (const mode of ["require", "prefer", "verify-ca"]) {
    const url = new URL(coreConnectionString(base + "&sslmode=" + mode));
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    assert.equal(url.password, "p%40ss");
    assert.equal(url.hostname, "private.example");
    assert.equal(url.searchParams.get("application_name"), "core");
  }
  for (const suffix of [
    "",
    "&sslmode=verify-full",
    "&sslmode=disable",
    "&sslmode=require&uselibpqcompat=true",
  ])
    assert.equal(coreConnectionString(base + suffix), base + suffix);
  assert.throws(
    () => coreConnectionString("INVALID secret password"),
    /접속값은 보안상 출력하지 않습니다/,
  );
});
test("memory initialization neither creates a database pool nor emits database failures", async () => {
  const store = new CorePersistence(new CompanyContext());
  assert.equal(store.mode, "memory");
  assert.equal((store as any).pool, undefined);
  await store.onModuleInit();
  await store.onModuleDestroy();
});

test("Session Pooler identity is preserved by normalization and by pg startup parsing", async () => {
  const { randomBytes } = await import("node:crypto");
  const { Client, Pool } = await import("pg");
  const { coreDbTarget } = await import("../src/core-db-diagnostics");
  // Generated fake alphanumeric password: never a production credential or a stored fixture.
  const password = randomBytes(18).toString("hex");
  const user = "postgres.fakeprojectreference";
  const host = "aws-0-ap-northeast-2.pooler.supabase.com";
  const uri = `postgresql://${user}:${password}@${host}:5432/postgres?uselibpqcompat=true&sslmode=require`;
  const processed = coreConnectionString(uri);
  assert.equal(processed, uri); // Explicit compat branch returns the original bytes, no URL serialization.
  const params = (value: string) =>
    (new Client({ connectionString: value }) as any).connectionParameters;
  for (const value of [uri, processed]) {
    const p = params(value);
    assert.equal(p.user, user);
    assert.equal(p.host, host);
    assert.equal(p.port, 5432);
    assert.equal(p.database, "postgres");
    assert(p.password === password, "generated password preserved");
    const startup = (
      new Client({ connectionString: value }) as any
    ).getStartupConf();
    assert.equal(startup.user, user);
  }
  // Also exercise the URL reserialization branch without explicit libpq compatibility.
  const alias = uri.replace("uselibpqcompat=true&", "");
  const changed = params(coreConnectionString(alias));
  for (const key of ["user", "host", "port", "database"])
    assert.equal(changed[key], params(uri)[key]);
  assert(
    changed.password === password,
    "generated password preserved after URL serialization",
  );
  const pool = new Pool({ connectionString: processed });
  const line = coreDbTarget(pool.options);
  assert.equal(
    line,
    `CORE_DB_TARGET host=${host} port=5432 database=postgres user=postgres.fake... sslmode=require uselibpqcompat=true`,
  );
  assert(!line.includes(password));
  assert(!line.includes(uri));
  assert(!line.includes(user));
  // pg permits query overrides: diagnose the effective user, not just the URI authority.
  assert(
    coreDbTarget({ connectionString: uri + "&user=postgres" }).includes(
      "user=postgres sslmode=",
    ),
  );
  assert(
    !coreDbTarget({ connectionString: uri + "&token=" + password }).includes(
      password,
    ),
  );
  assert(
    !coreDbTarget({
      connectionString:
        uri + "&sslmode=" + password + "&uselibpqcompat=" + password,
    }).includes(password),
  );
  await pool.end();
});
