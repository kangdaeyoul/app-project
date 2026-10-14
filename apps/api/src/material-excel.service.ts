import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import {
  WorkPrice,
  MaterialImportJob,
  MaterialImportRow,
  MATERIAL_EXCEL_COLUMNS,
} from "@jongro/shared";
import { CompanyContext } from "./company-context";
import {
  STANDARD_WORK_REPOSITORY,
  StandardWorkRepository,
} from "./standard-work.repository";
import { seoulToday } from "./date";
import {
  equalPrice,
  materialValues,
  materialFromValues,
  materialIdentity,
  materialCode,
  priceChange,
  parseAmount,
} from "./material-price";
import { materialAccess } from "./material-access";
@Injectable()
export class MaterialExcelService {
  constructor(
    @Inject(STANDARD_WORK_REPOSITORY)
    private repository: StandardWorkRepository,
    @Inject(CompanyContext) private context: CompanyContext,
  ) {}
  async download(template = false) {
    materialAccess(this.context);
    const wb = new ExcelJS.Workbook();
    wb.creator = this.context.settings().name;
    const sheet = wb.addWorksheet("자재단가");
    sheet.columns = MATERIAL_EXCEL_COLUMNS.map((header, i) => ({
      header,
      key: String(i),
      width: i === 1 ? 32 : i === 12 ? 40 : 18,
    }));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = "A1:M1";
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203E5A" },
    };
    sheet.getRow(1).height = 26;
    const examples = [
      "화재감지기(연기식)",
      "화재감지기(차동식)",
      "소방용전선",
      "스프링클러헤드",
      "배관용탄소강관 백관 D25",
    ];
    const rows = template
      ? examples.map((name, i) => ({
          id: "",
          companyId: this.context.companyId,
          name,
          specification: ["연기식", "차동식", "HFIX 1.5SQ", "상향식", "25A"][i],
          unit: i === 2 || i === 4 ? "m" : "개",
          category: "재료비" as const,
          cost: 0,
          salePrice: 0,
          priceRegistered: false,
          costRegistered: false,
          purchasePriceRegistered: false,
          trade: i < 3 ? "전기" : "기계",
          effectiveDate: seoulToday(),
          notes: "입력 예시입니다. 실제 품목·단가로 수정하거나 삭제하세요.",
        }))
      : this.repository.list().prices;
    for (const p of rows) {
      const values = materialValues(p);
      const i = this.context.identity;
      if (
        i.authenticated &&
        i.appRole !== "admin" &&
        !i.permissions?.some((x) =>
          ["internalCosts", "manageMaterials", "approveMaterials"].includes(x),
        )
      ) {
        values[7] = "";
        values[8] = "";
      }
      sheet.addRow(values);
    }
    for (let i = 8; i <= 10; i++) sheet.getColumn(i).numFmt = "#,##0";
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  history(id: string) {
    materialAccess(this.context, "edit");
    if (!this.repository.list().prices.some((p) => p.id === id))
      throw new NotFoundException();
    return this.repository.priceHistory(id);
  }
  histories() {
    materialAccess(this.context, "edit");
    return this.repository.snapshot().histories.slice().reverse();
  }
  jobs() {
    materialAccess(this.context, "edit");
    return this.repository
      .listImports()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  job(id: string) {
    materialAccess(this.context, "edit");
    const j = this.repository.getImport(id);
    if (!j) throw new NotFoundException("업로드 검토 내역을 찾을 수 없습니다.");
    return j;
  }
  private summarize(job: MaterialImportJob) {
    const rows = job.rows.filter((r) => r.action !== "제외");
    job.summary = {
      total: job.rows.length,
      new: rows.filter((r) => r.status === "신규").length,
      updated: rows.filter((r) => r.status === "수정").length,
      unchanged: rows.filter((r) => r.status === "변경없음").length,
      errors: rows.filter((r) => r.status === "오류").length,
      duplicates: rows.filter((r) => r.duplicate).length,
      excluded: job.rows.filter((r) => r.action === "제외").length,
      held: rows.filter((r) => r.action === "보류").length,
    };
  }
  private validateRows(input: MaterialImportRow[]): MaterialImportRow[] {
    const current = this.repository.list().prices;
    const rows = input.map((original) => {
      const r: MaterialImportRow = {
        rowNumber: original.rowNumber,
        values: [...original.values],
        action: original.action,
        errors: [],
        status: "오류",
      };
      if (
        !Array.isArray(r.values) ||
        r.values.length !== 13 ||
        r.values.some((v) => typeof v !== "number" && typeof v !== "string")
      )
        throw new BadRequestException(
          "13개 셀의 텍스트 또는 숫자 값을 입력하세요.",
        );
      if (r.action && !["갱신", "신규등록", "제외", "보류"].includes(r.action))
        throw new BadRequestException("행 처리방식을 확인하세요.");
      const code = String(r.values[0]).trim(),
        name = String(r.values[1]).trim(),
        specification = String(r.values[2]).trim(),
        unit = String(r.values[3]).trim();
      const matches = code
        ? current.filter((p) => materialCode(p) === code)
        : current.filter(
            (p) =>
              materialIdentity(p) ===
              materialIdentity({ name, specification, unit }),
          );
      let found: WorkPrice | undefined = matches[0];
      if (!found && r.action === "갱신" && original.before)
        found = current.find((p) => p.id === original.before!.id);
      if (!name) r.errors.push("자재명 누락");
      if (!unit) r.errors.push("단위 누락");
      for (const i of [7, 8, 9])
        try {
          parseAmount(r.values[i], MATERIAL_EXCEL_COLUMNS[i]);
        } catch (e) {
          r.errors.push((e as Error).message);
        }
      if (
        r.values.some((v) => String(v).startsWith("수식/복합 셀 대신 값 입력:"))
      )
        r.errors.push("수식/복합 셀 대신 값을 입력하세요.");
      r.before = found?.id === original.before?.id ? original.before : found;
      if (matches.length > 1)
        r.errors.push("여러 기존품목과 일치합니다. 자재코드를 입력하세요.");
      r.duplicate =
        !!found &&
        materialIdentity(found) !==
          materialIdentity({ name, specification, unit });
      if (r.duplicate && r.action !== "갱신" && r.action !== "제외")
        r.errors.push(
          "동일 코드의 품목정보가 다릅니다. 비교 후 갱신·신규등록·제외·보류를 선택하세요.",
        );
      if (r.action === "신규등록" && found)
        r.errors.push("신규 등록에는 기존에 없는 고유 자재코드가 필요합니다.");
      if (r.action === "신규등록") r.before = undefined;
      try {
        r.price = materialFromValues(
          r.values,
          this.context.companyId,
          r.before?.id ??
            (original.price && !current.some((p) => p.id === original.price!.id)
              ? original.price.id
              : code || randomUUID()),
          r.before,
        );
        // Preserve missing-price semantics of unchanged legacy sample rows.
        if (
          r.before?.priceRegistered === false &&
          r.price.salePrice === r.before.salePrice &&
          String(r.values[9]).trim() === ""
        )
          r.price.priceRegistered = false;
      } catch (e) {
        r.errors.push((e as Error).message);
      }
      if (r.action === "보류")
        r.errors.push("검토 보류 중입니다. 승인 전 처리방식을 선택하세요.");
      r.status = r.errors.length
        ? "오류"
        : r.before
          ? equalPrice(r.before, r.price!)
            ? "변경없음"
            : "수정"
          : "신규";
      return r;
    });
    const codes = new Map<string, MaterialImportRow[]>(),
      keys = new Map<string, MaterialImportRow[]>();
    for (const r of rows.filter((r) => r.action !== "제외")) {
      const code = String(r.values[0]).trim(),
        key = JSON.stringify(r.values.slice(1, 4).map((v) => String(v).trim()));
      if (code) codes.set(code, [...(codes.get(code) ?? []), r]);
      keys.set(key, [...(keys.get(key) ?? []), r]);
    }
    for (const [map, message] of [
      [codes, "동일 파일 내 중복 자재코드"],
      [keys, "동일 파일 내 동일 자재 중복"],
    ] as const)
      for (const group of map.values())
        if (group.length > 1)
          for (const r of group) {
            r.duplicate = true;
            r.errors.push(message);
            r.status = "오류";
          }
    return rows;
  }
  async preview(buffer: Buffer, filename: string) {
    materialAccess(this.context, "edit");
    if (!buffer?.length || buffer.length > 10 * 1024 * 1024)
      throw new BadRequestException("10MB 이하의 XLSX 파일을 선택하세요.");
    let wb: ExcelJS.Workbook;
    try {
      let size = 0,
        count = 0;
      unzipSync(buffer, {
        filter: (f) => {
          size += f.originalSize;
          if (size > 50 * 1024 * 1024 || ++count > 1000) throw Error();
          return false;
        },
      });
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException(
        "XLSX 파일을 읽지 못했습니다. 암호 보호 여부와 파일 손상을 확인하세요. 구형 XLS는 다른 Excel 가져오기를 사용하세요.",
      );
    }
    const sheet = wb.worksheets[0];
    if (!sheet || sheet.rowCount > 2001)
      throw new BadRequestException("헤더 포함 최대 2,001행을 지원합니다.");
    if (
      MATERIAL_EXCEL_COLUMNS.some(
        (h, i) =>
          sheet
            .getRow(1)
            .getCell(i + 1)
            .text.trim() !== h,
      )
    )
      throw new BadRequestException(
        "다운로드한 표준 양식의 13개 컬럼 순서를 유지하세요.",
      );
    const source: MaterialImportRow[] = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      if (
        Array.from({ length: 13 }, (_, i) => row.getCell(i + 1).value).every(
          (v) => v === null || v === "",
        )
      )
        continue;
      const values = Array.from({ length: 13 }, (_, i) => {
        const v = row.getCell(i + 1).value;
        if (v === null) return "";
        if (typeof v === "string" || typeof v === "number") return v;
        if (v instanceof Date)
          return Number.isFinite(v.getTime())
            ? v.toISOString().slice(0, 10)
            : "잘못된 날짜";
        return `수식/복합 셀 대신 값 입력: ${row.getCell(i + 1).text}`;
      });
      source.push({ rowNumber: n, values, status: "오류", errors: [] });
    }
    if (!source.length)
      throw new BadRequestException("등록할 자재 행이 없습니다.");
    const job: MaterialImportJob = {
      id: randomUUID(),
      companyId: this.context.companyId,
      filename: filename.slice(0, 300),
      createdAt: new Date().toISOString(),
      createdBy: this.context.identity.userId,
      createdByDisplayName: this.context.identity.userDisplayName,
      status: "미리보기",
      revision: 1,
      rows: this.validateRows(source),
      summary: { total: 0, new: 0, updated: 0, unchanged: 0, errors: 0 },
    };
    this.summarize(job);
    this.repository.saveImport(job);
    return job;
  }
  private editable(id: string, revision?: number) {
    const job = this.job(id);
    if (["반영완료", "취소"].includes(job.status))
      throw new ConflictException(
        "완료 또는 취소된 업로드는 수정할 수 없습니다.",
      );
    if (revision !== undefined && revision !== job.revision)
      throw new ConflictException(
        "다른 사용자가 검토 내역을 수정했습니다. 다시 불러오세요.",
      );
    return job;
  }
  review(id: string, body: { rows: MaterialImportRow[]; revision?: number }) {
    const job = this.editable(id, body?.revision);
    if (
      !body ||
      !Array.isArray(body.rows) ||
      body.rows.length !== job.rows.length
    )
      throw new BadRequestException("모든 검토 행을 전달하세요.");
    const seen = new Set<number>();
    const input = body.rows.map((r) => {
      const old = job.rows.find((x) => x.rowNumber === r.rowNumber);
      if (!old || seen.has(r.rowNumber))
        throw new BadRequestException("중복 또는 잘못된 행 번호입니다.");
      seen.add(r.rowNumber);
      return { ...old, values: r.values, action: r.action };
    });
    job.rows = this.validateRows(input);
    job.status = "미리보기";
    job.updatedAt = new Date().toISOString();
    job.revision = (job.revision ?? 0) + 1;
    this.summarize(job);
    this.repository.saveImport(job);
    return job;
  }
  submit(id: string, revision?: number) {
    const job = this.editable(id, revision);
    job.status = "승인대기";
    job.revision = (job.revision ?? 0) + 1;
    job.updatedAt = new Date().toISOString();
    this.repository.saveImport(job);
    return job;
  }
  cancel(id: string) {
    const job = this.editable(id);
    job.status = "취소";
    job.updatedAt = new Date().toISOString();
    job.revision = (job.revision ?? 0) + 1;
    this.repository.saveImport(job);
    return job;
  }
  apply(
    id: string,
    body: { mode: unknown; revision?: number; reason?: string },
  ) {
    materialAccess(this.context, "approve");
    const job = this.jobForApproval(id);
    if (job.status === "반영완료") return job;
    if (job.status === "취소")
      throw new ConflictException("취소된 업로드는 승인할 수 없습니다.");
    if (
      !body ||
      !["정상행만", "전체"].includes(body.mode as string) ||
      typeof (body.reason ?? "") !== "string" ||
      (body.reason?.length ?? 0) > 500
    )
      throw new BadRequestException("승인 방식과 사유를 확인하세요.");
    if (body.revision !== undefined && body.revision !== job.revision)
      throw new ConflictException(
        "검토 내역이 변경되었습니다. 다시 확인하세요.",
      );
    // Ignore client-side classifications and re-validate every cell at approval time.
    job.rows = this.validateRows(job.rows);
    this.summarize(job);
    if (body.mode === "전체" && (job.summary.errors || job.summary.held))
      throw new BadRequestException(
        "오류·중복·보류를 해결하거나 제외한 뒤 승인하세요.",
      );
    const rows = job.rows.filter(
      (r) =>
        r.action !== "제외" && (r.status === "신규" || r.status === "수정"),
    );
    const current = this.repository.list().prices;
    for (const r of rows) {
      const now = current.find((p) => p.id === r.price!.id);
      if (
        r.before
          ? !now || !equalPrice(r.before, now)
          : !!now ||
            current.some((p) => materialCode(p) === materialCode(r.price!))
      )
        throw new ConflictException(
          `${r.rowNumber}행: 검토 이후 자재가 변경되었습니다. 새 업로드로 비교하세요.`,
        );
    }
    const histories = rows
      .map((r) => {
        const h = priceChange(
          r.price!,
          r.before,
          "Excel 업로드",
          job.createdBy,
        );
        if (h) {
          h.userDisplayName = job.createdByDisplayName ?? job.createdBy;
          h.approvedBy = this.context.identity.userId;
          h.approverDisplayName = this.context.identity.userDisplayName;
          h.reason = body.reason ?? "";
        }
        return h;
      })
      .filter((h): h is NonNullable<typeof h> => !!h);
    this.repository.commitPrices(
      rows.map((r) => r.price!),
      histories,
    );
    job.status = "반영완료";
    job.appliedAt = job.approvedAt = new Date().toISOString();
    job.approvedBy = this.context.identity.userId;
    job.approvalReason = body.reason ?? "";
    job.appliedCount = rows.length;
    job.revision = (job.revision ?? 0) + 1;
    this.repository.saveImport(job);
    return job;
  }
  private jobForApproval(id: string) {
    materialAccess(this.context, "approve");
    const job = this.repository.getImport(id);
    if (!job) throw new NotFoundException();
    return job;
  }
}
