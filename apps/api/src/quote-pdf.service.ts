import { companyPresentation } from "./quote-presentation";
import { CompanyContext } from "./company-context";
import { Inject, Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import {
  CustomerQuote,
  quoteLineAmount,
  quoteDocumentFilename,
} from "@jongro/shared";
import { QuotesService } from "./quotes.service";
@Injectable()
export class QuotePdfService {
  constructor(
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(CompanyContext) private readonly company: CompanyContext,
  ) {}
  // PDF renderer's only input is the explicit customer projection, never admin data.
  async render(id: string, mode: string) {
    return this.document(this.quotes.customer(id, mode));
  }
  private async document(q: CustomerQuote) {
    const company =
      q.companySnapshot ?? companyPresentation(this.company.settings());
    const recipient = q.customerSnapshot;
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: "견적서", Author: company.name },
    });
    const chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc.registerFont(
      "Korean",
      join(__dirname, "../fixtures/fonts/NanumGothic-Regular.ttf"),
    );
    const norm = (s: string) => s.replace(/\s+/g, " ");
    const price = (n: number) =>
      q.displayUnit === "만원"
        ? `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(n / 10000)}만원 (${n.toLocaleString("ko-KR")}원)`
        : `${n.toLocaleString("ko-KR")}원`;
    const header = (title: string) => {
      doc.addPage();
      doc.font("Korean").fillColor("#183d43");
      doc.fontSize(20).text("견적서", 36, 30, { width: 523, align: "center" });
      doc
        .fontSize(10)
        .text(company.name, 36, 61, { width: 523, align: "right" });
      if (q.customerName)
        doc
          .fontSize(10)
          .text(`거래처: ${norm(q.customerName)}`, 36, 84, { width: 523 });
      else doc.y = 84;
      doc.text(`현장명: ${norm(q.siteName)}`, 36, doc.y + 5, { width: 523 });
      doc.text(
        `견적일: ${q.quoteDate}     유효기간: ${q.validUntil}까지`,
        36,
        doc.y + 5,
        { width: 523 },
      );
      doc.fontSize(13).text(title, 36, doc.y + 14, { width: 523 });
      return doc.y + 12;
    };
    const hidden = q.printMode === "금액 숨김";
    doc.addPage();
    doc.font("Korean").fillColor("#203b55");
    const image = (
      asset: typeof company.logo,
      x: number,
      y: number,
      size: number,
    ) => {
      if (asset)
        doc.image(Buffer.from(asset.dataUrl.split(",")[1], "base64"), x, y, {
          fit: [size, size],
          align: "center",
          valign: "center",
        });
    };
    image(company.logo, 36, 30, (company.logoWidth * 72) / 25.4);
    const companyX = company.logo
      ? 36 + (company.logoWidth * 72) / 25.4 + 16
      : 36;
    doc.fontSize(17).text(company.name, companyX, 32, {
      width: 559 - companyX,
      align: "right",
    });
    let companyY = doc.y + 7;
    for (const line of [
      [
        company.representative && `대표 ${company.representative}`,
        company.registrationNumber &&
          `사업자등록번호 ${company.registrationNumber}`,
      ]
        .filter(Boolean)
        .join("  |  "),
      company.address,
      [
        company.phone && `전화 ${company.phone}`,
        company.fax && `팩스 ${company.fax}`,
      ]
        .filter(Boolean)
        .join("  ·  "),
      [company.email, company.website].filter(Boolean).join("  ·  "),
      [
        company.businessType && `업태 ${company.businessType}`,
        company.businessItem && `종목 ${company.businessItem}`,
      ]
        .filter(Boolean)
        .join("  ·  "),
    ].filter(Boolean)) {
      doc
        .fontSize(9)
        .fillColor("#526577")
        .text(line, companyX, companyY, {
          width: 559 - companyX,
          align: "right",
        });
      companyY = doc.y + 4;
    }
    let y = Math.max(135, companyY + 22);
    doc
      .fillColor("#203b55")
      .fontSize(25)
      .text("견 적 서", 36, y, { width: 523, align: "center" });
    y = doc.y + 10;
    doc
      .fontSize(9)
      .fillColor("#64748b")
      .text(
        `견적번호 ${q.quoteNumber ?? q.id}   |   작성일 ${q.quoteDate}`,
        36,
        y,
        {
          width: 523,
          align: "center",
        },
      );
    y = doc.y + 20;
    doc
      .strokeColor("#203b55")
      .lineWidth(1)
      .moveTo(36, y)
      .lineTo(559, y)
      .stroke();
    y += 14;
    const details: [string, string | undefined][] = [
      ["거래처", q.customerName],
      ["수신", recipient?.recipient],
      ["현장명", q.siteName],
      ["현장주소", q.address],
      ["담당자", recipient?.contactName],
      ["연락처", recipient?.phone],
    ];
    for (const [label, value] of details.filter(([, v]) => v?.trim())) {
      doc.fontSize(9).fillColor("#64748b").text(label, 36, y, { width: 78 });
      doc
        .fontSize(10)
        .fillColor("#203b55")
        .text(value!, 120, y, { width: 439 });
      y = Math.max(y + 23, doc.y + 8);
    }
    y += 8;
    doc.rect(36, y, 523, 68).fill("#f0f4f7");
    doc.fillColor("#203b55");
    doc.fontSize(10).text("총 견적금액 (VAT 포함)", 48, y + 12, { width: 250 });
    doc
      .fontSize(18)
      .text(hidden ? "금액 비공개" : price(q.totals.totalAmount), 48, y + 33, {
        width: 499,
        align: "right",
      });
    y += 82;
    const cover: [string, number][] = [
      ["재료비", q.totals.material],
      ["노무비", q.totals.labor],
      ["경비", q.totals.expense],
      ["일반관리비", q.totals.generalFee],
      ["착·준공지원비", q.totals.supportFee],
      ["고객가격 조정", q.totals.adjustment],
      ["공급가액", q.totals.supplyAmount],
      ["VAT", q.totals.vat],
    ];
    for (const [label, n] of cover.filter(
      ([label, n]) => n !== 0 || ["공급가액", "VAT"].includes(label),
    )) {
      doc.fontSize(9).fillColor("#526577").text(label, 48, y, { width: 200 });
      doc.fillColor("#203b55").text(hidden ? "금액 비공개" : price(n), 260, y, {
        width: 287,
        align: "right",
      });
      y += 19;
    }
    const extra: [string, string | undefined][] = [
      ["공사기간 / 납기", q.workPeriod],
      ["견적 유효기간", q.validUntil],
      ["공사내용", q.workContent],
      ["비고", q.notes],
      ["안내", company.footer],
    ];
    y += 12;
    for (const [label, value] of extra.filter(([, v]) => v?.trim())) {
      if (y > 690) {
        doc.addPage();
        y = 40;
      }
      doc
        .fontSize(9)
        .fillColor("#526577")
        .text(`${label}: ${value}`, 36, y, { width: 523 });
      y = doc.y + 8;
    }
    if (y > 685) {
      doc.addPage();
      y = 40;
    }
    y += 10;
    doc.strokeColor("#cbd5e1").moveTo(36, y).lineTo(559, y).stroke();
    y += 12;
    doc
      .fontSize(12)
      .fillColor("#203b55")
      .text(company.name, 36, y, { width: 400 });
    if (company.contactName || company.contactPhone)
      doc
        .fontSize(9)
        .text(
          [
            company.contactName && `담당 ${company.contactName}`,
            company.contactPhone,
          ]
            .filter(Boolean)
            .join("  ·  "),
          36,
          doc.y + 8,
          { width: 400 },
        );
    if (company.bankInfo)
      doc
        .fontSize(9)
        .text(`계좌: ${company.bankInfo}`, 36, doc.y + 8, { width: 400 });
    image(
      company.seal,
      Math.max(
        36,
        Math.min(
          559 - (company.sealWidth * 72) / 25.4,
          470 + (company.sealOffsetX * 72) / 25.4,
        ),
      ),
      Math.min(
        745 - (company.sealWidth * 72) / 25.4,
        y + (company.sealOffsetY * 72) / 25.4,
      ),
      (company.sealWidth * 72) / 25.4,
    );
    if (q.printMode !== "총액 위주")
      for (const s of q.sections) {
        if (!s.items.length) continue;
        let pageY = header(`${s.kind} 상세 내역서`);
        const showUnit = q.printMode === "전체 상세";
        const columns = hidden
          ? [
              ["공종 / 품명", 180],
              ["규격", 95],
              ["수량", 48],
              ["단위", 40],
              ["비고", 160],
            ]
          : showUnit
            ? [
                ["공종 / 품명", 130],
                ["규격", 70],
                ["수량", 42],
                ["단위", 32],
                ["단가 (원)", 75],
                ["금액 (원)", 80],
                ["비고", 94],
              ]
            : [
                ["공종 / 품명", 166],
                ["규격", 90],
                ["수량", 48],
                ["단위", 36],
                ["금액 (원)", 85],
                ["비고", 98],
              ];
        const widths = columns.map((c) => c[1] as number);
        const drawRow = (texts: string[], heading = false) => {
          doc.fontSize(heading ? 9 : 8);
          const height = Math.max(
            28,
            ...texts.map(
              (t, i) => doc.heightOfString(t, { width: widths[i] - 12 }) + 14,
            ),
          );
          if (pageY + height > 775) {
            pageY = header(`${s.kind} 상세 내역서 (계속)`);
            drawRow(
              columns.map((c) => c[0] as string),
              true,
            );
          }
          doc.fontSize(heading ? 9 : 8);
          let x = 36;
          for (let i = 0; i < texts.length; i++) {
            doc
              .strokeColor("#cad7d8")
              .rect(x, pageY, widths[i], height)
              .stroke();
            doc
              .fillColor("#20373b")
              .text(texts[i], x + 6, pageY + 7, { width: widths[i] - 12 });
            x += widths[i];
          }
          pageY += height;
        };
        drawRow(
          columns.map((c) => c[0] as string),
          true,
        );
        const items =
          q.printMode === "공종별 묶음"
            ? [...new Set(s.items.map((i) => i.trade))].map((trade) => {
                const group = s.items.filter((i) => i.trade === trade);
                return {
                  trade,
                  name: `${group.length}개 항목`,
                  specification: "공종별 합계",
                  quantity: 1,
                  unit: "식",
                  saleUnitPrice: 0,
                  amount: group.reduce((n, i) => n + i.amount, 0),
                  notes: group
                    .map((i) => `${i.name}${i.notes ? ` (${i.notes})` : ""}`)
                    .join("\n"),
                };
              })
            : s.items;
        for (const i of items) {
          const content = [
            `${i.trade}\n${i.name}`,
            i.specification,
            String(i.quantity),
            i.unit,
            ...(showUnit ? [i.saleUnitPrice.toLocaleString("ko-KR")] : []),
            ...(!hidden ? [i.amount.toLocaleString("ko-KR")] : []),
            i.notes,
          ];
          // Huge free-text cells use separate continuation text pages rather than extending a row beyond A4.
          const compact = content.map((t) =>
            norm(t).length > 200
              ? norm(t).slice(0, 200) + "… (상세 별첨)"
              : norm(t),
          );
          drawRow(compact);
          if (content.some((t) => norm(t).length > 200)) {
            pageY = header(`${s.kind} 상세 내역서 · 항목 상세`);
            doc
              .fontSize(10)
              .text(content.join("\n"), 36, pageY, { width: 523 });
            // Defer the next table page until another row actually exists.
            pageY = 780;
          }
        }
      }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font("Korean")
        .fontSize(8)
        .fillColor("#657579")
        .text(`${i + 1} / ${pages.count}`, 36, 793, {
          width: 523,
          align: "center",
          lineBreak: false,
        });
    }
    doc.end();
    const buffer = await result;
    return {
      buffer,
      filename: quoteDocumentFilename(q.siteName, q.quoteDate, "pdf"),
    };
  }
}
