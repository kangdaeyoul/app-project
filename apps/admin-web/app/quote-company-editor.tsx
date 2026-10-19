"use client";
import { useAuth } from "./auth-provider";
import { useState } from "react";
import {
  QUOTE_COMPANY_FIELDS,
  QuoteCompanySnapshot,
  QuoteImageAsset,
} from "@jongro/shared";
export default function QuoteCompanyEditor({
  value,
  onChange,
  disabled = false,
  onBusyChange,
}: {
  value: QuoteCompanySnapshot;
  onChange: (p: QuoteCompanySnapshot) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const admin = useAuth().user?.role === "admin";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload(kind: "logo" | "seal", file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError("이미지는 1MB 이하로 업로드하세요.");
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      const r = await fetch(`/api/company/quote-assets/${kind}`, {
        method: "POST",
        body: data,
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.message ?? "업로드 실패");
      onChange({ ...value, [kind]: v });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <fieldset disabled={disabled || busy} className="quote-fieldset">
      <div className="form-grid">
        {Object.entries(QUOTE_COMPANY_FIELDS).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={`회사정보 ${label}`}
              value={value[key as keyof typeof QUOTE_COMPANY_FIELDS]}
              readOnly={
                !admin &&
                [
                  "name",
                  "representative",
                  "registrationNumber",
                  "bankInfo",
                ].includes(key)
              }
              maxLength={key === "footer" ? 3000 : 600}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="quote-brand-assets">
        {(["logo", "seal"] as const).map((kind) => {
          const asset = value[kind],
            label = kind === "logo" ? "로고" : "직인",
            widthKey = kind === "logo" ? "logoWidth" : "sealWidth";
          return (
            <section key={kind}>
              <h4>회사 {label}</h4>
              {admin && (
                <label>
                  {label} PNG/JPG 업로드 (1MB 이하)
                  <input
                    aria-label={`${label} 업로드`}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      void upload(kind, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              {asset && (
                <>
                  <div className="quote-asset-previews">
                    {kind === "seal" && (
                      <figure>
                        <figcaption>원본</figcaption>
                        <img src={asset.originalDataUrl} alt="직인 원본" />
                      </figure>
                    )}
                    <figure>
                      <figcaption>
                        {kind === "seal" ? "배경 처리 결과" : "출력 이미지"}
                      </figcaption>
                      <img src={asset.dataUrl} alt={`${label} 출력 이미지`} />
                    </figure>
                  </div>
                  {kind === "seal" && (
                    <small>
                      밝은 단색 배경 처리 결과를 확인하세요. 복잡한 배경은 투명
                      PNG로 다시 업로드하세요.
                    </small>
                  )}
                  {admin && (
                    <button
                      type="button"
                      onClick={() => onChange({ ...value, [kind]: null })}
                    >
                      {label} 삭제
                    </button>
                  )}
                </>
              )}
              <label>
                {label} 크기 (mm)
                <input
                  aria-label={`${label} 크기`}
                  type="range"
                  min="10"
                  max="60"
                  value={value[widthKey]}
                  onChange={(e) =>
                    onChange({ ...value, [widthKey]: Number(e.target.value) })
                  }
                />
                {value[widthKey]}mm
              </label>
              {kind === "seal" &&
                (["sealOffsetX", "sealOffsetY"] as const).map((key, i) => (
                  <label key={key}>
                    직인 {i ? "세로" : "가로"} 위치 (mm)
                    <input
                      aria-label={`직인 ${i ? "세로" : "가로"} 위치`}
                      type="range"
                      min="-30"
                      max="30"
                      value={value[key]}
                      onChange={(e) =>
                        onChange({ ...value, [key]: Number(e.target.value) })
                      }
                    />
                    {value[key]}mm
                  </label>
                ))}
            </section>
          );
        })}
      </div>
      {busy && <p role="status">이미지 처리 중…</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
