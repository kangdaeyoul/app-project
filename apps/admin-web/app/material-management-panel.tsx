"use client";
import { useEffect, useRef, useState } from "react";
import {
  WorkPrice,
  MaterialImportJob,
  MaterialPriceHistory,
  MATERIAL_EXCEL_COLUMNS,
} from "@jongno/shared";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api" + path, init);
  const v = await r.json();
  if (!r.ok) throw Error(v.message || "자재 요청 실패");
  return v;
}
const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const empty = (): WorkPrice => ({
  id: "",
  companyId: "",
  name: "",
  specification: "",
  unit: "개",
  category: "재료비",
  cost: 0,
  salePrice: 0,
  trade: "",
  manufacturer: "",
  supplier: "",
  purchasePrice: 0,
  vatIncluded: false,
  effectiveDate: "",
  notes: "",
});
export default function MaterialManagementPanel() {
  const [prices, setPrices] = useState<WorkPrice[]>([]),
    [edit, setEdit] = useState<WorkPrice | null>(null),
    [job, setJob] = useState<MaterialImportJob | null>(null),
    [history, setHistory] = useState<MaterialPriceHistory[]>([]),
    [historyName, setHistoryName] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const v = await api<{ prices: WorkPrice[] }>("/standard-work");
    setPrices(v.prices);
  };
  useEffect(() => {
    const c = new AbortController();
    api<{ prices: WorkPrice[] }>("/standard-work", { signal: c.signal })
      .then((v) => setPrices(v.prices))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const download = (template: boolean) =>
    run(async () => {
      const r = await fetch(
        `/api/material-prices/${template ? "template" : "export"}`,
      );
      if (!r.ok) throw Error("다운로드 실패");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = template ? "자재단가_표준양식.xlsx" : "현재_자재목록.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const upload = (f: File) =>
    run(async () => {
      setJob(null);
      const body = new FormData();
      body.append("file", f);
      setJob(
        await api("/material-prices/imports/preview", { method: "POST", body }),
      );
    });
  return (
    <section className="panel standard-work-panel material-management">
      <h2>자재단가 관리</h2>
      <div className="worker-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setEdit(empty());
            setHistory([]);
          }}
        >
          자재 추가
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download(true)}
        >
          자재단가 양식 다운로드
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download(false)}
        >
          현재 자재목록 다운로드
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          자재단가 엑셀 업로드
        </button>
        <input
          type="file"
          ref={file}
          aria-label="자재단가 Excel 파일"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="save-message">
          {notice}
        </p>
      )}
      {job && (
        <div className="material-import-preview">
          <h3>업로드 미리보기 · {job.filename}</h3>
          <div className="detail-totals">
            {[
              ["전체 행 수", job.summary.total],
              ["신규등록", job.summary.new],
              ["기존품목 수정", job.summary.updated],
              ["변경사항 없음", job.summary.unchanged],
              ["오류", job.summary.errors],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}건</strong>
              </div>
            ))}
          </div>
          <p>
            {job.status === "반영완료"
              ? `${job.appliedCount}건 반영 완료`
              : "아직 자재DB에 반영되지 않았습니다. 오류행은 Excel에서 수정 후 다시 업로드할 수 있습니다."}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Excel 행</th>
                  <th>상태</th>
                  {MATERIAL_EXCEL_COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th>오류 사유</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td>{r.status}</td>
                    {r.values.map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                    <td>{r.errors.join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={busy || job.status === "반영완료"}
            onClick={() =>
              void run(async () => {
                const v = await api<MaterialImportJob>(
                  `/material-prices/imports/${job.id}/apply`,
                  json({ mode: "정상행만" }),
                );
                setJob(v);
                await refresh();
                setNotice(
                  `정상행 ${v.appliedCount}건을 반영했습니다. 오류행은 제외했습니다.`,
                );
              })
            }
          >
            정상행만 반영
          </button>
          <button
            type="button"
            disabled={
              busy || job.status === "반영완료" || job.summary.errors > 0
            }
            onClick={() =>
              void run(async () => {
                const v = await api<MaterialImportJob>(
                  `/material-prices/imports/${job.id}/apply`,
                  json({ mode: "전체" }),
                );
                setJob(v);
                await refresh();
                setNotice(`${v.appliedCount}건을 전체 반영했습니다.`);
              })
            }
          >
            전체 반영
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            수정한 파일 다시 업로드
          </button>
        </div>
      )}
      {edit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { companyId: _company, id, ...body } = edit;
              await api(
                id ? `/standard-work/prices/${id}` : "/standard-work/prices",
                { ...json(body), method: id ? "PUT" : "POST" },
              );
              await refresh();
              setEdit(null);
              setNotice("자재정보와 단가이력을 저장했습니다.");
            });
          }}
        >
          <h3>{edit.id ? "자재 수정" : "새 자재 등록"}</h3>
          <p>자재코드: {edit.id || "등록 시 자동 생성"}</p>
          <div className="form-grid">
            {(
              [
                "name",
                "specification",
                "unit",
                "trade",
                "manufacturer",
                "supplier",
                "effectiveDate",
                "notes",
              ] as const
            ).map((k, i) => (
              <label key={k}>
                {
                  [
                    "자재명",
                    "규격",
                    "단위",
                    "공종",
                    "제조사",
                    "공급업체",
                    "적용일",
                    "비고",
                  ][i]
                }
                <input
                  aria-label={`자재 ${k}`}
                  type={k === "effectiveDate" ? "date" : "text"}
                  required={k === "name" || k === "unit"}
                  value={edit[k] ?? ""}
                  onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                />
              </label>
            ))}
            {(["purchasePrice", "cost", "salePrice"] as const).map((k, i) => (
              <label key={k}>
                {["최근매입가", "기준원가", "기준판매단가"][i]}
                <input
                  aria-label={`자재 ${k}`}
                  type="number"
                  min="0"
                  step="1"
                  max="1000000000"
                  required
                  value={edit[k] ?? 0}
                  onChange={(e) =>
                    setEdit({ ...edit, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <label>
              금액 분류
              <select
                value={edit.category}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    category: e.target.value as WorkPrice["category"],
                  })
                }
              >
                <option>재료비</option>
                <option>노무비</option>
                <option>경비</option>
              </select>
            </label>
            <label>
              부가세 포함
              <input
                type="checkbox"
                checked={edit.vatIncluded ?? false}
                onChange={(e) =>
                  setEdit({ ...edit, vatIncluded: e.target.checked })
                }
              />
            </label>
          </div>
          <button type="submit" disabled={busy}>
            자재 저장
          </button>
          <button type="button" onClick={() => setEdit(null)}>
            취소
          </button>
        </form>
      )}
      <label>
        자재 검색
        <input
          aria-label="관리 자재 검색"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="table-scroll" style={{ maxHeight: 420 }}>
        <table>
          <thead>
            <tr>
              {MATERIAL_EXCEL_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {prices
              .filter((p) =>
                [p.id, p.name, p.specification].join(" ").includes(search),
              )
              .map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.name}</td>
                  <td>{p.specification}</td>
                  <td>{p.unit}</td>
                  <td>{p.trade}</td>
                  <td>{p.manufacturer}</td>
                  <td>{p.supplier}</td>
                  <td>{p.purchasePrice ?? 0}</td>
                  <td>{p.priceRegistered === false ? "미등록" : p.cost}</td>
                  <td>
                    {p.priceRegistered === false ? "미등록" : p.salePrice}
                  </td>
                  <td>{p.vatIncluded ? "포함" : "미포함"}</td>
                  <td>{p.effectiveDate}</td>
                  <td>{p.notes}</td>
                  <td>
                    <button type="button" onClick={() => setEdit({ ...p })}>
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setHistory(
                            await api(
                              `/material-prices/${encodeURIComponent(p.id)}/history`,
                            ),
                          );
                          setHistoryName(p.name);
                        })
                      }
                    >
                      단가이력
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {historyName && (
        <div>
          <h3>{historyName} 단가 변경이력</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>변경일</th>
                  <th>적용일</th>
                  <th>방식</th>
                  <th>매입가 전 → 후</th>
                  <th>원가 전 → 후</th>
                  <th>판매단가 전 → 후</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.changedAt}</td>
                    <td>{h.effectiveDate}</td>
                    <td>{h.method}</td>
                    <td>
                      {h.beforePurchasePrice ?? "신규"} → {h.afterPurchasePrice}
                    </td>
                    <td>
                      {h.beforeCost ?? "신규"} → {h.afterCost}
                    </td>
                    <td>
                      {h.beforeSalePrice ?? "신규"} → {h.afterSalePrice}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!history.length && <p>단가 변경이력이 없습니다.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
