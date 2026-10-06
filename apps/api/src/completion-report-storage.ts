import { TemporaryPhotoReportStorage } from "./photo-report-storage";
export const COMPLETION_REPORT_STORAGE = Symbol("COMPLETION_REPORT_STORAGE");
// Dedicated port: NAS adapters can replace bounded temporary storage independently.
export interface CompletionReportStorage {
  put(key: string, buffer: Buffer): void;
  get(key: string): Buffer | undefined;
}
export class TemporaryCompletionReportStorage extends TemporaryPhotoReportStorage {
  put(key: string, buffer: Buffer) {
    super.put(key, buffer);
  }
  get(key: string) {
    return super.get(key);
  }
}
