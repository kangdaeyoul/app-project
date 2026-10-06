import { CompanyContext } from './company-context';
import { Inject, Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import { CustomerQuote, quoteLineAmount } from "@jongno/shared";
import { QuotesService } from "./quotes.service";
@Injectable()
export class QuotePdfService {
  constructor(@Inject(QuotesService) private readonly quotes: QuotesService, @Inject(CompanyContext) private readonly company: CompanyContext) {}
  // PDF renderer's only input is the explicit customer projection, never admin data.
  async render(id: string, mode: string) {
    return this.document(this.quotes.customer(id, mode));
  }
  private async document(q: CustomerQuote) {
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: "견적서", Author: this.company.settings().name },
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
        .text(this.company.settings().name, 36, 61, { width: 523, align: "right" });
      doc
        .fontSize(10)
        .text(`거래처: ${norm(q.customerName)}`, 36, 84, { width: 523 });
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
    let y = header("갑지 · 총괄");
    doc.fontSize(10);
    const cover: [string, number][] = [
      ["재료비", q.totals.material],
      ["노무비", q.totals.labor],
      ["경비", q.totals.expense],
      ["일반관리비", q.totals.generalFee],
      ["착·준공지원비", q.totals.supportFee],
      ["고객가격 조정", q.totals.adjustment],
      ["공급가액", q.totals.supplyAmount],
      ["VAT", q.totals.vat],
      ["총액 (VAT 포함)", q.totals.totalAmount],
    ];
    for (const [label, n] of cover) {
      doc.strokeColor("#cad7d8").lineWidth(0.5).rect(36, y, 523, 30).stroke();
      doc.fillColor("#20373b").text(label, 48, y + 9, { width: 200 });
      doc.text(hidden ? "금액 비공개" : price(n), 248, y + 9, {
        width: 298,
        align: "right",
      });
      y += 30;
    }
    y += 18;
    for (const s of q.sections) {
      doc.text(
        `을지 ${s.kind} · ${s.items.length}개 항목${hidden ? "" : ` · ${price(s.items.reduce((n, i) => n + i.amount, 0))}`}`,
        36,
        y,
        { width: 523 },
      );
      y = doc.y + 9;
    }
    doc
      .fontSize(9)
      .text(`공사내용: ${q.workContent || "—"}`, 36, y + 8, { width: 523 });
    doc.text(`비고: ${[q.notes,this.company.settings().output.quoteNotes].filter(Boolean).join(" / ") || "—"}`, 36, doc.y + 10, { width: 523 });
    if (q.printMode !== "총액 위주")
      for (const s of q.sections) {
        if (!s.items.length) continue;
        let pageY = header(`을지 · ${s.kind}`);
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
            pageY = header(`을지 · ${s.kind} (계속)`);
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
            pageY = header(`을지 · ${s.kind} · 항목 상세`);
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
    const name = q.siteName
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 100);
    return { buffer, filename: `${name}_견적서_${q.quoteDate}.pdf` };
  }
}
