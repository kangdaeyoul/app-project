import { readFileSync } from "node:fs";
import { join } from "node:path";
export const FILE_STORAGE = Symbol("FILE_STORAGE");
export interface StoredFile {
  buffer: Buffer;
  mimeType: string;
  originalFilename?: string;
}
export interface FileStorage {
  put(key: string, file: StoredFile): void;
  get(key: string): StoredFile | undefined;
  remove(key: string): void;
}
// Temporary process-local adapter. Original uploaded bytes are never recompressed.
export class TemporaryFileStorage implements FileStorage {
  private files = new Map<string, StoredFile>();
  constructor(seed = true) {
    if (!seed) return;
    for (const n of [1, 2, 3])
      this.put(`sample-${n}.png`, {
        buffer: readFileSync(
          join(__dirname, "../fixtures/photos", `sample-${n}.png`),
        ),
        mimeType: "image/png",
      });
  }
  put(key: string, file: StoredFile) {
    this.files.set(key, {
      buffer: Buffer.from(file.buffer),
      mimeType: file.mimeType,
      ...(file.originalFilename
        ? { originalFilename: file.originalFilename }
        : {}),
    });
  }
  get(key: string) {
    const file = this.files.get(key);
    return (
      file && {
        buffer: Buffer.from(file.buffer),
        mimeType: file.mimeType,
        ...(file.originalFilename
          ? { originalFilename: file.originalFilename }
          : {}),
      }
    );
  }
  remove(key: string) {
    this.files.delete(key);
  }
}
