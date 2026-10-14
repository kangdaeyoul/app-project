import { BadRequestException } from "@nestjs/common";
import {
  Company,
  QuoteCompanySnapshot,
  QuoteImageAsset,
  quoteCompanyDefaults,
  QUOTE_COMPANY_FIELDS,
} from "@jongro/shared";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
let templateImages: Record<string, Uint8Array> | undefined;
export function companyPresentation(company: Company): QuoteCompanySnapshot {
  const profile = quoteCompanyDefaults(company);
  if (
    !company.quoteProfile &&
    company.id === "jongro" &&
    company.quoteTemplate?.kind === "jongro-2026"
  ) {
    templateImages ??= unzipSync(
      readFileSync(join(__dirname, "../fixtures/quotes/jongro-2026.xlsx")),
    );
    const asset = (key: string, mime: string): QuoteImageAsset => {
      const dataUrl = `data:${mime};base64,${Buffer.from(templateImages![key]).toString("base64")}`;
      return {
        companyId: company.id,
        dataUrl,
        originalDataUrl: dataUrl,
        filename: key.split("/").pop()!,
        backgroundRemoved: false,
      };
    };
    profile.logo = asset("xl/media/image2.jpeg", "image/jpeg");
    if (company.sealKey)
      profile.seal = asset("xl/media/image1.png", "image/png");
  }
  return profile;
}
function asset(value: unknown, companyId: string): QuoteImageAsset | null {
  if (value === null || value === undefined) return null;
  const a = value as QuoteImageAsset;
  if (!a || a.companyId !== companyId)
    throw new BadRequestException("현재 회사의 이미지로만 구성할 수 있습니다.");
  for (const url of [a.dataUrl, a.originalDataUrl]) {
    if (
      typeof url !== "string" ||
      url.length > 3000000 ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(url)
    )
      throw new BadRequestException("PNG/JPG 이미지 정보를 확인하세요.");
    const b = Buffer.from(url.split(",")[1], "base64");
    if (
      (url.startsWith("data:image/png") &&
        !b
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (url.startsWith("data:image/jpeg") &&
        !(b[0] === 255 && b[1] === 216 && b[2] === 255))
    )
      throw new BadRequestException("이미지 유형과 파일 내용을 확인하세요.");
    if (!(
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (b[0] === 255 && b[1] === 216 && b[2] === 255)
    ))
      throw new BadRequestException("이미지 형식을 확인하세요.");
    if (
      url.startsWith("data:image/png") &&
      (b.length < 24 || b.readUInt32BE(16) * b.readUInt32BE(20) > 10000000)
    )
      throw new BadRequestException("이미지 해상도가 너무 큽니다.");
  }
  return {
    pixelWidth:
      typeof a.pixelWidth === "number" &&
      a.pixelWidth > 0 &&
      a.pixelWidth <= 10000
        ? a.pixelWidth
        : undefined,
    pixelHeight:
      typeof a.pixelHeight === "number" &&
      a.pixelHeight > 0 &&
      a.pixelHeight <= 10000
        ? a.pixelHeight
        : undefined,
    companyId,
    dataUrl: a.dataUrl,
    originalDataUrl: a.originalDataUrl,
    filename:
      typeof a.filename === "string" ? a.filename.slice(0, 200) : "image.png",
    backgroundRemoved: a.backgroundRemoved === true,
  };
}
export function cleanCompanyProfile(
  raw: unknown,
  company: Company,
): QuoteCompanySnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new BadRequestException("회사정보를 확인하세요.");
  const input = raw as Record<string, unknown>,
    p = companyPresentation(company);
  if (input.companyId !== undefined && input.companyId !== company.id)
    throw new BadRequestException("다른 회사정보를 사용할 수 없습니다.");
  for (const key of Object.keys(
    QUOTE_COMPANY_FIELDS,
  ) as (keyof typeof QUOTE_COMPANY_FIELDS)[]) {
    const v = input[key] ?? p[key];
    if (
      typeof v !== "string" ||
      v.length > (key === "footer" ? 3000 : 600) ||
      /[\u0000-\u0008\u000b-\u001f]/.test(v)
    )
      throw new BadRequestException("회사정보 입력값을 확인하세요.");
    p[key] = v.trim();
  }
  if (!p.name) throw new BadRequestException("회사명을 입력하세요.");
  for (const key of [
    "logoWidth",
    "sealWidth",
    "sealOffsetX",
    "sealOffsetY",
  ] as const) {
    const v = input[key] ?? p[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      (key.endsWith("Width") ? v < 10 || v > 60 : v < -30 || v > 30)
    )
      throw new BadRequestException("이미지 크기/위치를 확인하세요.");
    p[key] = v;
  }
  p.logo = asset(input.logo === undefined ? p.logo : input.logo, company.id);
  p.seal = asset(input.seal === undefined ? p.seal : input.seal, company.id);
  return p;
}

export function companyBranding(company: Company): Company {
  const { quoteProfile, ...basic } = company;
  const logo = quoteProfile?.logo;
  if (logo)
    basic.logoUrl = `/api/company/branding/logo?company=${encodeURIComponent(company.id)}&version=${createHash("sha256").update(logo.dataUrl).digest("hex")}`;
  return basic;
}
