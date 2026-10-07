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
  INSPECTION_OUTPUT_MODES,
  INSPECTION_COVER_TITLES,
} from "@jongno/shared";
import PDFDocument from "pdfkit";
import { PhotoReportService } from "./photo-report.service";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CompletionReportService } from "./completion-report.service";
import { CompanyContext } from "./company-context";
import { AuditRecorder } from "./audit-recorder";
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
    @Inject(PhotoReportService)
    private readonly photoReports: PhotoReportService,
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
        outputMode: INSPECTION_OUTPUT_MODES[0],
        coverTitle: INSPECTION_COVER_TITLES[0],
        actionSummary: s.defaults.summary.slice(0, 1000),
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
        location: text(i.location ?? "", 100),
        photoContent: text(i.photoContent ?? "", 300),
        inspection: text(
          i.inspection ?? "",
          5000,
          raw.outputMode !== INSPECTION_OUTPUT_MODES[2],
        ),
        result: text(
          i.result ?? "",
          5000,
          raw.outputMode !== INSPECTION_OUTPUT_MODES[2],
        ),
        beforePhotoIds: ids("beforePhotoIds", "작업 전"),
        afterPhotoIds: ids("afterPhotoIds", "작업 후"),
      };
    });
    if (
      items.some(
        (i) =>
          !i.location &&
          items.filter((other) => other.number === i.number).length > 1,
      ) ||
      new Set(items.map((i) => JSON.stringify([i.number, i.location]))).size !==
        items.length ||
      new Set(items.filter((i) => i.id).map((i) => i.id)).size !==
        items.filter((i) => i.id).length
    )
      throw new BadRequestException(
        "같은 점검번호의 항목은 서로 다른 작업 위치를 입력해 주세요. 항목 ID도 중복될 수 없습니다.",
      );
    if (
      items.reduce(
        (n, i) => n + i.beforePhotoIds.length + i.afterPhotoIds.length,
        0,
      ) > 120
    )
      throw new BadRequestException(
        "보고서 사진은 최대 120장까지 포함할 수 있습니다.",
      );
    const outputMode = raw.outputMode ?? INSPECTION_OUTPUT_MODES[0],
      coverTitle = raw.coverTitle ?? INSPECTION_REPORT_TITLE;
    if (
      !INSPECTION_OUTPUT_MODES.includes(
        outputMode as (typeof INSPECTION_OUTPUT_MODES)[number],
      ) ||
      !INSPECTION_COVER_TITLES.includes(
        coverTitle as (typeof INSPECTION_COVER_TITLES)[number],
      )
    )
      throw new BadRequestException("출력 모드와 표지 제목을 확인해 주세요.");
    if (
      outputMode === INSPECTION_OUTPUT_MODES[2] &&
      !items.some((i) => i.beforePhotoIds.length || i.afterPhotoIds.length)
    )
      throw new BadRequestException("사진대지에 포함할 사진을 선택해 주세요.");
    const actionSummary = text(
      raw.actionSummary ??
        items
          .map(
            (i) =>
              `점검번호 ${i.number}${i.location ? " (" + i.location + ")" : ""}: ${i.result}`,
          )
          .join("\n")
          .slice(0, 1000),
      1000,
    );
    const input: InspectionReportInput = {
      workDate,
      createdDate,
      layout,
      outputMode: outputMode as InspectionReportInput["outputMode"],
      coverTitle: coverTitle as InspectionReportInput["coverTitle"],
      actionSummary,
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
      location: i.location,
      photoContent: i.photoContent,
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
        outputMode: input.outputMode,
        coverTitle: input.coverTitle,
        actionSummary: input.actionSummary,
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
    const title =
      o.outputMode === INSPECTION_OUTPUT_MODES[2]
        ? "점검지적사항 사진대지"
        : o.outputMode === INSPECTION_OUTPUT_MODES[0]
          ? o.coverTitle!
          : INSPECTION_REPORT_TITLE;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 32, bottom: 52, left: 30, right: 30 },
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: title, Author: source.companyName },
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
    if (o.outputMode === INSPECTION_OUTPUT_MODES[0]) {
      doc.addPage();
      doc
        .fontSize(21)
        .fillColor("#183d43")
        .text(title, 40, 105, { width: 515, align: "center" });
      doc.moveTo(65, 195).lineTo(530, 195).strokeColor("#cad7d8").stroke();
      const fields = [
        ["현장명", source.site.name.replace(/\s+/g, " ")],
        ["작업일자", o.workDate],
        ["공사업체", source.companyName.replace(/\s+/g, " ")],
        ...(o.originalDocumentName
          ? [["원본 점검자료명", o.originalDocumentName.replace(/\s+/g, " ")]]
          : []),
        ["작성일", o.createdDate],
        [
          "이행조치 내용",
          o.actionSummary ||
            "아래 점검번호별 지적사항에 대한 보수내용 및 전후 사진을 참조하시기 바랍니다.",
        ],
      ];
      let font = 12;
      const height = () => {
        doc.fontSize(font);
        return fields.reduce(
          (sum, f) =>
            sum + doc.heightOfString(f[1], { width: 465, lineGap: 2 }) + 30,
          0,
        );
      };
      while (font > 9 && height() > 540) font--;
      if (height() > 540)
        throw new BadRequestException(
          "표지 한 페이지에 들어가도록 이행조치 내용과 표지 문구를 요약해 주세요.",
        );
      let y = 225;
      for (const [label, value] of fields) {
        doc
          .fontSize(10)
          .fillColor("#657579")
          .text(label, 65, y, { width: 465 });
        doc
          .fontSize(font)
          .fillColor("#20373b")
          .text(value, 65, doc.y + 5, { width: 465, lineGap: 2 });
        y = doc.y + 14;
      }
    }
    await this.photoReports.appendInspectionSheets(doc, siteId, {
      items: o.items,
      layout: o.layout,
      workDate: o.workDate,
      photosOnly: o.outputMode === INSPECTION_OUTPUT_MODES[2],
    });
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
          width: 535,
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
