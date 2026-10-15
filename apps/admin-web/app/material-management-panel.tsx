"use client";
import GuidedNumberInput from "./quote-number-input";
import UniversalMaterialImport from "./universal-material-import";
import MaterialImportReview from "./material-import-review";
import { useEffect, useRef, useState } from "react";
import {
  WorkPrice,
  MaterialImportJob,
  MaterialPriceHistory,
  MATERIAL_EXCEL_COLUMNS,
} from "@jongro/shared";
import { useAuth } from "./auth-provider";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api/material-prices/" + path, init);
  const v = await r
    .json()
    .catch(() => ({
      message:
        r.status === 413
          ? "검토 자료가 너무 큽니다. 파일을 나누어 업로드하세요."
          : "서버 연결 또는 응답을 확인해 주세요. 처리 상태를 다시 조회해 주세요.",
    }));
  if (!r.ok) throw Error(v.message ?? "자재 요청 실패");
  return v;
}
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const empty = (): WorkPrice => ({
  id: "",
  companyId: "",
  materialCode: "",
  name: "",
  specification: "",
  unit: "개",
  category: "재료비",
  cost: 0,
  salePrice: 0,
  priceRegistered: false,
  costRegistered: false,
  purchasePriceRegistered: false,
  trade: "",
  manufacturer: "",
  supplier: "",
  vatIncluded: false,
  costVatIncluded: false,
  saleVatIncluded: false,
  effectiveDate: "",
  notes: "",
  salePriceSource: "직접입력",
  markupPercent: 30,
  active: true,
});
function values(p: WorkPrice) {
  const amount = (n: number | undefined, registered: boolean | undefined) =>
    n === undefined
      ? "권한없음"
      : registered === false
        ? "미입력"
        : n.toLocaleString("ko-KR");
  return [
    p.materialCode ?? p.id,
    p.name,
    p.specification,
    p.unit,
    p.trade ?? "",
    p.manufacturer ?? "",
    p.supplier ?? "",
    amount(p.purchasePrice, p.purchasePriceRegistered),
    amount(p.cost, p.costRegistered ?? p.priceRegistered),
    amount(p.salePrice, p.priceRegistered),
    p.vatIncluded ? "포함" : "미포함",
    p.effectiveDate ?? "",
    p.notes ?? "",
  ];
}
const fieldLabels: Record<string, string> = {
  materialCode: "자재코드",
  name: "자재명",
  specification: "규격",
  unit: "단위",
  trade: "공종",
  manufacturer: "제조사",
  supplier: "공급업체",
  purchasePrice: "최근매입가",
  cost: "기준원가",
  salePrice: "기준판매단가",
  vatIncluded: "공통 VAT 포함",
  costVatIncluded: "원가 VAT 포함",
  saleVatIncluded: "판매 VAT 포함",
  effectiveDate: "적용일",
  notes: "비고",
  active: "활성 상태",
  priceRegistered: "판매단가 등록",
  costRegistered: "원가 등록",
  purchasePriceRegistered: "매입가 등록",
  salePriceSource: "판매가격 방식",
  markupPercent: "가산율",
  category: "금액 분류",
};
const historyValue = (v: unknown) =>
  v === null || v === undefined
    ? "미입력"
    : typeof v === "boolean"
      ? v
        ? "예"
        : "아니오"
      : String(v);
export default function MaterialManagementPanel() {
  const { user } = useAuth();
  const canEdit =
    user?.role === "admin" ||
    !!user?.permissions.some(
      (p) => p === "manageMaterials" || p === "approveMaterials",
    );
  const canApprove =
    user?.role === "admin" || !!user?.permissions.includes("approveMaterials");
  const [tab, setTab] = useState("등록 자재관리"),
    [prices, setPrices] = useState<WorkPrice[]>([]),
    [storage, setStorage] = useState(""),
    [edit, setEdit] = useState<WorkPrice | null>(null),
    [detail, setDetail] = useState<WorkPrice | null>(null),
    [reason, setReason] = useState(""),
    [job, setJob] = useState<MaterialImportJob | null>(null),
    [jobs, setJobs] = useState<MaterialImportJob[]>([]),
    [history, setHistory] = useState<MaterialPriceHistory[]>([]),
    [search, setSearch] = useState(""),
    [trade, setTrade] = useState(""),
    [sort, setSort] = useState("name"),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [showInactive, setShowInactive] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const v = await api<{ prices: WorkPrice[]; storage: string }>("catalog");
    setPrices(v.prices);
    setStorage(v.storage);
    if (canEdit) {
      setJobs(await api("imports"));
      setHistory(await api("history"));
    }
  };
  useEffect(() => {
    let active = true;
    void refresh().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [user?.id, canEdit]);
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
  const download = (type: string) =>
    void run(async () => {
      const r = await fetch("/api/material-prices/" + type);
      if (!r.ok) throw Error("다운로드 실패");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download =
        type === "template"
          ? "자재단가_표준양식.xlsx"
          : type === "catalog/backup"
            ? "자재관리_백업.json"
            : "현재_자재목록.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const openJob = (j: MaterialImportJob) => {
    setJob(j);
    setTab("엑셀 업로드·검토");
  };
  const filtered = prices
    .filter(
      (p) =>
        (showInactive || p.active !== false) &&
        [p.materialCode ?? p.id, p.name, p.specification]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!trade || p.trade === trade),
    )
    .sort((a, b) =>
      sort === "salePrice"
        ? (a.salePrice ?? 0) - (b.salePrice ?? 0)
        : String(a[sort as keyof WorkPrice] ?? "").localeCompare(
            String(b[sort as keyof WorkPrice] ?? ""),
            "ko",
          ),
    );
  const change = (k: keyof WorkPrice, v: unknown) =>
    setEdit((e) => (e ? { ...e, [k]: v } : e));
  return (
    <section className="panel material-management">
      <h2>자재단가 관리</h2>
      <p>
        최근매입가 · 견적 기준원가 · 고객 기준판매단가는 서로 별도 관리합니다.
        기존 견적의 저장 단가는 변경되지 않습니다.
      </p>
      <p role="status">
        저장소:{" "}
        {storage === "sqlite"
          ? "영구 SQLite"
          : storage === "postgres"
            ? "영구 PostgreSQL"
            : "메모리 · 재시작 시 초기화"}
        {storage === "sqlite" && " · 로컬 DB 파일 또는 영구 디스크 필요"}
      </p>
      <div className="tabs" role="tablist" aria-label="자재관리 탭">
        {["등록 자재관리", "엑셀 업로드·검토", "승인 대기", "변경 이력"].map(
          (t) => (
            <button
              role="tab"
              aria-selected={tab === t}
              disabled={!canEdit && t !== "등록 자재관리"}
              key={t}
              onClick={() => {
                setTab(t);
                setSearch("");
                setPage(0);
              }}
            >
              {t}
              {t === "승인 대기"
                ? ` (${jobs.filter((j) => j.status === "승인대기").length})`
                : ""}
            </button>
          ),
        )}
      </div>
      <div className="worker-actions">
        {canEdit && (
          <button
            disabled={busy}
            onClick={() => {
              setEdit(empty());
              setReason("");
            }}
          >
            자재 추가
          </button>
        )}
        <button disabled={busy} onClick={() => download("template")}>
          자재단가 양식 다운로드
        </button>
        <button disabled={busy} onClick={() => download("export")}>
          현재 자재목록 다운로드
        </button>
        {canEdit && (
          <button disabled={busy} onClick={() => file.current?.click()}>
            자재단가 엑셀 업로드
          </button>
        )}
        {user?.role === "admin" && (
          <button disabled={busy} onClick={() => download("catalog/backup")}>
            자료 백업 다운로드
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="자재단가 Excel 파일"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              void run(async () => {
                const body = new FormData();
                body.append("file", f);
                openJob(await api("imports/preview", { method: "POST", body }));
                await refresh();
              });
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
      {tab === "등록 자재관리" && (
        <>
          <div className="form-grid">
            <label>
              자재 검색
              <input
                aria-label="관리 자재 검색"
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              공종
              <select
                value={trade}
                onChange={(e) => {
                  setTrade(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">전체</option>
                {[...new Set(prices.map((p) => p.trade))]
                  .filter(Boolean)
                  .map((t) => (
                    <option key={t}>{t}</option>
                  ))}
              </select>
            </label>
            <label>
              정렬
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">자재명</option>
                <option value="materialCode">자재코드</option>
                <option value="salePrice">판매단가</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              비활성 자재 포함
            </label>
          </div>
          <div className="table-scroll material-catalog-table">
            <table>
              <thead>
                <tr>
                  {MATERIAL_EXCEL_COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th>상태 / 관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 40, (page + 1) * 40).map((p) => (
                  <tr key={p.id}>
                    {values(p).map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                    <td>
                      {p.active === false ? "비활성" : "활성"}
                      <button onClick={() => setDetail(p)}>상세보기</button>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => {
                              setEdit({ ...p });
                              setReason("");
                            }}
                          >
                            수정
                          </button>
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  `${p.name}을 ${p.active === false ? "활성" : "비활성"}으로 변경할까요? 과거 견적과 이력은 유지됩니다.`,
                                )
                              )
                                void run(async () => {
                                  await api(
                                    `catalog/${encodeURIComponent(p.id)}`,
                                    json(
                                      {
                                        ...p,
                                        active: p.active === false,
                                        auditReason: "활성 상태 변경",
                                      },
                                      "PUT",
                                    ),
                                  );
                                  await refresh();
                                  setNotice("자재 상태를 저장했습니다.");
                                });
                            }}
                          >
                            {p.active === false ? "활성화" : "비활성화"}
                          </button>
                          <button
                            onClick={() => {
                              setSearch(p.name);
                              setTab("변경 이력");
                            }}
                          >
                            변경 이력
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worker-actions">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              이전
            </button>
            <span>
              {filtered.length}건 · {page + 1} /{" "}
              {Math.max(1, Math.ceil(filtered.length / 40))}
            </span>
            <button
              disabled={(page + 1) * 40 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              다음
            </button>
          </div>
        </>
      )}
      {tab === "엑셀 업로드·검토" && (
        <>
          {canEdit && (
            <UniversalMaterialImport
              onApplied={() => void refresh()}
              onReviewed={(j) => {
                setJob(j);
                void refresh();
              }}
            />
          )}
          {job ? (
            <MaterialImportReview
              key={job.id + ":" + (job.revision ?? 0)}
              initial={job}
              canApprove={canApprove}
              onChanged={(j) => {
                setJob(j);
                void refresh();
              }}
            />
          ) : (
            <p>표준 양식을 업로드하거나 저장된 검토 내역을 선택하세요.</p>
          )}
          <h3>저장된 검토 내역</h3>
          {jobs
            .filter((j) => j.status !== "반영완료" && j.status !== "취소")
            .map((j) => (
              <button
                className="material-job-card"
                key={j.id}
                onClick={() => openJob(j)}
              >
                {j.filename} · {j.status} · {j.createdAt.slice(0, 10)} ·{" "}
                {j.summary.total}건
              </button>
            ))}
        </>
      )}
      {tab === "승인 대기" && (
        <>
          <h3>최종 승인 대기</h3>
          {jobs
            .filter((j) => j.status === "승인대기")
            .map((j) => (
              <button
                className="material-job-card"
                key={j.id}
                onClick={() => openJob(j)}
              >
                {j.filename} · 신규 {j.summary.new} / 갱신 {j.summary.updated} /
                오류 {j.summary.errors}
              </button>
            ))}
          {!jobs.some((j) => j.status === "승인대기") && (
            <p>승인 대기 중인 업로드가 없습니다.</p>
          )}
        </>
      )}
      {tab === "변경 이력" && (
        <>
          <label>
            이력 검색
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="자재명 · 코드 · 수정자 · 사유"
            />
          </label>
          <div className="table-scroll material-catalog-table">
            <table>
              <thead>
                <tr>
                  <th>변경일 / 적용일</th>
                  <th>자재</th>
                  <th>변경방식 / 사유</th>
                  <th>수정자 / 승인자</th>
                  <th>변경 전 → 후</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .filter((h) =>
                    [
                      h.materialName,
                      h.materialCode,
                      h.userDisplayName,
                      h.userId,
                      h.reason,
                    ]
                      .join(" ")
                      .includes(search),
                  )
                  .map((h) => (
                    <tr key={h.id}>
                      <td>
                        {new Date(h.changedAt).toLocaleString("ko-KR")}
                        <br />
                        {h.effectiveDate}
                      </td>
                      <td>
                        {h.materialCode ?? h.materialId}
                        <br />
                        {h.materialName}
                      </td>
                      <td>
                        {h.method}
                        <br />
                        {h.reason}
                      </td>
                      <td>
                        {h.userDisplayName ?? h.userId}
                        <br />
                        {h.approverDisplayName ?? h.approvedBy ?? "개별 수정"}
                      </td>
                      <td>
                        <details>
                          <summary>
                            변경 필드 {h.changes?.length ?? 3}개
                          </summary>
                          {h.changes?.map((c) => (
                            <p key={c.field}>
                              {fieldLabels[c.field] ?? c.field}:{" "}
                              {historyValue(c.before)} → {historyValue(c.after)}
                            </p>
                          )) ?? (
                            <p>
                              매입 {h.beforePurchasePrice} →{" "}
                              {h.afterPurchasePrice} / 원가 {h.beforeCost} →{" "}
                              {h.afterCost} / 판매 {h.beforeSalePrice} →{" "}
                              {h.afterSalePrice}
                            </p>
                          )}
                        </details>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {detail && (
        <div className="material-modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="자재 상세보기"
            className="material-modal"
          >
            <h3>{detail.name}</h3>
            <dl>
              {MATERIAL_EXCEL_COLUMNS.map((c, i) => (
                <div key={c}>
                  <dt>{c}</dt>
                  <dd>{values(detail)[i]}</dd>
                </div>
              ))}
            </dl>
            <p>
              판매가격 방식: {detail.salePriceSource ?? "직접입력"} · 원가 VAT{" "}
              {(detail.costVatIncluded ?? detail.vatIncluded)
                ? "포함"
                : "미포함"}{" "}
              · 판매 VAT{" "}
              {(detail.saleVatIncluded ?? detail.vatIncluded)
                ? "포함"
                : "미포함"}
            </p>
            <button onClick={() => setDetail(null)}>닫기</button>
          </section>
        </div>
      )}
      {edit && canEdit && (
        <div className="material-modal-backdrop">
          <section
            className="material-modal"
            role="dialog"
            aria-modal="true"
            aria-label="자재 편집"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const { companyId, id, ...body } = edit;
                  await api(
                    id ? `catalog/${encodeURIComponent(id)}` : "catalog",
                    json({ ...body, auditReason: reason }, id ? "PUT" : "POST"),
                  );
                  await refresh();
                  setEdit(null);
                  setNotice("자재정보와 변경 이력을 저장했습니다.");
                });
              }}
            >
              <h3>{edit.id ? "자재 수정" : "새 자재 등록"}</h3>
              <p>
                빈 단가는 미입력으로 저장합니다. 과거 견적과 구매·지출 금액은
                바뀌지 않습니다.
              </p>
              <div className="form-grid">
                {(
                  [
                    "materialCode",
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
                        "자재코드",
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
                      value={edit[k] ?? ""}
                      placeholder={
                        k === "materialCode" ? "비우면 자동 생성" : undefined
                      }
                      required={k === "name" || k === "unit"}
                      onChange={(e) => change(k, e.target.value)}
                    />
                  </label>
                ))}
                {(["purchasePrice", "cost", "salePrice"] as const).map(
                  (k, i) => (
                    <label key={k}>
                      {["최근매입가", "기준원가", "기준판매단가"][i]}
                      <input
                        aria-label={`자재 ${k}`}
                        inputMode="numeric"
                        value={
                          edit[
                            k === "purchasePrice"
                              ? "purchasePriceRegistered"
                              : k === "cost"
                                ? "costRegistered"
                                : "priceRegistered"
                          ] === false
                            ? ""
                            : (edit[k] ?? "")
                        }
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            [k]: e.target.value,
                            [k === "purchasePrice"
                              ? "purchasePriceRegistered"
                              : k === "cost"
                                ? "costRegistered"
                                : "priceRegistered"]:
                              e.target.value.trim() !== "",
                          })
                        }
                      />
                    </label>
                  ),
                )}
                <label>
                  판매가격 방식
                  <select
                    value={edit.salePriceSource ?? "직접입력"}
                    onChange={(e) => change("salePriceSource", e.target.value)}
                  >
                    {["직접입력", "원가가산", "소매가격"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {edit.salePriceSource === "원가가산" && (
                  <label>
                    원가 가산율 (%)
                    <GuidedNumberInput
                      type="number"
                      min="0"
                      max="1000"
                      step="0.1"
                      value={edit.markupPercent ?? 30}
                      onChange={(e) =>
                        change("markupPercent", Number(e.target.value))
                      }
                    />
                    <span>저장 시 기준원가로 계산합니다.</span>
                  </label>
                )}
                <label>
                  금액 분류
                  <select
                    value={edit.category}
                    onChange={(e) => change("category", e.target.value)}
                  >
                    {["재료비", "노무비", "경비"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {(
                  ["vatIncluded", "costVatIncluded", "saleVatIncluded"] as const
                ).map((k, i) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={edit[k] ?? edit.vatIncluded ?? false}
                      onChange={(e) =>
                        k === "vatIncluded"
                          ? setEdit({
                              ...edit,
                              vatIncluded: e.target.checked,
                              costVatIncluded: e.target.checked,
                              saleVatIncluded: e.target.checked,
                            })
                          : change(k, e.target.checked)
                      }
                    />
                    {
                      [
                        "표준 Excel 가격 VAT 포함",
                        "기준원가 VAT 포함",
                        "판매단가 VAT 포함",
                      ][i]
                    }
                  </label>
                ))}
                <label>
                  변경 사유
                  <input
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </div>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="material-modal-actions">
                <button className="primary" type="submit" disabled={busy}>
                  자재 저장
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEdit(null)}
                >
                  취소
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
