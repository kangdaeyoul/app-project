"use client";
import { useEffect, useState } from "react";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGETS,
  AuditPage,
  AuditValue,
} from "@jongno/shared";
const labels: Record<string, string> = {
  id: "ID",
  siteId: "현장 ID",
  siteName: "현장명",
  name: "이름 / 명칭",
  client: "거래처",
  address: "주소",
  description: "내용",
  contactName: "담당자",
  phone: "연락처",
  startDate: "시작일",
  endDate: "종료예정일",
  contractAmount: "계약금액",
  status: "상태",
  managerId: "대표 작업진행자 ID",
  manager: "대표 작업진행자",
  managerDisplayName: "대표 작업진행자",
  displayName: "표시명",
  role: "직무",
  memo: "메모",
  defaultAvailability: "기본 작업 가능 상태",
  availability: "날짜별 작업 가능 상태",
  date: "날짜",
  workDate: "작업일자",
  startTime: "시작시간",
  endTime: "종료시간",
  content: "작업내용",
  notes: "비고",
  participants: "참여 작업자",
  materials: "사용자재",
  quantity: "수량",
  unit: "단위",
  specification: "규격",
  materialId: "자재 ID",
  dailyWorkId: "일일작업 ID",
  type: "구분",
  location: "작업 위치",
  capturedAt: "촬영일시",
  uploadedBy: "등록자",
  sortOrder: "정렬순서",
  originalFilename: "원본 파일명",
  storageKey: "파일 저장소 키",
  mimeType: "파일 형식",
  size: "파일 크기 (바이트)",
  expenseDate: "지출일자",
  vendor: "공급업체",
  supplyAmount: "공급가액",
  vat: "VAT",
  paymentMethod: "결제방법",
  evidenceType: "증빙유형",
  purchaser: "구매자 / 지출자",
  workerId: "작업진행자 ID",
  workerDisplayName: "작업진행자",
  isWorkerAdvance: "작업진행자 대납",
  settled: "정산완료",
  settlementDate: "정산일",
  receiptFileKey: "증빙파일",
  receivedDate: "입금일자",
  amount: "금액",
  method: "결제방법",
  payer: "입금자",
  paymentDate: "지급일자",
  totalPayable: "총 지급예정액",
  paidAmount: "지급완료액",
  unpaidAmount: "미지급액",
  allocations: "지급 배분",
  expenseId: "지출 ID",
  paymentId: "지급 ID",
  approvalNumber: "승인번호",
  counterparty: "거래처",
  invoiceType: "계산서 구분",
  supplier: "공급자",
  recipient: "공급받는자",
  registrationNumber: "사업자등록번호",
  representative: "대표자",
  businessType: "업태",
  businessItem: "종목",
  email: "이메일",
  customerId: "거래처 ID",
  customerName: "거래처",
  quoteDate: "견적일",
  validUntil: "유효기간",
  sections: "을지",
  kind: "구분",
  items: "항목",
  trade: "공종",
  saleUnitPrice: "판매단가",
  materialUnitCost: "재료비 단가 (내부)",
  laborUnitCost: "노무비 단가 (내부)",
  expenseUnitCost: "경비 단가 (내부)",
  internalGeneralCost: "일반관리비 (내부)",
  internalSupportCost: "착·준공지원비 (내부)",
  generalFee: "일반관리비",
  supportFee: "착·준공지원비",
  rounding: "반올림 방식",
  displayUnit: "표시 단위",
  priceCategory: "고객금액 분류",
  workContent: "공사내용",
  convertedSiteId: "계약전환 현장 ID",
  createdAt: "등록일시",
  updatedAt: "수정일시",
  deletedAt: "삭제 / 비활성화 일시",
  receiptIds: "연결 수금 ID",
  message: "안내",
  restricted: "접근 제한",
};
function readable(v: AuditValue): AuditValue {
  return Array.isArray(v)
    ? v.map(readable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v).map(([k, x]) => [labels[k] ?? k, readable(x)]),
        )
      : v;
}
const valueText = (v: AuditValue) =>
  v === null ? "없음" : JSON.stringify(readable(v), null, 2);
const dateText = (s: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(s));
export default function AuditPanel({ siteId }: { siteId?: string }) {
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    userId: "",
    siteId: "",
    action: "",
    targetType: "",
  });
  const [data, setData] = useState<AuditPage | null>(null),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setData(null);
    const query = new URLSearchParams({
      ...filters,
      page: String(page),
      pageSize: "25",
    });
    fetch(
      siteId
        ? `/api/sites/${encodeURIComponent(siteId)}/audit-logs?${query}`
        : `/api/audit-logs?${query}`,
      { signal: c.signal },
    )
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.message || "변경이력 조회 실패");
        return b;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, filters, page, revision]);
  const change = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  // Keep filter choices while a new query is loading.
  const [choices, setChoices] = useState<Pick<AuditPage, "users" | "sites">>({
    users: [],
    sites: [],
  });
  useEffect(() => {
    if (data) setChoices({ users: data.users, sites: data.sites });
  }, [data]);
  return (
    <section className="panel site-list audit-panel">
      <div className="panel-title">
        <div>
          <h2>{siteId ? "현장 변경이력" : "전체 감사로그"}</h2>
          <p>
            최신 기록순 · 변경일시는 서울 시간 기준입니다. 삭제된 기록의 이력도
            보관합니다.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setRevision((n) => n + 1)}
        >
          이력 새로고침
        </button>
      </div>
      <div className="site-filters audit-filters">
        <label>
          시작일
          <input
            aria-label="감사로그 시작일"
            type="date"
            value={filters.from}
            onChange={(e) => change("from", e.target.value)}
          />
        </label>
        <label>
          종료일
          <input
            aria-label="감사로그 종료일"
            type="date"
            value={filters.to}
            onChange={(e) => change("to", e.target.value)}
          />
        </label>
        <label>
          사용자
          <select
            aria-label="감사로그 사용자"
            value={filters.userId}
            onChange={(e) => change("userId", e.target.value)}
          >
            <option value="">전체 사용자</option>
            {choices.users.map((u) => (
              <option value={u.id} key={u.id}>
                {u.name} ({u.id})
              </option>
            ))}
          </select>
        </label>
        {!siteId && (
          <label>
            현장
            <select
              aria-label="감사로그 현장"
              value={filters.siteId}
              onChange={(e) => change("siteId", e.target.value)}
            >
              <option value="">전체 현장</option>
              {choices.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          작업종류
          <select
            aria-label="감사로그 작업종류"
            value={filters.action}
            onChange={(e) => change("action", e.target.value)}
          >
            <option value="">전체 작업</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          대상종류
          <select
            aria-label="감사로그 대상종류"
            value={filters.targetType}
            onChange={(e) => change("targetType", e.target.value)}
          >
            <option value="">전체 대상</option>
            {AUDIT_TARGETS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setFilters({
              from: "",
              to: "",
              userId: "",
              siteId: "",
              action: "",
              targetType: "",
            });
            setPage(1);
          }}
        >
          필터 초기화
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !data ? (
        <p role="status">변경이력을 불러오는 중입니다…</p>
      ) : (
        <>
          <p>총 {data.total}건</p>
          {data.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>변경일시</th>
                    <th>사용자</th>
                    <th>현장</th>
                    <th>대상</th>
                    <th>작업</th>
                    <th>사유 / 변경 내용</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>{dateText(row.changedAt)}</td>
                      <td>
                        {row.userDisplayName}
                        <small>{row.userId}</small>
                      </td>
                      <td>
                        {row.sites.map((s) => s.name).join(" · ") ||
                          "현장 미연결"}
                      </td>
                      <td>
                        {row.targetType}
                        <small className="audit-id">{row.targetId}</small>
                      </td>
                      <td>
                        <span className="badge">{row.action}</span>
                      </td>
                      <td>
                        <p>{row.reason}</p>
                        <details>
                          <summary>변경 전·후 보기</summary>
                          <div className="audit-snapshots">
                            <div>
                              <strong>변경 전 값</strong>
                              <pre>{valueText(row.before)}</pre>
                            </div>
                            <div>
                              <strong>변경 후 값</strong>
                              <pre>{valueText(row.after)}</pre>
                            </div>
                          </div>
                          <small>
                            회사 ID: {row.companyId} · 기록 ID: {row.id}
                          </small>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">
              조건에 맞는 변경이력이 없습니다. 등록·수정·삭제 후 이력 새로고침을
              눌러 확인하세요.
            </p>
          )}
          <div className="audit-pagination">
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage((n) => n - 1)}
            >
              이전 기록
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage((n) => n + 1)}
            >
              다음 기록
            </button>
          </div>
        </>
      )}
    </section>
  );
}
