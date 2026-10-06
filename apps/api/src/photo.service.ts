import { AuditRecorder } from './audit-recorder';
import { CompanyContext } from './company-context';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PHOTO_TYPES,
  PhotoMetadata,
  PhotoRecord,
  PhotoType,
  PhotoView,
} from "@jongno/shared";
import { PHOTO_REPOSITORY, PhotoRepository } from "./photo.repository";
import { FILE_STORAGE, FileStorage } from "./file-storage";
import {
  DAILY_WORK_REPOSITORY,
  DailyWorkRepository,
} from "./daily-work.repository";
import { validDate } from "./workers.service";
export interface UploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
@Injectable()
export class PhotoService {
  constructor(
    @Inject(PHOTO_REPOSITORY) private readonly photos: PhotoRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DAILY_WORK_REPOSITORY) private readonly work: DailyWorkRepository,
    @Inject(CompanyContext) private readonly company: CompanyContext,
    @Inject(AuditRecorder) private readonly audit: AuditRecorder,
  ) {}
  private record(id: string) {
    const p = this.photos.find(id);
    if (!p) throw new NotFoundException("사진을 찾을 수 없습니다.");
    return p;
  }
  private view(p: PhotoRecord): PhotoView {
    const work = this.work.find(p.dailyWorkId);
    if (!work) throw new NotFoundException("일일작업을 찾을 수 없습니다.");
    return {
      ...p,
      size: this.storage.get(p.storageKey)?.buffer.length ?? p.size,
      siteId: work.siteId,
      workDate: work.workDate,
      url: `/api/photos/${p.id}/file`,
    };
  }
  list(
    siteId?: string,
    dailyWorkId?: string,
    type?: string,
    workDate?: string,
  ) {
    if (type !== undefined && !PHOTO_TYPES.includes(type as PhotoType))
      throw new BadRequestException("사진 구분을 확인해 주세요.");
    if (workDate !== undefined && !validDate(workDate))
      throw new BadRequestException("작업일자를 확인해 주세요.");
    return this.photos
      .list()
      .map((p) => this.view(p))
      .filter(
        (p) =>
          (siteId === undefined || p.siteId === siteId) &&
          (dailyWorkId === undefined || p.dailyWorkId === dailyWorkId) &&
          (type === undefined || p.type === type) &&
          (workDate === undefined || p.workDate === workDate),
      )
      .sort(
        (a, b) =>
          a.workDate.localeCompare(b.workDate) ||
          a.type.localeCompare(b.type) ||
          a.sortOrder - b.sortOrder ||
          a.id.localeCompare(b.id),
      );
  }
  private metadata(body: unknown): PhotoMetadata {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("사진 메타데이터가 필요합니다.");
    const raw = body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const key of ["location", "description", "uploadedBy"]) {
      const value = raw[key] ?? "";
      if (
        typeof value !== "string" ||
        value.length > (key === "description" ? 5000 : 300)
      )
        throw new BadRequestException("사진 설명과 등록자를 확인해 주세요.");
      fields[key] = value.trim();
    }
    if (!fields.uploadedBy)
      throw new BadRequestException("등록자는 필수입니다.");
    const date = raw.capturedAt;
    let capturedAt: string | null = null;
    if (date !== undefined && date !== null && date !== "") {
      if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
          date,
        ) ||
        !validDate(date.slice(0, 10)) ||
        !Number.isFinite(Date.parse(date))
      )
        throw new BadRequestException(
          "촬영일시는 시간대가 포함된 날짜여야 합니다.",
        );
      capturedAt = new Date(date).toISOString();
    }
    return { ...fields, capturedAt } as PhotoMetadata;
  }
  private originalFilename(name: string) {
    // Multipart headers arrive as latin1 in Multer; recover UTF-8 browser names.
    if ([...name].every((char) => char.charCodeAt(0) <= 255)) {
      const decoded = Buffer.from(name, "latin1").toString("utf8");
      if (!decoded.includes("\ufffd")) name = decoded;
    }
    return name.replace(/.*[\/\\]/, "").slice(0, 300);
  }
  private validateFile(file: UploadFile) {
    const b = file.buffer;
    const png =
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp =
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP";
    const mime = png
      ? "image/png"
      : jpeg
        ? "image/jpeg"
        : webp
          ? "image/webp"
          : null;
    if (!mime || file.mimetype !== mime || b.length > 10 * 1024 * 1024)
      throw new BadRequestException(
        "PNG/JPEG/WebP 사진만 장당 10MB까지 등록할 수 있습니다.",
      );
    return mime;
  }
  create(
    dailyWorkId: string,
    type: string,
    body: unknown,
    files: UploadFile[],
  ) {
    if (!this.work.find(dailyWorkId))
      throw new NotFoundException("일일작업을 찾을 수 없습니다.");
    if (
      !PHOTO_TYPES.includes(type as PhotoType) ||
      !Array.isArray(files) ||
      !files.length ||
      files.length > 20
    )
      throw new BadRequestException("사진 구분과 파일을 확인해 주세요.");
    const meta = this.metadata(body);
    const validated = files.map((file) => ({
      file,
      mime: this.validateFile(file),
    }));
    const existing = this.photos
      .list()
      .filter((p) => p.dailyWorkId === dailyWorkId && p.type === type);
    let order = Math.max(-1, ...existing.map((p) => p.sortOrder)) + 1;
    return validated.map(({ file, mime }) => {
      const id = randomUUID();
      const key = `companies/${this.company.companyId}/photos/${id}`;
      this.audit.withOperation({siteIds:[this.work.find(dailyWorkId)!.siteId]},()=>this.storage.put(key, { buffer: file.buffer, mimeType: mime,originalFilename:this.originalFilename(file.originalname) }));
      const p: PhotoRecord = {
        ...meta,
        id,
        dailyWorkId,
        type: type as PhotoType,
        sortOrder: order++,
        originalFilename: this.originalFilename(file.originalname),
        storageKey: key,
        mimeType: mime,
        size: file.buffer.length,
        createdAt: new Date().toISOString(),
        isSample: false,
      };
      this.photos.save(p);
      return this.view(p);
    });
  }
  update(id: string, body: unknown) {
    const p = this.record(id);
    this.photos.save({ ...p, ...this.metadata(body) });
    return this.view(this.record(id));
  }
  remove(id: string) {
    const p = this.record(id);
    this.photos.remove(id);
    this.audit.withOperation({siteIds:[this.work.find(p.dailyWorkId)!.siteId]},()=>this.storage.remove(p.storageKey));
    this.photos.reorder(
      this.photos
        .list()
        .filter(
          (other) =>
            other.dailyWorkId === p.dailyWorkId && other.type === p.type,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((other) => other.id),
    );
    return { deleted: true };
  }
  reorder(dailyWorkId: string, type: string, ids: unknown) {
    if (!this.work.find(dailyWorkId))
      throw new NotFoundException("일일작업을 찾을 수 없습니다.");
    if (
      !PHOTO_TYPES.includes(type as PhotoType) ||
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== "string")
    )
      throw new BadRequestException("정렬 목록을 확인해 주세요.");
    const group = this.photos
      .list()
      .filter((p) => p.dailyWorkId === dailyWorkId && p.type === type);
    if (
      ids.length !== group.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !group.some((p) => p.id === id))
    )
      throw new BadRequestException(
        "해당 작업과 사진 구분의 전체 ID를 중복 없이 보내주세요.",
      );
    this.photos.reorder(ids);
    return this.list(undefined, dailyWorkId, type);
  }
  file(id: string) {
    const p = this.record(id);
    const file = this.storage.get(p.storageKey);
    if (!file) throw new NotFoundException("사진 파일을 찾을 수 없습니다.");
    return file;
  }
}
