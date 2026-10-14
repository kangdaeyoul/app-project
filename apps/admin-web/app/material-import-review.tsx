"use client";
import { useState } from "react";
import {
  MaterialImportJob,
  MaterialImportRow,
  MATERIAL_EXCEL_COLUMNS,
} from "@jongro/shared";
async function api<T>(
  path: string,
  body: unknown,
  method = "POST",
): Promise<T> {
  const r = await fetch("/api/material-prices/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const v = await r
    .json()
    .catch(() => ({
      message:
        r.status === 413
          ? "검토 자료가 너무 큽니다. 파일을 나누어 업로드하세요."
          : "서버 연결 또는 응답을 확인해 주세요. 처리 상태를 다시 조회해 주세요.",
    }));
  if (!r.ok) throw Error(v.message ?? "검토 저장 실패");
  return v;
}
export default function MaterialImportReview({
  initial,
  canApprove,
  onChanged,
}: {
  initial: MaterialImportJob;
  canApprove: boolean;
  onChanged: (job: MaterialImportJob) => void;
}) {
  const [job, setJob] = useState(initial),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [spec, setSpec] = useState(""),
    [trade, setTrade] = useState(""),
    [filter, setFilter] = useState("전체"),
    [selected, setSelected] = useState<number[]>([]),
    [page, setPage] = useState(0),
    [reason, setReason] = useState("");
  const closed = ["반영완료", "취소"].includes(job.status);
  const update = (j: MaterialImportJob) => {
    setJob(j);
    setDirty(false);
    onChanged(j);
  };
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
  const save = () =>
    api<MaterialImportJob>(
      `imports/${job.id}/review`,
      {
        revision: job.revision,
        rows: job.rows.map(({ rowNumber, values, action }) => ({
          rowNumber,
          values,
          action,
        })),
      },
      "PUT",
    );
  const change = (
    n: number,
    fn: (r: MaterialImportRow) => MaterialImportRow,
  ) => {
    setJob({
      ...job,
      rows: job.rows.map((r) => (r.rowNumber === n ? fn(r) : r)),
    });
    setDirty(true);
  };
  const rows = job.rows.filter(
    (r) =>
      String(r.values[1]).includes(query) &&
      String(r.values[2]).includes(spec) &&
      (!trade || String(r.values[4]) === trade) &&
      (filter === "전체" ||
        (filter === "가격없음" && String(r.values[9]).trim() === "") ||
        (filter === "중복" && r.duplicate) ||
        (filter === "오류" && r.status === "오류") ||
        (filter === "제외" && r.action === "제외")),
  );
  const visible = rows.slice(page * 30, (page + 1) * 30);
  return (
    <section className="material-review" aria-label="업로드 검토">
      <h3>
        {job.filename} · {job.status}
      </h3>
      <p>
        운영 자료는 최종 승인 전까지 변경되지 않습니다. 검토는 저장 후 나중에
        이어갈 수 있습니다.
      </p>
      <div className="detail-totals">
        {[
          ["전체 품목", job.summary.total],
          ["신규 예정", job.summary.new],
          ["갱신 예정", job.summary.updated],
          ["중복 확인", job.summary.duplicates ?? 0],
          ["오류·누락", job.summary.errors],
          ["제외", job.summary.excluded ?? 0],
        ].map(([l, v]) => (
          <div key={l}>
            <span>{l}</span>
            <strong>{v}건</strong>
          </div>
        ))}
      </div>
      {dirty && (
        <p role="status">
          편집 중 · 검토 저장을 누르면 오류와 예상 건수를 다시 계산합니다.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label>
          품명 검색
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          규격 검색
          <input
            value={spec}
            onChange={(e) => {
              setSpec(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          공종 필터
          <select
            value={trade}
            onChange={(e) => {
              setTrade(e.target.value);
              setPage(0);
            }}
          >
            <option value="">전체 공종</option>
            {[...new Set(job.rows.map((r) => String(r.values[4])))]
              .filter(Boolean)
              .map((t) => (
                <option key={t}>{t}</option>
              ))}
          </select>
        </label>
        <label>
          검토 필터
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            {["전체", "가격없음", "중복", "오류", "제외"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      {!closed && (
        <div className="worker-actions">
          <button
            type="button"
            onClick={() => setSelected(visible.map((r) => r.rowNumber))}
          >
            현재 페이지 선택
          </button>
          <button
            type="button"
            disabled={!selected.length}
            onClick={() => {
              setJob({
                ...job,
                rows: job.rows.map((r) =>
                  selected.includes(r.rowNumber) ? { ...r, action: "제외" } : r,
                ),
              });
              setDirty(true);
              setSelected([]);
            }}
          >
            선택 행 제외
          </button>
        </div>
      )}
      <div className="table-scroll material-review-table">
        <table>
          <thead>
            <tr>
              <th>선택</th>
              <th>행 / 상태</th>
              <th>처리방식</th>
              {MATERIAL_EXCEL_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>기존 자료 비교 / 오류</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.rowNumber}
                className={r.action === "제외" ? "excluded-row" : ""}
              >
                <td>
                  <input
                    aria-label={`${r.rowNumber}행 선택`}
                    type="checkbox"
                    checked={selected.includes(r.rowNumber)}
                    disabled={closed}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, r.rowNumber]
                          : selected.filter((n) => n !== r.rowNumber),
                      )
                    }
                  />
                </td>
                <td>
                  {r.rowNumber} · {r.action === "제외" ? "제외" : r.status}
                  {r.duplicate && <strong> 중복확인</strong>}
                </td>
                <td>
                  <select
                    aria-label={`${r.rowNumber}행 처리방식`}
                    disabled={closed || busy}
                    value={r.action ?? ""}
                    onChange={(e) =>
                      change(r.rowNumber, (x) => ({
                        ...x,
                        action: (e.target.value ||
                          undefined) as MaterialImportRow["action"],
                      }))
                    }
                  >
                    <option value="">자동 비교</option>
                    {["갱신", "신규등록", "제외", "보류"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </td>
                {r.values.map((v, i) => (
                  <td key={i}>
                    <input
                      aria-label={`${r.rowNumber}행 ${MATERIAL_EXCEL_COLUMNS[i]}`}
                      disabled={closed || busy}
                      value={v}
                      onChange={(e) =>
                        change(r.rowNumber, (x) => ({
                          ...x,
                          values: x.values.map((a, j) =>
                            j === i ? e.target.value : a,
                          ),
                        }))
                      }
                    />
                  </td>
                ))}
                <td>
                  {r.before && (
                    <details>
                      <summary>기존 자료와 비교</summary>
                      <p>
                        {r.before.materialCode ?? r.before.id} · {r.before.name}{" "}
                        / {r.before.specification} / {r.before.unit}
                      </p>
                      <p>
                        최근매입가{" "}
                        {r.before.purchasePriceRegistered === false
                          ? "미입력"
                          : (r.before.purchasePrice ?? "미입력")}{" "}
                        → {String(r.values[7]) || "미입력"}
                      </p>
                      <p>
                        기준원가{" "}
                        {r.before.costRegistered === false
                          ? "미입력"
                          : r.before.cost}{" "}
                        → {String(r.values[8]) || "미입력"}
                      </p>
                      <p>
                        판매단가{" "}
                        {r.before.priceRegistered === false
                          ? "미입력"
                          : r.before.salePrice}{" "}
                        → {String(r.values[9]) || "미입력"}
                      </p>
                    </details>
                  )}
                  {r.errors.join(" / ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="worker-actions">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          이전 검토 페이지
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(rows.length / 30))} ·{" "}
          {rows.length}행
        </span>
        <button
          type="button"
          disabled={(page + 1) * 30 >= rows.length}
          onClick={() => setPage(page + 1)}
        >
          다음 검토 페이지
        </button>
      </div>
      {!closed && (
        <>
          <div className="worker-actions">
            <button
              disabled={busy}
              onClick={() => void run(async () => update(await save()))}
            >
              검토 저장·재검증
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const j = dirty ? await save() : job;
                  update(
                    await api(`imports/${j.id}/submit`, {
                      revision: j.revision,
                    }),
                  );
                })
              }
            >
              승인 요청
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "업로드 검토 전체를 취소할까요? 운영 자료는 유지됩니다.",
                  )
                )
                  void run(async () =>
                    update(await api(`imports/${job.id}/cancel`, {})),
                  );
              }}
            >
              업로드 취소
            </button>
          </div>
          {canApprove && (
            <div className="approval-box">
              <label>
                승인 사유
                <input
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>최종 승인권자 전용 · 저장된 검토 값만 등록합니다.</p>
              {["전체", "정상행만"].map((mode) => (
                <button
                  className={mode === "전체" ? "primary" : ""}
                  key={mode}
                  disabled={
                    busy ||
                    dirty ||
                    job.status !== "승인대기" ||
                    (mode === "전체" && job.summary.errors > 0)
                  }
                  onClick={() => {
                    if (
                      confirm(
                        `${mode === "전체" ? "전체" : "오류·보류를 제외한 정상행"}를 최종 승인하여 운영 자재DB에 반영할까요? 신규 ${job.summary.new}건 / 갱신 ${job.summary.updated}건`,
                      )
                    )
                      void run(async () =>
                        update(
                          await api(`imports/${job.id}/apply`, {
                            mode,
                            revision: job.revision,
                            reason,
                          }),
                        ),
                      );
                  }}
                >
                  {mode === "전체" ? "최종 승인·등록" : "정상행만 최종 승인"}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {job.status === "반영완료" && (
        <p role="status">
          {job.appliedCount}건 반영 완료 · 승인자 {job.approvedBy} ·{" "}
          {job.approvedAt}
        </p>
      )}
    </section>
  );
}
