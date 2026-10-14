"use client";
import {
  QuoteInput,
  QuotePublicTotals,
  QuoteCompanySnapshot,
  quoteCompanyDefaults,
  DEFAULT_COMPANY,
  quotePublicNotes,
} from "@jongro/shared";
const money = (n: number) => n.toLocaleString("ko-KR") + "원";
export default function QuoteSummaryPreview({
  quote,
  totals,
  id,
  hiddenAmounts = false,
}: {
  quote: QuoteInput;
  totals: QuotePublicTotals;
  id?: string;
  hiddenAmounts?: boolean;
}) {
  const p = quote.companySnapshot ?? quoteCompanyDefaults(DEFAULT_COMPANY),
    c = quote.customerSnapshot;
  const notes = quotePublicNotes(quote);
  const info = [
    ["대표자", p.representative],
    ["사업자등록번호", p.registrationNumber],
    ["주소", p.address],
    ["전화", p.phone],
    ["팩스", p.fax],
    ["이메일", p.email],
    ["홈페이지", p.website],
    [
      "업태 / 종목",
      [p.businessType, p.businessItem].filter(Boolean).join(" / "),
    ],
  ].filter(([, v]) => v);
  return (
    <article className="quote-paper-preview" aria-label="견적 요약 미리보기">
      <header>
        {p.logo && (
          <img
            src={p.logo.dataUrl}
            alt="견적 회사 로고"
            style={{
              width: `${p.logoWidth}mm`,
              height: `${p.logoWidth}mm`,
              maxHeight: "60mm",
              objectFit: "contain",
            }}
          />
        )}
        <div>
          <h3>{p.name}</h3>
          {info.map(([label, value]) => (
            <p key={label}>
              <span>{label}</span> {value}
            </p>
          ))}
        </div>
      </header>
      <h2>견 적 서</h2>
      <p className="quote-document-id">
        견적번호 {id ?? "저장 후 발급"} · 작성일 {quote.quoteDate}
      </p>
      <dl>
        {[
          ["거래처", c?.name],
          ["수신", c?.recipient],
          ["현장명", quote.siteName],
          ["현장주소", quote.address],
          ["담당자", c?.contactName],
          ["연락처", c?.phone],
        ]
          .filter(([, v]) => v)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <div className="quote-paper-total">
        <span>총 견적금액 (VAT 포함)</span>
        <strong>
          {hiddenAmounts ? "금액 비공개" : money(totals.totalAmount)}
        </strong>
      </div>
      <dl>
        {[
          ["재료비", totals.material],
          ["노무비", totals.labor],
          ["경비", totals.expense],
          ["일반관리비", totals.generalFee],
          ["착·준공지원비", totals.supportFee],
          ["고객가격 조정", totals.adjustment],
          ["공급가액", totals.supplyAmount],
          ["VAT", totals.vat],
        ]
          .filter(
            ([l, v]) => v !== 0 || ["공급가액", "VAT"].includes(String(l)),
          )
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{hiddenAmounts ? "금액 비공개" : money(Number(value))}</dd>
            </div>
          ))}
      </dl>
      <section>
        {quote.workPeriod && <p>공사기간 / 납기: {quote.workPeriod}</p>}
        <p>견적 유효기간: {quote.validUntil}</p>
        {quote.workContent && <p>공사내용: {quote.workContent}</p>}
        {notes && <p className="quote-note-text">비고: {notes}</p>}
        {p.footer && <p className="quote-note-text">{p.footer}</p>}
      </section>
      <footer>
        <div>
          <strong>{p.name}</strong>
          {(p.contactName || p.contactPhone) && (
            <p>
              {[p.contactName && `담당 ${p.contactName}`, p.contactPhone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {p.bankInfo && <p>계좌: {p.bankInfo}</p>}
        </div>
        {p.seal && (
          <img
            src={p.seal.dataUrl}
            alt="견적 회사 직인"
            style={{
              width: `${p.sealWidth}mm`,
              height: `${p.sealWidth}mm`,
              objectFit: "contain",
              transform: `translate(${p.sealOffsetX}mm,${p.sealOffsetY}mm)`,
            }}
          />
        )}
      </footer>
    </article>
  );
}
