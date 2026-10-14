"use client";
import { useState } from "react";
import { MaterialImportJob } from "@jongro/shared";
const fields: Record<string, string> = {
  name: "품명",
  specification: "규격",
  unit: "단위",
  manufacturer: "제조사",
  cost: "원가",
  salePrice: "판매단가",
  trade: "분류",
  notes: "비고",
};
type Inspection = {
  id: string;
  sheets: { name: string; rows: (string | number)[][]; rowCount: number }[];
  formats: {
    name: string;
    signature: string;
    mapping: Record<string, number>;
  }[];
  suggestions: Record<string, string[]>;
};
async function api<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch("/api/material-prices/" + path, {
    method: "POST",
    ...(body instanceof FormData
      ? { body }
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.message ?? "가져오기 실패");
  return v;
}
export default function UniversalMaterialImport({
  onApplied,
  onReviewed,
}: {
  onApplied: () => void;
  onReviewed?: (job: MaterialImportJob) => void;
}) {
  const [open, setOpen] = useState(false),
    [inspection, setInspection] = useState<Inspection | null>(null),
    [sheet, setSheet] = useState(""),
    [header, setHeader] = useState(1),
    [mapping, setMapping] = useState<Record<string, number>>({}),
    [policy, setPolicy] = useState("기존값 유지"),
    [format, setFormat] = useState(""),
    [job, setJob] = useState<MaterialImportJob | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const select = (i: Inspection, s: string, h: number) => {
    setSheet(s);
    setHeader(h);
    setJob(null);
    const headers = i.sheets.find((v) => v.name === s)?.rows[h - 1] ?? [];
    const saved = i.formats.find(
      (f) =>
        f.signature ===
        JSON.stringify(headers.map((v) => String(v).trim().toLowerCase())),
    );
    if (saved) {
      setMapping(saved.mapping);
      setFormat(saved.name);
      setNotice("저장된 열매핑을 자동 적용했습니다.");
      return;
    }
    const next: Record<string, number> = {};
    for (const [k, a] of Object.entries(i.suggestions)) {
      const index = headers.findIndex((v) => a.includes(String(v).trim()));
      if (index >= 0) next[k] = index;
    }
    setMapping(next);
    setNotice(
      "열 이름을 자동 추정했습니다. 품명·단위와 단가 연결을 확인하세요.",
    );
  };
  const headers =
    inspection?.sheets.find((s) => s.name === sheet)?.rows[header - 1] ?? [];
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)}>
        다른 Excel 가져오기
      </button>
      {open && (
        <section className="material-import-preview">
          <h3>다른 Excel 가져오기</h3>
          <p>파일 → 시트·헤더 → 열매핑 → 미리보기 → 오류·중복 확인 → 반영</p>
          <label>
            파일선택 (XLSX / XLS)
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  void run(async () => {
                    setInspection(null);
                    setJob(null);
                    setNotice("파일을 읽고 있습니다…");
                    const b = new FormData();
                    b.append("file", f);
                    const i = await api<Inspection>("universal/inspect", b);
                    setInspection(i);
                    const candidates = i.sheets.flatMap((s) =>
                      s.rows.map((r, index) => ({
                        sheet: s.name,
                        header: index + 1,
                        saved: i.formats.some(
                          (f) =>
                            f.signature ===
                            JSON.stringify(
                              r.map((v) => String(v).trim().toLowerCase()),
                            ),
                        ),
                        score: r.filter((v) =>
                          Object.values(i.suggestions).some((a) =>
                            a.includes(String(v).trim()),
                          ),
                        ).length,
                      })),
                    );
                    candidates.sort(
                      (a, b) =>
                        Number(b.saved) - Number(a.saved) || b.score - a.score,
                    );
                    const guess = candidates[0];
                    select(
                      i,
                      guess?.sheet ?? i.sheets[0].name,
                      guess?.header ?? 1,
                    );
                  });
              }}
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {inspection && (
            <>
              <div className="form-grid">
                <label>
                  시트선택
                  <select
                    aria-label="시트선택"
                    value={sheet}
                    onChange={(e) => select(inspection, e.target.value, header)}
                  >
                    {inspection.sheets.map((s) => (
                      <option key={s.name}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  헤더 행
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={header}
                    onChange={(e) =>
                      select(inspection, sheet, Number(e.target.value))
                    }
                  />
                </label>
                {Object.entries(fields).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <select
                      aria-label={label}
                      value={mapping[k] ?? ""}
                      onChange={(e) => {
                        setJob(null);
                        const m = { ...mapping };
                        if (e.target.value === "") delete m[k];
                        else m[k] = Number(e.target.value);
                        setMapping(m);
                      }}
                    >
                      <option value="">연결 안 함</option>
                      {headers.map((h, n) => (
                        <option value={n} key={n}>
                          {n + 1}열 · {String(h) || "(빈 헤더)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  중복처리
                  <select
                    aria-label="중복처리"
                    value={policy}
                    onChange={(e) => {
                      setPolicy(e.target.value);
                      setJob(null);
                    }}
                  >
                    {[
                      "기존값 유지",
                      "단가 업데이트",
                      "전체정보 업데이트",
                      "신규 등록",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  양식 기억 이름
                  <input
                    value={format}
                    maxLength={100}
                    onChange={(e) => setFormat(e.target.value)}
                    placeholder="거래처 A 자재표"
                  />
                </label>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const j = await api<MaterialImportJob>(
                      `universal/${inspection.id}/preview`,
                      {
                        sheetName: sheet,
                        headerRow: header,
                        mapping,
                        policy,
                        templateName: format,
                      },
                    );
                    setJob(j);
                    onReviewed?.(j);
                  })
                }
              >
                미리보기
              </button>
            </>
          )}
          {job && !onReviewed && (
            <>
              <p>
                전체 {job.summary.total} · 신규 {job.summary.new} · 수정{" "}
                {job.summary.updated} · 변경없음 {job.summary.unchanged} · 오류{" "}
                {job.summary.errors}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>행</th>
                      <th>상태</th>
                      <th>품명 / 규격</th>
                      <th>원가</th>
                      <th>판매단가</th>
                      <th>오류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td>
                        <td>{r.status}</td>
                        <td>
                          {String(r.values[1])} / {String(r.values[2])}
                        </td>
                        <td>{String(r.values[8])}</td>
                        <td>{String(r.values[9])}</td>
                        <td>{r.errors.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                오류행은 원본 파일을 수정해 다시 업로드하세요. 기존 견적의
                수량·단가는 변경되지 않습니다.
              </p>
              {["정상행만", "전체"].map((mode) => (
                <button
                  key={mode}
                  disabled={
                    busy ||
                    job.status === "반영완료" ||
                    (mode === "전체" && job.summary.errors > 0)
                  }
                  onClick={() =>
                    void run(async () => {
                      if (
                        !confirm(
                          "검토 결과를 최종 승인하여 자재DB에 반영할까요?",
                        )
                      )
                        return;
                      const v = await api<MaterialImportJob>(
                        `imports/${job.id}/apply`,
                        { mode },
                      );
                      setJob(v);
                      setNotice(`${v.appliedCount}건 반영 완료`);
                      onApplied();
                    })
                  }
                >
                  {mode === "정상행만" ? "정상행만 반영" : "전체 반영"}
                </button>
              ))}
            </>
          )}
        </section>
      )}
    </>
  );
}
