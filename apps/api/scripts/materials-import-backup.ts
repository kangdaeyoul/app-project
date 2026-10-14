import { readFileSync, statSync } from "node:fs";
import {
  MaterialCatalogSnapshot,
  MemoryStandardWorkRepository,
} from "../src/standard-work.repository";
import {
  SqliteCatalogDatabase,
  PostgresCatalogDatabase,
} from "../src/material-persistence";
import {
  equalPrice,
  materialCode,
  validateMaterial,
} from "../src/material-price";
async function main() {
  const file = process.argv[2];
  if (!file || statSync(file).size > 50 * 1024 * 1024)
    throw Error("50MB 이하의 자재 백업 JSON 파일 경로가 필요합니다.");
  const backup = JSON.parse(readFileSync(file, "utf8"));
  const s = backup.state as MaterialCatalogSnapshot;
  if (
    backup.version !== 1 ||
    typeof backup.companyId !== "string" ||
    !s ||
    !["prices", "histories", "jobs", "versions", "favoriteIds"].every((k) =>
      Array.isArray((s as any)[k]),
    )
  )
    throw Error("자재 백업 형식이 올바르지 않습니다.");
  const check = (v: any) => {
    if (v && typeof v === "object") {
      if (v.companyId !== undefined && v.companyId !== backup.companyId)
        throw Error("다른 회사의 자료가 포함되어 있습니다.");
      for (const x of Object.values(v)) check(x);
    }
  };
  check(s);
  const ids = new Set<string>(),
    codes = new Set<string>();
  for (const p of s.prices) {
    validateMaterial(p, backup.companyId, p.id, p);
    if (ids.has(p.id) || codes.has(materialCode(p)))
      throw Error("백업에 중복 자재 ID/코드가 있습니다.");
    ids.add(p.id);
    codes.add(materialCode(p));
  }
  const mode = process.env.MATERIAL_STORAGE;
  const db =
    mode === "sqlite" && process.env.MATERIAL_SQLITE_PATH
      ? new SqliteCatalogDatabase(process.env.MATERIAL_SQLITE_PATH)
      : mode === "postgres" && process.env.MATERIAL_DATABASE_URL
        ? new PostgresCatalogDatabase(process.env.MATERIAL_DATABASE_URL)
        : undefined;
  if (!db) throw Error("명시적인 영구 저장소 설정이 필요합니다.");
  try {
    if (db instanceof PostgresCatalogDatabase) await db.check();
    const count = await db.transaction(
      backup.companyId,
      () => new MemoryStandardWorkRepository(false).snapshot(),
      async (current) => {
        for (const p of s.prices) {
          const old = current.prices.find(
            (x) => x.id === p.id || materialCode(x) === materialCode(p),
          );
          if (old && !equalPrice(old, p))
            throw Error(
              "기존 자재와 충돌합니다. 운영 자료를 덮어쓰지 않았습니다. Excel 검토로 갱신하세요.",
            );
        }
        const merge = (a: any[], b: any[], key: (v: any) => string) => {
          const result = structuredClone(a),
            known = new Map(a.map((x) => [key(x), x]));
          for (const v of b) {
            const old = known.get(key(v));
            if (old && JSON.stringify(old) !== JSON.stringify(v))
              throw Error(
                "기존 이력 또는 버전과 충돌합니다. 병합하지 않았습니다.",
              );
            if (!old) {
              result.push(v);
              known.set(key(v), v);
            }
          }
          return result;
        };
        const before = current.prices.length;
        current.prices = merge(current.prices, s.prices, (v) => v.id);
        current.histories = merge(current.histories, s.histories, (v) => v.id);
        current.jobs = merge(current.jobs, s.jobs, (v) => v.id);
        current.versions = merge(
          current.versions,
          s.versions,
          (v) => `${v.id}:${v.version}`,
        );
        current.favoriteIds = [
          ...new Set([...current.favoriteIds, ...s.favoriteIds]),
        ];
        return { state: current, result: current.prices.length - before };
      },
    );
    console.log(
      `백업 신규 자재 ${count}건 병합 완료. 기존 자료는 덮어쓰지 않았습니다.`,
    );
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error(
    "백업 병합 실패: 파일 형식·회사·중복 충돌·DB 설정을 확인하세요. 원본 백업과 운영 데이터는 유지됩니다.",
  );
  process.exitCode = 1;
});
