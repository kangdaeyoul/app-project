import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  COMPLETION_REPORT_TYPES,
  CompletionReportInput,
  CompletionReportSource,
  SiteMaterialTotal,
} from "@jongno/shared";
import PDFDocument from "pdfkit";
import { PDFDocument as MergePdf } from "pdf-lib";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CompanyContext } from "./company-context";
import { AuditRecorder } from "./audit-recorder";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import { SITES_REPOSITORY, SitesRepository } from "./sites.repository";
import { WORKERS_REPOSITORY, WorkersRepository } from "./workers.repository";
import { PhotoService } from "./photo.service";
import { PhotoReportService } from "./photo-report.service";
import {
  COMPLETION_REPORT_STORAGE,
  CompletionReportStorage,
} from "./completion-report-storage";
import { validDate } from "./workers.service";
import { seoulToday } from "./date";
@Injectable()
export class CompletionReportService {
  constructor(
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
    @Inject(SITES_REPOSITORY) private readonly sites: SitesRepository,
    @Inject(DAILY_WORK_REPOSITORY) private readonly work: DailyWorkRepository,
    @Inject(WORKERS_REPOSITORY) private readonly workers: WorkersRepository,
    @Inject(PhotoService) private readonly photos: PhotoService,
    @Inject(PhotoReportService)
    private readonly photoReports: PhotoReportService,
    @Inject(COMPLETION_REPORT_STORAGE)
    private readonly storage: CompletionReportStorage,
  ) {}
  source(siteId: string): CompletionReportSource {
    this.company.assertMember();
    const identity = this.company.identity;
    const role = identity.memberships.find(
      (m) =>
        m.companyId === this.company.companyId && m.userId === identity.userId,
    )?.role;
    if (role !== "admin" && !identity.accessibleSiteIds?.includes(siteId))
      throw new ForbiddenException("이 현장 보고서의 접근 권한이 없습니다.");
    const site = this.sites.find(siteId);
    if (!site || site.deletedAt)
      throw new NotFoundException("현장을 찾을 수 없습니다.");
    const works = this.work
      .list()
      .filter((w) => w.siteId === siteId)
      .sort(
        (a, b) =>
          a.workDate.localeCompare(b.workDate) || a.id.localeCompare(b.id),
      );
    const materialMap = new Map<string, SiteMaterialTotal>();
    for (const w of works)
      for (const m of w.materials) {
        const key = JSON.stringify([m.name, m.specification, m.unit]);
        const total = materialMap.get(key) ?? {
          name: m.name,
          specification: m.specification,
          unit: m.unit,
          quantity: 0,
        };
        total.quantity = Number((total.quantity + m.quantity).toFixed(6));
        materialMap.set(key, total);
      }
    const workerMap = new Map(
      this.workers
        .list()
        .filter((w) => !w.deletedAt)
        .map((w) => [w.id, { id: w.id, displayName: w.displayName }]),
    );
    // Historical snapshots remain selectable after a worker is deactivated.
    const historical = (id: string, name: string) => {
      if (id && !workerMap.has(id))
        workerMap.set(id, { id, displayName: name || id });
    };
    historical(site.managerId ?? "", site.manager ?? "");
    for (const w of works) {
      historical(w.managerId, w.managerDisplayName);
      for (const p of w.participants) historical(p.workerId, p.displayName);
    }
    const ids = [
      ...new Set(works.flatMap((w) => w.participants.map((p) => p.workerId))),
    ];
    const summaryText = (value: string) =>
      value.length <= 5000
        ? value
        : value.slice(0, 4999).replace(/[\uD800-\uDBFF]$/, "") + "…";
    return {
      site,
      materials: [...materialMap.values()],
      workers: [...workerMap.values()],
      photos: this.photos.list(siteId),
      defaults: {
        documentType: COMPLETION_REPORT_TYPES[0],
        title:
          site.description && site.description.length <= 300
            ? site.description
            : site.name,
        purpose: "",
        summary: summaryText(works.map((w) => w.content).join("\n")),
        periodStart: works[0]?.workDate || site.startDate,
        periodEnd: works.at(-1)?.workDate || site.endDate || site.startDate,
        createdDate: seoulToday(),
        managerId: site.managerId || works.at(-1)?.managerId || "",
        participantIds: ids,
        days: works.map((w) => ({
          dailyWorkId: w.id,
          date: w.workDate,
          content: w.content,
        })),
        notes: summaryText(
          works
            .filter((w) => w.notes)
            .map((w) => `${w.workDate}: ${w.notes}`)
            .join("\n"),
        ),
        opinion: "",
        followUp: "",
        photoType: "",
        photoSelection: "전체 사진",
        photoIds: [],
        photoLayout: "사진대지",
      },
    };
  }
  private prepare(siteId: string, body: unknown) {
    const source = this.source(siteId);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("보고서 내용을 확인해 주세요.");
    const raw = body as Record<string, unknown>,
      defaults = source.defaults;
    const text = (key: keyof CompletionReportInput, max = 5000) => {
      const v = raw[key] ?? defaults[key];
      if (
        typeof v !== "string" ||
        v.length > max ||
        /[\u0000-\u0008\u000b-\u001f]/.test(v)
      )
        throw new BadRequestException("보고서 문구를 확인해 주세요.");
      return v.trim();
    };
    const o = { ...defaults } as CompletionReportInput;
    for (const key of [
      "title",
      "purpose",
      "summary",
      "notes",
      "opinion",
      "followUp",
    ] as const)
      o[key] = text(key, key === "title" ? 300 : 5000);
    for (const key of ["periodStart", "periodEnd", "createdDate"] as const)
      o[key] = text(key, 10);
    if (
      !o.title ||
      ![o.periodStart, o.periodEnd, o.createdDate].every(validDate) ||
      o.periodEnd < o.periodStart
    )
      throw new BadRequestException("문서명과 작업기간을 확인해 주세요.");
    const choice = <T extends string>(
      key: keyof CompletionReportInput,
      values: readonly T[],
    ) => {
      const v = text(key, 100);
      if (!values.includes(v as T))
        throw new BadRequestException("보고서 출력 옵션을 확인해 주세요.");
      return v as T;
    };
    o.documentType = choice("documentType", COMPLETION_REPORT_TYPES);
    o.photoType = choice("photoType", ["", "작업 전", "작업 후"]);
    o.photoSelection = choice("photoSelection", ["전체 사진", "선택한 사진만"]);
    o.photoLayout = choice("photoLayout", ["사진 목록", "사진대지"]);
    o.managerId = text("managerId", 100);
    const list = (key: "participantIds" | "photoIds", max: number) => {
      const v = raw[key] ?? defaults[key];
      if (
        !Array.isArray(v) ||
        v.length > max ||
        v.some((x) => typeof x !== "string") ||
        new Set(v).size !== v.length
      )
        throw new BadRequestException("선택 목록을 확인해 주세요.");
      return v as string[];
    };
    o.participantIds = list("participantIds", 100);
    o.photoIds = list("photoIds", 60);
    if (
      [o.managerId, ...o.participantIds]
        .filter(Boolean)
        .some((id) => !source.workers.some((w) => w.id === id))
    )
      throw new BadRequestException("작업진행자를 확인해 주세요.");
    const days = raw.days ?? defaults.days;
    if (
      !Array.isArray(days) ||
      days.length !== defaults.days.length ||
      days.some(
        (d) =>
          !d ||
          typeof d !== "object" ||
          typeof d.content !== "string" ||
          d.content.length > 5000 ||
          /[\u0000-\u0008\u000b-\u001f]/.test(d.content) ||
          !defaults.days.some(
            (x) => x.dailyWorkId === d.dailyWorkId && x.date === d.date,
          ),
      ) ||
      new Set(days.map((d) => d.dailyWorkId)).size !== days.length
    )
      throw new BadRequestException("날짜별 작업내역을 확인해 주세요.");
    o.days = days
      .map((d) => ({
        dailyWorkId: d.dailyWorkId,
        date: d.date,
        content: d.content.trim(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const eligible = source.photos.filter(
      (p) => !o.photoType || p.type === o.photoType,
    );
    if (o.photoIds.some((id) => !eligible.some((p) => p.id === id)))
      throw new BadRequestException(
        "다른 현장 또는 사진 구분의 사진을 포함할 수 없습니다.",
      );
    const selected =
      o.photoSelection === "전체 사진"
        ? eligible
        : eligible.filter((p) => o.photoIds.includes(p.id));
    if (
      selected.length > 60 ||
      (o.photoSelection === "선택한 사진만" && !selected.length)
    )
      throw new BadRequestException("출력 사진을 1~60장 선택해 주세요.");
    return { source, o, selected };
  }
  async render(siteId: string, body: unknown, save = false) {
    const { source, o, selected } = this.prepare(siteId, body),
      company = this.company.settings();
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 42, bottom: 62, left: 42, right: 42 },
      bufferPages: true,
      info: { Title: o.documentType, Author: company.name },
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
    doc
      .fontSize(22)
      .fillColor("#183d43")
      .text(o.documentType, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).text(company.name, { align: "right" });
    doc.moveDown();
    const section = (label: string, value: string) => {
      // PDFKit flows long text across pages; preflight headings avoids orphaned captions.
      if (doc.y > 720) doc.addPage();
      doc.font("Korean").fontSize(11).fillColor("#183d43").text(label);
      doc.moveDown(0.3);
      doc
        .fontSize(10)
        .fillColor("#20373b")
        .text(value || "없음", { width: 511, lineGap: 4 });
      doc.moveDown(0.8);
    };
    section(
      "현장 기본정보",
      `현장명: ${source.site.name}\n거래처: ${source.site.client}\n주소: ${source.site.address}\n보고서 작성일: ${o.createdDate}`,
    );
    section("공사명 또는 보수명", o.title);
    section("작업 목적", o.purpose);
    section("작업 기간", `${o.periodStart} ~ ${o.periodEnd}`);
    const workerName = (id: string) =>
      source.workers.find((w) => w.id === id)?.displayName || "미배정";
    section("대표 작업진행자", workerName(o.managerId));
    section("참여 작업자", o.participantIds.map(workerName).join(", "));
    section("작업 내용 요약", o.summary);
    section(
      "날짜별 작업내역",
      o.days.map((d) => `${d.date} · ${d.content || "내용 없음"}`).join("\n\n"),
    );
    section(
      "사용자재 요약",
      source.materials
        .map(
          (m) =>
            `${m.name}${m.specification ? " " + m.specification : ""} ${m.quantity}${m.unit}`,
        )
        .join("\n"),
    );
    section("특이사항", o.notes);
    section("종합 의견", o.opinion);
    section("추가 보완 필요사항", o.followUp);
    section(
      "확인란",
      `고객: __________________ (서명)\n\n작업진행자: __________________ (서명)\n\n${company.name}: __________________ (서명)`,
    );
    if (!selected.length) section("작업 전·후 사진", "연결된 출력 사진 없음");
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(8)
        .fillColor("#657579")
        .text(`완료보고서 본문 ${i + 1} / ${pages.count}`, 42, 795, {
          width: 511,
          align: "center",
          lineBreak: false,
        });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
    const main = await result;
    let buffer = main;
    if (selected.length) {
      const appendix = await this.photoReports.render(
        siteId,
        {
          selection: "선택한 사진만",
          photoIds: selected.map((p) => p.id),
          type: o.photoType,
          layout:
            o.photoLayout === "사진대지" ? "작업 전/후 비교형" : "페이지당 4장",
          title:
            o.photoLayout === "사진대지" ? "공사 사진대지" : "작업 전·후 사진",
          companyName: company.name,
          workContent: o.title,
          periodStart: o.periodStart,
          periodEnd: o.periodEnd,
          createdDate: o.createdDate,
          showWorker: true,
          showNumber: true,
          showTime: false,
        },
        false,
      );
      const merged = await MergePdf.create();
      for (const part of [main, appendix.buffer]) {
        const loaded = await MergePdf.load(part);
        for (const page of await merged.copyPages(
          loaded,
          loaded.getPageIndices(),
        ))
          merged.addPage(page);
      }
      merged.setTitle(o.documentType);
      merged.setAuthor(company.name);
      buffer = Buffer.from(await merged.save());
    }
    const filename = `${source.site.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100)}_${o.documentType.replace(/ /g, "")}_${o.createdDate}.pdf`;
    const storageKey = `companies/${this.company.companyId}/${siteId}/06 완료보고서/${randomUUID()}/${filename}`;
    if (save)
      this.audit.withOperation({ siteIds: [siteId] }, () =>
        this.storage.put(storageKey, buffer),
      );
    return { buffer, filename, storageKey };
  }
}
