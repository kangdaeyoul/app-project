import { appendInspectionTables } from "./photo-report-table";
import { AuditRecorder } from "./audit-recorder";
import { CompanyContext } from "./company-context";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PHOTO_REPORT_LAYOUTS,
  PhotoReportOptions,
  PhotoView,
  InspectionItemInput,
} from "@jongno/shared";
import { PhotoService } from "./photo.service";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import {
  PHOTO_REPORT_STORAGE,
  PhotoReportStorage,
} from "./photo-report-storage";
import { validDate } from "./workers.service";
import { seoulToday } from "./date";

export function reportRows(
  photos: PhotoView[],
  comparison: boolean,
): (PhotoView | null)[][] {
  if (!comparison)
    return Array.from({ length: Math.ceil(photos.length / 2) }, (_, i) =>
      photos.slice(i * 2, i * 2 + 2),
    );
  const groups = new Map<string, PhotoView[]>();
  for (const photo of photos) {
    // Blank positions cannot reliably identify a pair.
    const key = JSON.stringify([
      photo.workDate,
      photo.location.trim() || photo.id,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }
  const rows: (PhotoView | null)[][] = [];
  for (const group of groups.values()) {
    const before = group.filter((p) => p.type === "작업 전");
    const after = group.filter((p) => p.type === "작업 후");
    for (let i = 0; i < Math.max(before.length, after.length); i++)
      rows.push([before[i] ?? null, after[i] ?? null]);
  }
  return rows;
}
@Injectable()
export class PhotoReportService {
  constructor(
    @Inject(PhotoService) private readonly photos: PhotoService,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(DAILY_WORK_REPOSITORY) private readonly work: DailyWorkRepository,
    @Inject(PHOTO_REPORT_STORAGE) private readonly storage: PhotoReportStorage,
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
  ) {}
  private prepare(siteId: string, body: unknown) {
    const site = this.sites.find(siteId);
    if (!site) throw new NotFoundException("현장을 찾을 수 없습니다.");
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("출력 옵션이 필요합니다.");
    const raw = body as Record<string, unknown>;
    const text = (key: string, fallback: string, max = 300) => {
      const value = raw[key] ?? fallback;
      if (
        typeof value !== "string" ||
        value.length > max ||
        /[\u0000-\u0008\u000b-\u001f]/.test(value)
      )
        throw new BadRequestException("출력 문구를 확인해 주세요.");
      return value.trim();
    };
    const layout = text("layout", PHOTO_REPORT_LAYOUTS[0]);
    const selection = text("selection", "전체 사진");
    const type = text("type", "");
    const workDate = text("workDate", "");
    if (
      !PHOTO_REPORT_LAYOUTS.includes(layout as PhotoReportOptions["layout"]) ||
      !["전체 사진", "선택한 사진만"].includes(selection) ||
      !["", "작업 전", "작업 후"].includes(type) ||
      (workDate && !validDate(workDate))
    )
      throw new BadRequestException("사진 범위와 출력형식을 확인해 주세요.");
    const ids = raw.photoIds ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > 60 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException("사진 선택 목록을 확인해 주세요.");
    let photos = this.photos.list(
      siteId,
      undefined,
      type || undefined,
      workDate || undefined,
    );
    if (selection === "선택한 사진만") {
      if (ids.some((id) => !photos.some((p) => p.id === id)))
        throw new BadRequestException(
          "선택한 사진이 현장 또는 출력 조건과 일치하지 않습니다.",
        );
      photos = photos.filter((p) => ids.includes(p.id));
    }
    if (!photos.length || photos.length > 60)
      throw new BadRequestException("출력할 사진을 1~60장 선택해 주세요.");
    const createdDate = text("createdDate", seoulToday());
    const periodStart = text("periodStart", photos[0].workDate);
    const periodEnd = text("periodEnd", photos[photos.length - 1].workDate);
    if (
      ![createdDate, periodStart, periodEnd].every(validDate) ||
      periodEnd < periodStart
    )
      throw new BadRequestException("작성일과 작업기간을 확인해 주세요.");
    const bool = (key: string, fallback: boolean) => {
      const v = raw[key] ?? fallback;
      if (typeof v !== "boolean")
        throw new BadRequestException("출력 옵션을 확인해 주세요.");
      return v;
    };
    const options: PhotoReportOptions = {
      layout: layout as PhotoReportOptions["layout"],
      selection: selection as PhotoReportOptions["selection"],
      type: type as PhotoReportOptions["type"],
      photoIds: ids,
      workDate,
      createdDate,
      periodStart,
      periodEnd,
      title: text(
        "title",
        this.company.settings().output.photoReportTitle,
        100,
      ),
      companyName: text("companyName", this.company.settings().name, 100),
      workContent: text("workContent", site.description, 5000),
      showWorker: bool("showWorker", false),
      showNumber: bool("showNumber", true),
      showTime: bool("showTime", false),
    };
    if (!options.title || !options.companyName)
      throw new BadRequestException("문서 제목과 회사명을 입력해 주세요.");
    return { site, photos, options };
  }
  async prepareImages(photos: PhotoView[]) {
    const images = new Map<string, Buffer>();
    for (const p of photos) {
      const file = this.photos.file(p.id);
      try {
        const image = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .flatten({ background: "#ffffff" })
          .resize({
            width: 1400,
            height: 1400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        images.set(p.id, image);
      } catch {
        throw new BadRequestException(
          `사진을 읽을 수 없습니다: ${p.originalFilename}`,
        );
      }
    }
    return images;
  }
  async appendInspectionSheets(
    doc: PDFKit.PDFDocument,
    siteId: string,
    options: {
      items: InspectionItemInput[];
      layout: 6 | 8;
      workDate: string;
      photosOnly: boolean;
    },
  ) {
    const site = this.sites.find(siteId);
    if (!site) throw new NotFoundException("현장을 찾을 수 없습니다.");
    const photos = this.photos.list(siteId),
      ids = [
        ...new Set(
          options.items.flatMap((i) => [
            ...i.beforePhotoIds,
            ...i.afterPhotoIds,
          ]),
        ),
      ];
    if (ids.some((id) => !photos.some((p) => p.id === id)))
      throw new BadRequestException("현장 사진을 확인해 주세요.");
    const images = await this.prepareImages(
      photos.filter((p) => ids.includes(p.id)),
    );
    appendInspectionTables(doc, {
      ...options,
      photos,
      images,
      siteName: site.name,
    });
  }
  async render(siteId: string, body: unknown, save = false) {
    const { site, photos, options: o } = this.prepare(siteId, body);
    // Decode every image before rendering, rejecting corrupt/missing originals.
    const images = await this.prepareImages(photos);
    const doc = new PDFDocument({
      size: "A4",
      margin: 32,
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: o.title, Author: o.companyName },
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
    const header = () => {
      doc.addPage();
      doc.font("Korean").fillColor("#183d43");
      doc.fontSize(18).text(o.title.replace(/\s+/g, " "), 32, 30, {
        width: 531,
        align: "center",
      });
      doc.fontSize(9).text(o.companyName.replace(/\s+/g, " "), 32, doc.y + 7, {
        width: 531,
        align: "right",
      });
      doc
        .fontSize(10)
        .text(`현장: ${site.name.replace(/\s+/g, " ")}`, 32, doc.y + 9, {
          width: 531,
        });
      doc.text(
        `공사명 / 작업내용: ${o.workContent.replace(/\s+/g, " ").slice(0, 300)}${o.workContent.length > 300 ? "… (공사내용 별첨)" : ""}`,
        32,
        doc.y + 5,
        {
          width: 531,
        },
      );
      doc.text(
        `작업기간: ${o.periodStart} ~ ${o.periodEnd}     작성일: ${o.createdDate}`,
        32,
        doc.y + 5,
        { width: 531 },
      );
      return doc.y + 16;
    };
    const rows = reportRows(photos, o.layout === PHOTO_REPORT_LAYOUTS[0]);
    const perPage = o.layout === "페이지당 6장" ? 3 : 2;
    const ordered = rows.flat().filter((p): p is PhotoView => p !== null);
    const numbers = new Map(ordered.map((p, i) => [p.id, i + 1]));
    for (let start = 0; start < rows.length; start += perPage) {
      const top = header();
      const cellHeight = (775 - top) / perPage;
      for (let row = 0; row < perPage && start + row < rows.length; row++) {
        rows[start + row].forEach((p, col) => {
          const x = 32 + col * 272,
            y = top + row * cellHeight;
          doc
            .lineWidth(0.5)
            .strokeColor("#cad7d8")
            .rect(x, y, 259, cellHeight - 10)
            .stroke();
          if (!p) {
            doc
              .fontSize(10)
              .fillColor("#657579")
              .text("대응 사진 없음", x + 10, y + 20, {
                width: 239,
                align: "center",
              });
            return;
          }
          const imageHeight = cellHeight - (o.showWorker ? 113 : 99);
          doc.image(images.get(p.id)!, x + 7, y + 7, {
            fit: [245, imageHeight],
            align: "center",
            valign: "center",
          });
          const captured = p.capturedAt
            ? new Intl.DateTimeFormat("sv-SE", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                ...(o.showTime
                  ? ({ hour: "2-digit", minute: "2-digit" } as const)
                  : {}),
              }).format(new Date(p.capturedAt))
            : "미입력";
          const location = p.location.replace(/\s+/g, " ");
          const description = p.description.replace(/\s+/g, " ");
          const caption = `${o.showNumber ? `사진 ${numbers.get(p.id)} · ` : ""}${p.type}\n작업위치: ${location.length > 40 ? location.slice(0, 40) + "… (별첨)" : location || "미입력"}\n${description.length > 100 ? description.slice(0, 100) + "… (설명 별첨)" : description || "설명 미입력"}\n촬영일${o.showTime ? "시" : "자"}: ${captured}${o.showWorker ? `\n작업진행자: ${this.work.find(p.dailyWorkId)?.managerDisplayName || "미배정"}` : ""}`;
          doc
            .fontSize(8)
            .fillColor("#20373b")
            .text(caption, x + 8, y + imageHeight + 13, {
              width: 243,
              height: cellHeight - imageHeight - 25,
              ellipsis: true,
            });
        });
      }
    }
    // Preserve long descriptions/locations as a readable appendix rather than silently losing them.
    for (const p of ordered.filter(
      (p) =>
        p.description.length > 100 ||
        p.location.length > 40 ||
        /[\r\n]/.test(p.description + p.location),
    )) {
      header();
      doc
        .fontSize(11)
        .text(
          `${o.showNumber ? `사진 ${numbers.get(p.id)}` : p.originalFilename} · ${p.type} · 상세 설명`,
          32,
          doc.y + 12,
          { width: 531 },
        );
      doc
        .fontSize(10)
        .text(
          `작업위치: ${p.location || "미입력"}\n${p.description}`,
          32,
          doc.y + 12,
          { width: 531 },
        );
    }
    if (o.workContent.length > 300) {
      header();
      doc
        .fontSize(11)
        .text("공사명 / 작업내용 · 전체 내용", 32, doc.y + 12, { width: 531 });
      doc.fontSize(10).text(o.workContent, 32, doc.y + 12, { width: 531 });
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font("Korean")
        .fontSize(8)
        .fillColor("#657579")
        .text(`${i + 1} / ${pages.count}`, 32, 794, {
          width: 531,
          align: "center",
          lineBreak: false,
        });
    }
    doc.end();
    const buffer = await result;
    const safeName = site.name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .slice(0, 100);
    const filename = `${safeName}_공사사진대지_${o.createdDate}.pdf`;
    const id = randomUUID();
    const storageKey = `companies/${this.company.companyId}/${siteId}/05 현장사진/사진대지/${id}/${filename}`;
    if (save)
      this.audit.withOperation({ siteIds: [siteId] }, () =>
        this.storage.put(storageKey, buffer),
      );
    return { buffer, filename, storageKey };
  }
}
