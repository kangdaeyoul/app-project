import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  InspectionReportInput,
  InspectionReportSource,
  InspectionItemInput,
  InspectionItemRecord,
  InspectionPhotoLink,
  INSPECTION_REPORT_TITLE,
} from "@jongno/shared";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CompletionReportService } from "./completion-report.service";
import { CompanyContext } from "./company-context";
import { AuditRecorder } from "./audit-recorder";
import { PhotoService } from "./photo.service";
import {
  INSPECTION_REPORT_REPOSITORY,
  InspectionReportRepository,
} from "./inspection-report.repository";
import {
  INSPECTION_REPORT_STORAGE,
  InspectionReportStorage,
} from "./inspection-report-storage";
import { validDate } from "./workers.service";
import { seoulToday } from "./date";
@Injectable()
export class InspectionReportService {
  constructor(
    @Inject(CompletionReportService)
    private readonly completion: CompletionReportService,
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
    @Inject(PhotoService) private readonly photos: PhotoService,
    @Inject(INSPECTION_REPORT_REPOSITORY)
    private readonly repo: InspectionReportRepository,
    @Inject(INSPECTION_REPORT_STORAGE)
    private readonly storage: InspectionReportStorage,
  ) {}
  source(siteId: string): InspectionReportSource {
    const s = this.completion.source(siteId);
    return {
      site: s.site,
      companyName: this.company.settings().name,
      photos: s.photos,
      reports: this.repo.list(siteId),
      defaults: {
        workDate: s.defaults.periodEnd,
        createdDate: seoulToday(),
        originalDocumentName: "",
        layout: 6,
        items: [],
      },
    };
  }
  private prepare(siteId: string, body: unknown) {
    const source = this.source(siteId);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("보고서 내용을 확인해 주세요.");
    const raw = body as Record<string, unknown>;
    const text = (v: unknown, max: number, required = false) => {
      if (
        typeof v !== "string" ||
        v.length > max ||
        /[\u0000-\u0008\u000b-\u001f]/.test(v) ||
        (required && !v.trim())
      )
        throw new BadRequestException("보고서 문구를 확인해 주세요.");
      return v.trim();
    };
    const workDate = text(raw.workDate ?? source.defaults.workDate, 10),
      createdDate = text(raw.createdDate ?? source.defaults.createdDate, 10);
    if (!validDate(workDate) || !validDate(createdDate))
      throw new BadRequestException("작업일자와 작성일을 확인해 주세요.");
    const layout = raw.layout ?? 6;
    if (layout !== 6 && layout !== 8)
      throw new BadRequestException("6장형 또는 8장형을 선택해 주세요.");
    if (
      !Array.isArray(raw.items) ||
      !raw.items.length ||
      raw.items.length > 100
    )
      throw new BadRequestException("지적사항을 1~100건 입력해 주세요.");
    const items: InspectionItemInput[] = raw.items.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new BadRequestException("지적사항을 확인해 주세요.");
      const i = value as Record<string, unknown>;
      const ids = (key: string, stage: string) => {
        const ids = i[key] ?? [];
        if (
          !Array.isArray(ids) ||
          ids.length > 30 ||
          new Set(ids).size !== ids.length ||
          ids.some(
            (id) =>
              typeof id !== "string" ||
              !source.photos.some((p) => p.id === id && p.type === stage),
          )
        )
          throw new BadRequestException(
            "사진의 현장과 전·후 구분을 확인해 주세요.",
          );
        return ids as string[];
      };
      const id = i.id === undefined ? undefined : text(i.id, 100, true);
      return {
        id,
        number: text(i.number, 30, true),
        inspection: text(i.inspection, 5000, true),
        result: text(i.result, 5000, true),
        beforePhotoIds: ids("beforePhotoIds", "작업 전"),
        afterPhotoIds: ids("afterPhotoIds", "작업 후"),
      };
    });
    if (
      new Set(items.map((i) => i.number)).size !== items.length ||
      new Set(items.filter((i) => i.id).map((i) => i.id)).size !==
        items.filter((i) => i.id).length
    )
      throw new BadRequestException("지적번호 또는 항목 ID가 중복되었습니다.");
    if (
      items.reduce(
        (n, i) => n + i.beforePhotoIds.length + i.afterPhotoIds.length,
        0,
      ) > 120
    )
      throw new BadRequestException(
        "보고서 사진은 최대 120장까지 포함할 수 있습니다.",
      );
    const input: InspectionReportInput = {
      workDate,
      createdDate,
      layout,
      originalDocumentName: text(raw.originalDocumentName ?? "", 300),
      items,
    };
    return { source, input };
  }
  save(siteId: string, body: unknown, id?: string) {
    const { input } = this.prepare(siteId, body),
      before = id ? this.repo.find(id) : undefined;
    if (id && (!before || before.siteId !== siteId))
      throw new NotFoundException("보고서를 찾을 수 없습니다.");
    if (
      input.items.some(
        (i) => i.id && !before?.items.some((old) => old.id === i.id),
      )
    )
      throw new BadRequestException(
        "다른 보고서의 항목 ID를 사용할 수 없습니다.",
      );
    const reportId = id ?? randomUUID(),
      companyId = this.company.companyId,
      now = new Date().toISOString();
    const items: InspectionItemRecord[] = input.items.map((i, position) => ({
      id: i.id ?? randomUUID(),
      companyId,
      reportId,
      position,
      number: i.number,
      inspection: i.inspection,
      result: i.result,
    }));
    const links: InspectionPhotoLink[] = input.items.flatMap((i, index) =>
      (["작업 전", "작업 후"] as const).flatMap((stage) =>
        (stage === "작업 전" ? i.beforePhotoIds : i.afterPhotoIds).map(
          (photoId, position) => ({
            companyId,
            itemId: items[index].id,
            photoId,
            stage,
            position,
          }),
        ),
      ),
    );
    const after = this.repo.save(
      {
        id: reportId,
        companyId,
        siteId,
        workDate: input.workDate,
        createdDate: input.createdDate,
        layout: input.layout,
        originalDocumentName: input.originalDocumentName,
        createdAt: before?.createdAt ?? now,
        updatedAt: now,
      },
      items,
      links,
    );
    this.audit.record({
      targetType: "점검지적사항 보고서",
      targetId: reportId,
      action: before ? "수정" : "생성",
      before: before ?? null,
      after,
      siteIds: [siteId],
    });
    return after;
  }
  async render(siteId: string, body: unknown, save = false) {
    const { source, input: o } = this.prepare(siteId, body);
    const selectedIds = [
        ...new Set(
          o.items.flatMap((i) => [...i.beforePhotoIds, ...i.afterPhotoIds]),
        ),
      ],
      images = new Map<string, Buffer>();
    for (const id of selectedIds) {
      try {
        images.set(
          id,
          await sharp(this.photos.file(id).buffer, {
            limitInputPixels: 40_000_000,
          })
            .rotate()
            .flatten({ background: "#fff" })
            .resize({
              width: 1400,
              height: 1400,
              fit: "inside",
              withoutEnlargement: true,
            })
            .png()
            .toBuffer(),
        );
      } catch {
        throw new BadRequestException(
          "원본 사진을 읽을 수 없습니다. 사진을 확인해 주세요.",
        );
      }
    }
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 32, bottom: 52, left: 30, right: 30 },
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: INSPECTION_REPORT_TITLE, Author: source.companyName },
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
    doc.font("Korean");
    doc.addPage();
    doc
      .fontSize(23)
      .fillColor("#183d43")
      .text(INSPECTION_REPORT_TITLE, 40, 155, { width: 515, align: "center" });
    doc.moveTo(65, 220).lineTo(530, 220).strokeColor("#cad7d8").stroke();
    let coverY = 300;
    const coverFields = [
      ["현장명", source.site.name],
      ["작업일자 / 보수완료일", o.workDate],
      ["공사를 진행한 회사", source.companyName],
      ...(o.originalDocumentName
        ? [["원본 점검자료명", o.originalDocumentName]]
        : []),
      ["보고서 작성일", o.createdDate],
    ];
    let coverFont = 14;
    while (coverFont > 9) {
      doc.fontSize(coverFont);
      const height = coverFields.reduce(
        (sum, field) =>
          sum + doc.heightOfString(field[1], { width: 465, lineGap: 2 }) + 44,
        0,
      );
      if (height <= 455) break;
      coverFont--;
    }
    for (const [label, value] of coverFields) {
      doc
        .fontSize(11)
        .fillColor("#657579")
        .text(label, 65, coverY, { width: 465 });
      coverY = doc.y + 7;
      doc
        .fontSize(coverFont)
        .fillColor("#20373b")
        .text(value, 65, coverY, { width: 465, lineGap: 2 });
      coverY = doc.y + 24;
    }
    const top = 68,
      bottom = 787,
      width = 535,
      rows = o.layout / 2,
      slot = (bottom - top) / rows;
    let y = top;
    const bodyPage = () => {
      doc.addPage();
      doc
        .font("Korean")
        .fontSize(12)
        .fillColor("#183d43")
        .text(INSPECTION_REPORT_TITLE, 30, 25, { width });
      doc
        .fontSize(8)
        .fillColor("#657579")
        .text(`${source.site.name.slice(0, 65)} · ${o.workDate}`, 30, 46, {
          width,
        });
      y = top;
    };
    bodyPage();
    for (const item of o.items) {
      doc.fontSize(9);
      const inspection = `점검지적사항: ${item.inspection}`,
        repair = `보수결과: ${item.result}`;
      const h1 = doc.heightOfString(inspection, { width: 519, lineGap: 2 }),
        h2 = doc.heightOfString(repair, { width: 519, lineGap: 2 });
      const metaH = 22 + h1 + h2 + 6;
      const long = metaH > slot - 105;
      if (long) {
        if (y !== top) bodyPage();
        doc
          .fontSize(11)
          .fillColor("#183d43")
          .text(`지적번호 ${item.number}`, 30, y, { width });
        doc.moveDown(0.5);
        doc
          .fontSize(10)
          .fillColor("#20373b")
          .text(inspection, { width, lineGap: 3 });
        doc.moveDown(0.8);
        doc.text(repair, { width, lineGap: 3 });
        bodyPage();
      }
      const pairs = Math.max(
        1,
        item.beforePhotoIds.length,
        item.afterPhotoIds.length,
      );
      for (let n = 0; n < pairs; n++) {
        if (y + slot > bottom + 0.1) bodyPage();
        const headerH = long ? 26 : metaH,
          cellY = y + headerH,
          cellH = slot - headerH - 5;
        doc
          .lineWidth(0.5)
          .strokeColor("#aebec1")
          .rect(30, y, width, slot - 5)
          .stroke();
        doc.moveTo(30, cellY).lineTo(565, cellY).stroke();
        doc
          .moveTo(297.5, cellY)
          .lineTo(297.5, y + slot - 5)
          .stroke();
        doc
          .fontSize(9)
          .fillColor("#183d43")
          .text(
            `지적번호 ${item.number}${n || long ? " · 계속" : ""}`,
            38,
            y + 7,
            { width: 519 },
          );
        if (!long) {
          doc
            .fontSize(9)
            .fillColor("#20373b")
            .text(inspection, 38, y + 22, { width: 519, lineGap: 2 });
          doc.text(repair, 38, doc.y + 3, { width: 519, lineGap: 2 });
        }
        for (const [col, id, stage] of [
          [0, item.beforePhotoIds[n], "작업 전"],
          [1, item.afterPhotoIds[n], "작업 후"],
        ] as const) {
          const x = 30 + col * 267.5,
            photo = source.photos.find((p) => p.id === id),
            imageHeight = cellH - 50;
          if (photo) {
            doc.image(images.get(id)!, x + 8, cellY + 6, {
              fit: [251.5, imageHeight],
              align: "center",
              valign: "center",
            });
            const short = (v: string, max: number) =>
              v.replace(/\s+/g, " ").slice(0, max);
            doc
              .fontSize(8)
              .fillColor("#20373b")
              .text(
                `${item.number}번 항목 ${stage === "작업 전" ? "보수 전" : "보수 후"}\n위치: ${short(photo.location, 45) || "미입력"}\n${short(photo.description, 75) || "설명 미입력"}`,
                x + 8,
                cellY + imageHeight + 11,
                { width: 251.5, height: 38, ellipsis: true },
              );
          } else
            doc
              .fontSize(9)
              .fillColor("#657579")
              .text(`${stage} 사진 없음`, x + 8, cellY + 25, {
                width: 251.5,
                align: "center",
              });
        }
        y += slot;
      }
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      const b = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Korean")
        .fontSize(8)
        .fillColor("#657579")
        .text(`${i + 1} / ${pages.count}`, 30, 807, {
          width,
          align: "center",
          lineBreak: false,
        });
      doc.page.margins.bottom = b;
    }
    doc.end();
    const buffer = await result;
    const filename = `${source.site.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100)}_점검지적사항보수결과_${o.createdDate}.pdf`,
      storageKey = `companies/${this.company.companyId}/${siteId}/06 완료보고서/점검지적사항/${randomUUID()}/${filename}`;
    if (save)
      this.audit.withOperation({ siteIds: [siteId] }, () =>
        this.storage.put(storageKey, buffer),
      );
    return { buffer, filename, storageKey };
  }
}
