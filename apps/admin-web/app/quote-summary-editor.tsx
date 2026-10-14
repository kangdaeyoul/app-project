"use client";
import { useState } from "react";
import {
  QuoteInput,
  QuotePublicTotals,
  quoteCompanyDefaults,
  DEFAULT_COMPANY,
  QuoteRecipientSnapshot,
} from "@jongro/shared";
import QuoteCompanyEditor from "./quote-company-editor";
import QuoteSummaryPreview from "./quote-summary-preview";
export default function QuoteSummaryEditor({
  quote,
  onChange,
  totals,
  documentNumber,
  disabled = false,
}: {
  disabled?: boolean;
  documentNumber?: string;
  quote: QuoteInput;
  onChange: (patch: Partial<QuoteInput>) => void;
  totals: QuotePublicTotals;
}) {
  const [preview, setPreview] = useState(false);
  const recipient = quote.customerSnapshot ?? {
    name: "",
    recipient: "",
    address: "",
    contactName: "",
    phone: "",
    registrationNumber: "",
  };
  return (
    <section className="quote-summary-edit">
      <div className="panel-title">
        <div>
          <h3>견적 요약</h3>
          <p>
            {quote.siteName || "현장명 미입력"} ·{" "}
            {recipient.name || "거래처 입력 안 함"}
          </p>
        </div>
        <button type="button" onClick={() => setPreview(true)}>
          견적 요약 미리보기
        </button>
      </div>
      <fieldset className="quote-fieldset" disabled={disabled}>
        <details>
          <summary>수신정보 · 회사정보 수정</summary>
          <div className="quote-summary-edit-grid">
            <div>
              <div className="form-grid">
                {(
                  [
                    "siteName",
                    "address",
                    "quoteDate",
                    "validUntil",
                    "notes",
                  ] as const
                ).map((key, i) => (
                  <label key={key}>
                    {
                      [
                        "현장명",
                        "현장 주소",
                        "견적일",
                        "견적 유효기간",
                        "견적 비고",
                      ][i]
                    }
                    <input
                      aria-label={
                        [
                          "요약 현장명",
                          "요약 현장 주소",
                          "요약 견적일",
                          "요약 견적 유효기간",
                          "요약 견적 비고",
                        ][i]
                      }
                      type={
                        key === "quoteDate" || key === "validUntil"
                          ? "date"
                          : "text"
                      }
                      value={quote[key]}
                      onChange={(e) => onChange({ [key]: e.target.value })}
                    />
                  </label>
                ))}

                {(
                  [
                    "name",
                    "recipient",
                    "contactName",
                    "phone",
                    "address",
                  ] as const
                ).map((key, i) => (
                  <label key={key}>
                    {
                      [
                        "거래처명 (이번 견적)",
                        "수신처",
                        "거래처 담당자",
                        "거래처 연락처",
                        "거래처 주소",
                      ][i]
                    }
                    <input
                      aria-label={
                        [
                          "거래처명 (이번 견적)",
                          "수신처",
                          "거래처 담당자",
                          "거래처 연락처",
                          "거래처 주소",
                        ][i]
                      }
                      value={recipient[key]}
                      onChange={(e) =>
                        onChange({
                          customerSnapshot: {
                            ...recipient,
                            [key]: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  공사기간 / 납기
                  <input
                    aria-label="공사기간 / 납기"
                    value={quote.workPeriod ?? ""}
                    onChange={(e) => onChange({ workPeriod: e.target.value })}
                  />
                </label>
              </div>
              <details>
                <summary>회사정보 · 로고 · 직인 (이번 견적에만 적용)</summary>
                <QuoteCompanyEditor
                  value={
                    quote.companySnapshot ??
                    quoteCompanyDefaults(DEFAULT_COMPANY)
                  }
                  onChange={(companySnapshot) => onChange({ companySnapshot })}
                />
              </details>
            </div>
            <div className="quote-inline-paper">
              <QuoteSummaryPreview
                quote={quote}
                totals={totals}
                id={documentNumber}
              />
            </div>
          </div>
        </details>
      </fieldset>
      {preview && (
        <div
          className="quote-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="견적 요약 미리보기"
        >
          <button
            type="button"
            className="quote-preview-close"
            onClick={() => setPreview(false)}
          >
            미리보기 닫기
          </button>
          <QuoteSummaryPreview
            quote={quote}
            totals={totals}
            id={documentNumber}
          />
        </div>
      )}
    </section>
  );
}
