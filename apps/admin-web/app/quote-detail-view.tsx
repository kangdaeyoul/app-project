"use client";
import { useAuth } from "./auth-provider";
import { QuoteView, QUOTE_PRINT_MODES } from "@jongro/shared";
import QuoteSummaryPreview from "./quote-summary-preview";
import PdfPreview from "./pdf-preview";
export default function QuoteDetailView({
  quote,
  onEdit,
  onCopy,
  onRemove,
  onPrint,
  onShare,
  onBack,
  onSite,
  onConvert,
  busy,
  mode,
  onMode,
  preview,
}: {
  quote: QuoteView;
  onEdit: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onPrint: (download: boolean, excel?: boolean) => void;
  onShare: () => void;
  onBack: () => void;
  onSite: (id: string) => void;
  onConvert: () => void;
  busy: boolean;
  mode: string;
  onMode: (v: string) => void;
  preview: string;
}) {
  const admin = useAuth().user?.role === "admin";
  const action = (label: string, fn: () => void, disabled = false) => (
    <button type="button" disabled={busy || disabled} onClick={fn}>
      {label}
    </button>
  );
  return (
    <section className="quote-detail-readonly">
      <div className="panel-title">
        <div>
          <h2>견적 상세보기</h2>
          <p>
            {quote.siteName} · {quote.quoteNumber ?? quote.id}
          </p>
        </div>
        {action("견적 목록", onBack)}
      </div>
      <div className="quote-detail-status">
        <span className="badge">{quote.status}</span>
        <span>작성일 {quote.createdAt.slice(0, 10)}</span>
        <span>최종수정 {quote.updatedAt.slice(0, 10)}</span>
        {quote.convertedSiteId || quote.siteId
          ? action("연결 현장 보기", () =>
              onSite((quote.convertedSiteId || quote.siteId)!),
            )
          : null}
        {admin && action("삭제", onRemove, !!quote.convertedSiteId)}
        {admin &&
          action(
            "현장 생성",
            onConvert,
            quote.status !== "승인" || !!quote.convertedSiteId,
          )}
      </div>
      <label>
        출력모드
        <select
          aria-label="출력모드"
          value={mode}
          onChange={(e) => onMode(e.target.value)}
        >
          {QUOTE_PRINT_MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <QuoteSummaryPreview
        quote={quote}
        hiddenAmounts={mode === "금액 숨김"}
        totals={quote.totals}
        id={quote.quoteNumber ?? quote.id}
      />
      <div className="quote-readonly-sections">
        {[...quote.sections]
          .sort(
            (a, b) =>
              ["기계", "전기"].indexOf(a.kind) -
              ["기계", "전기"].indexOf(b.kind),
          )
          .filter((s) => s.items.length)
          .map((s) => (
            <section className="panel" key={s.kind}>
              <h3>{s.kind} 상세 내역서</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {["품명", "규격", "수량", "단위", "판매단가", "금액"].map(
                        (l) => (
                          <th key={l}>{l}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {s.items
                      .filter((i) => i.name.trim())
                      .map((i, n) => (
                        <tr key={n}>
                          <td data-label="품명">{i.name}</td>
                          <td data-label="규격">{i.specification}</td>
                          <td data-label="수량">{i.quantity}</td>
                          <td data-label="단위">{i.unit}</td>
                          <td data-label="판매단가">
                            {i.saleUnitPrice.toLocaleString("ko-KR")}
                          </td>
                          <td>
                            {Math.round(
                              i.quantity * i.saleUnitPrice,
                            ).toLocaleString("ko-KR")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </div>
      {preview && (
        <div className="report-preview">
          <PdfPreview url={preview} />
        </div>
      )}
      <div className="quote-detail-actions" aria-label="견적 상세 액션바">
        {action("수정", onEdit, !!quote.convertedSiteId)}
        {action("복사", onCopy)}
        {action("공유", onShare)}
        {action("PDF", () => onPrint(true))}
        {action("Excel", () => onPrint(true, true))}
        {action("미리보기", () => onPrint(false))}
      </div>
    </section>
  );
}
