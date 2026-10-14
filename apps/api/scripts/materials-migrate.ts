import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Run only after backup and explicit operator approval. No automatic migration at API startup.
async function main() {
  if (!process.env.MATERIAL_DATABASE_URL)
    throw Error("MATERIAL_DATABASE_URL을 비밀 환경변수로 설정하세요.");
  const pool = new Pool({
    connectionString: process.env.MATERIAL_DATABASE_URL,
    ssl:
      process.env.MATERIAL_DB_SSL === "true"
        ? { rejectUnauthorized: true }
        : undefined,
  });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      readFileSync(resolve("migrations/001-material-management.sql"), "utf8"),
    );
    await c.query("COMMIT");
    console.log(
      "자재관리 전용 스키마 준비 완료. 기존 테이블과 데이터를 변경하지 않았습니다.",
    );
  } catch {
    await c.query("ROLLBACK");
    throw Error("스키마 준비 실패. DB 권한과 연결 설정을 확인하세요.");
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
