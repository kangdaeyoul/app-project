import { seoulToday } from "./date";
import { PhotoRecord } from "@jongno/shared";
export const PHOTO_REPOSITORY = Symbol("PHOTO_REPOSITORY");
export interface PhotoRepository {
  list(): PhotoRecord[];
  find(id: string): PhotoRecord | undefined;
  save(record: PhotoRecord): void;
  remove(id: string): void;
  reorder(ids: string[]): void;
}
export class SamplePhotoRepository implements PhotoRepository {
  private records: PhotoRecord[] = [1, 2, 3].map((n) => ({
    id: "P00" + n,
    dailyWorkId: "D001",
    type: n === 1 ? "작업 전" : "작업 후",
    location: "3층 천장 배관",
    description: n === 1 ? "설치 전 상태 (샘플)" : "설치 후 배관 점검 (샘플)",
    capturedAt: seoulToday() + "T08:30:00+09:00",
    uploadedBy: "샘플 관리자",
    sortOrder: n === 3 ? 1 : 0,
    originalFilename: `sample-${n}.png`,
    storageKey: `sample-${n}.png`,
    mimeType: "image/png",
    size: 0,
    createdAt: new Date().toISOString(),
    isSample: true,
  }));
  constructor(seed = true) { if (!seed) { this.records=[]; } }
  list() {
    return this.records.map((p) => ({ ...p }));
  }
  find(id: string) {
    const p = this.records.find((p) => p.id === id);
    return p && { ...p };
  }
  save(record: PhotoRecord) {
    const i = this.records.findIndex((p) => p.id === record.id);
    if (i < 0) this.records.push({ ...record });
    else this.records[i] = { ...record };
  }
  remove(id: string) {
    this.records = this.records.filter((p) => p.id !== id);
  }
  reorder(ids: string[]) {
    ids.forEach((id, index) => {
      const p = this.records.find((p) => p.id === id);
      if (p) p.sortOrder = index;
    });
  }
}
