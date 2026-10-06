import { TemporaryPhotoReportStorage } from "./photo-report-storage";
export const INSPECTION_REPORT_STORAGE = Symbol("INSPECTION_REPORT_STORAGE");
export interface InspectionReportStorage {
  put(key: string, buffer: Buffer): void;
  get(key: string): Buffer | undefined;
}
export class TemporaryInspectionReportStorage extends TemporaryPhotoReportStorage {
  put(key: string, buffer: Buffer) {
    super.put(key, buffer);
  }
  get(key: string) {
    return super.get(key);
  }
}
