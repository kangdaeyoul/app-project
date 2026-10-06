// Generated documents have their own adapter; replacing it with NAS does not
// change original-photo storage. Keys use the future site-folder convention.
export const PHOTO_REPORT_STORAGE = Symbol("PHOTO_REPORT_STORAGE");
export interface PhotoReportStorage {
  put(key: string, buffer: Buffer): void;
  get(key: string): Buffer | undefined;
}
export class TemporaryPhotoReportStorage implements PhotoReportStorage {
  private files = new Map<string, { buffer: Buffer; expires: number }>();
  private prune() {
    for (const [key, file] of this.files)
      if (file.expires <= Date.now()) this.files.delete(key);
  }
  put(key: string, buffer: Buffer) {
    this.prune();
    // Bound process memory; a later persistent adapter can retain reports.
    while (this.files.size >= 20)
      this.files.delete(this.files.keys().next().value!);
    this.files.set(key, {
      buffer: Buffer.from(buffer),
      expires: Date.now() + 30 * 60_000,
    });
  }
  get(key: string) {
    this.prune();
    const file = this.files.get(key);
    return file && Buffer.from(file.buffer);
  }
}
