import {
  InspectionReport,
  InspectionReportRecord,
  InspectionItemRecord,
  InspectionPhotoLink,
  DEFAULT_COMPANY,
} from "@jongno/shared";
import { seoulToday } from "./date";
export const INSPECTION_REPORT_REPOSITORY = Symbol(
  "INSPECTION_REPORT_REPOSITORY",
);
export interface InspectionReportRepository {
  list(siteId: string): InspectionReport[];
  find(id: string): InspectionReport | undefined;
  save(
    report: InspectionReportRecord,
    items: InspectionItemRecord[],
    links: InspectionPhotoLink[],
  ): InspectionReport;
}
// Three normalized collections correspond to reports, report_items, report_item_photos.
export class MemoryInspectionReportRepository implements InspectionReportRepository {
  private reports: InspectionReportRecord[] = [];
  private items: InspectionItemRecord[] = [];
  private links: InspectionPhotoLink[] = [];
  constructor(seed = true) {
    if (seed) {
      const companyId = DEFAULT_COMPANY.id,
        id = "IR001",
        itemId = "II001",
        now = new Date().toISOString();
      this.reports = [
        {
          id,
          companyId,
          siteId: "S001",
          workDate: seoulToday(),
          createdDate: seoulToday(),
          originalDocumentName: "소방시설 점검 지적사항 (샘플)",
          layout: 6,
          createdAt: now,
          updatedAt: now,
        },
      ];
      this.items = [
        {
          id: itemId,
          companyId,
          reportId: id,
          position: 0,
          number: "1",
          inspection: "3층 스프링클러 배관 및 감지기 상태 확인 (샘플)",
          result: "배관 보수 및 감지기 상태 확인 완료 (샘플)",
        },
      ];
      this.links = [
        { companyId, itemId, photoId: "P001", stage: "작업 전", position: 0 },
        { companyId, itemId, photoId: "P002", stage: "작업 후", position: 0 },
        { companyId, itemId, photoId: "P003", stage: "작업 후", position: 1 },
      ];
    }
  }
  private view(record: InspectionReportRecord): InspectionReport {
    return {
      ...structuredClone(record),
      items: this.items
        .filter((i) => i.reportId === record.id)
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          id: i.id,
          number: i.number,
          inspection: i.inspection,
          result: i.result,
          beforePhotoIds: this.links
            .filter((p) => p.itemId === i.id && p.stage === "작업 전")
            .sort((a, b) => a.position - b.position)
            .map((p) => p.photoId),
          afterPhotoIds: this.links
            .filter((p) => p.itemId === i.id && p.stage === "작업 후")
            .sort((a, b) => a.position - b.position)
            .map((p) => p.photoId),
        })),
    };
  }
  list(siteId: string) {
    return this.reports
      .filter((r) => r.siteId === siteId)
      .map((r) => this.view(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  find(id: string) {
    const r = this.reports.find((r) => r.id === id);
    return r && this.view(r);
  }
  save(
    report: InspectionReportRecord,
    items: InspectionItemRecord[],
    links: InspectionPhotoLink[],
  ) {
    const oldIds = new Set(
      this.items.filter((i) => i.reportId === report.id).map((i) => i.id),
    );
    this.reports = [
      ...this.reports.filter((r) => r.id !== report.id),
      structuredClone(report),
    ];
    this.items = [
      ...this.items.filter((i) => i.reportId !== report.id),
      ...structuredClone(items),
    ];
    this.links = [
      ...this.links.filter((p) => !oldIds.has(p.itemId)),
      ...structuredClone(links),
    ];
    return this.view(report);
  }
}
