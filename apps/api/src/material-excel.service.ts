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
} from "@jongno/shared";
import { CompanyContext } from "./company-context";
import {
  STANDARD_WORK_REPOSITORY,
  StandardWorkRepository,
} from "./standard-work.repository";
import { validDate, seoulToday } from "./date";
import { equalPrice, normalizedPrice, priceChange } from "./material-price";
const identity = (p: Pick<WorkPrice, "name" | "specification" | "unit">) =>
  JSON.stringify([p.name.trim(), p.specification.trim(), p.unit.trim()]);
@Injectable()
export class MaterialExcelService {
  constructor(
    @Inject(STANDARD_WORK_REPOSITORY)
    private readonly repository: StandardWorkRepository,
    @Inject(CompanyContext) private readonly context: CompanyContext,
  ) {}
  async download(template = false) {
    this.context.assertMember(true);
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
      fgColor: { argb: "FF167D78" },
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
          specification: ["연기식", "차동식", "1.5sq", "상향식", "D25"][i],
          unit: i === 2 || i === 4 ? "m" : "개",
          category: "재료비" as const,
          cost: 0,
          salePrice: 0,
          trade: i < 3 ? "전기" : "기계",
          purchasePrice: 0,
          vatIncluded: false,
          effectiveDate: seoulToday(),
          notes: "입력 예시입니다. 실제 품목·단가로 수정하거나 삭제하세요.",
        }))
      : this.repository.list().prices;
    for (const row of rows) {
      const p = normalizedPrice(row);
      sheet.addRow([
        p.id,
        p.name,
        p.specification,
        p.unit,
        p.trade,
        p.manufacturer,
        p.supplier,
        p.purchasePrice,
        p.cost,
        p.salePrice,
        p.vatIncluded ? "포함" : "미포함",
        p.effectiveDate,
        p.notes,
      ]);
    }
    for (let i = 8; i <= 10; i++) sheet.getColumn(i).numFmt = "#,##0";
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  history(id: string) {
    this.context.assertMember(true);
    if (!this.repository.list().prices.some((p) => p.id === id))
      throw new NotFoundException();
    return this.repository.priceHistory(id);
  }
  job(id: string) {
    this.context.assertMember(true);
    const job = this.repository.getImport(id);
    if (!job)
      throw new NotFoundException("업로드 미리보기를 찾을 수 없습니다.");
    return job;
  }
  async preview(buffer: Buffer, filename: string) {
    this.context.assertMember(true);
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
      await wb.xlsx.load(
        buffer as unknown as Parameters<typeof wb.xlsx.load>[0],
      );
    } catch {
      throw new BadRequestException("유효한 XLSX 파일을 선택하세요.");
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
      throw new BadRequestException("표준 양식의 컬럼 순서를 유지해 주세요.");
    const current = this.repository.list().prices;
    const rows: MaterialImportRow[] = [];
    const seenCodes = new Map<string, MaterialImportRow[]>(),
      seenKeys = new Map<string, MaterialImportRow[]>();
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = sheet.getRow(n);
      if (
        Array.from({ length: 13 }, (_, i) => row.getCell(i + 1).value).every(
          (v) => v === null || v === "",
        )
      )
        continue;
      const errors: string[] = [];
      const values = Array.from({ length: 13 }, (_, i) => {
        const v = row.getCell(i + 1).value;
        if (v === null) return "";
        if (typeof v === "string" || typeof v === "number") return v;
        if (v instanceof Date)
          return Number.isFinite(v.getTime())
            ? v.toISOString().slice(0, 10)
            : "잘못된 날짜";
        errors.push(
          `${MATERIAL_EXCEL_COLUMNS[i]}: 수식/복합 셀 대신 값을 입력하세요.`,
        );
        return row.getCell(i + 1).text;
      });
      const str = (i: number) => String(values[i]).trim();
      const code = str(0),
        name = str(1),
        specification = str(2),
        unit = str(3);
      if (!name) errors.push("자재명 누락");
      if (!unit) errors.push("단위 누락");
      for (const [i, v] of values.entries())
        if (
          typeof v === "string" &&
          (v.length > (i === 12 ? 1000 : 300) || /[\u0000-\u001f]/.test(v))
        )
          errors.push(
            `${MATERIAL_EXCEL_COLUMNS[i]}: 텍스트 길이/제어문자 오류`,
          );
      if (code.length > 100) errors.push("자재코드는 100자 이내로 입력하세요.");
      const amount = (i: number) => {
        const v = values[i];
        if (v === "") return 0;
        const numeric = typeof v === "number" ? v : Number(String(v).trim());
        if (
          !Number.isSafeInteger(numeric) ||
          numeric < 0 ||
          numeric > 1000000000 ||
          (typeof v === "string" && !/^\d+(\.0+)?$/.test(v.trim()))
        ) {
          errors.push(
            `${MATERIAL_EXCEL_COLUMNS[i]}: 0 이상의 숫자형 정수 단가를 입력하세요.`,
          );
          return 0;
        }
        return numeric;
      };
      const purchasePrice = amount(7),
        cost = amount(8),
        salePrice = amount(9);
      const vat = str(10);
      if (
        ![
          "",
          "포함",
          "미포함",
          "Y",
          "N",
          "TRUE",
          "FALSE",
          "true",
          "false",
        ].includes(vat)
      )
        errors.push("부가세 포함여부: 포함/미포함 입력");
      let effectiveDate = str(11);
      if (typeof values[11] === "number") {
        const serial = values[11] as number;
        effectiveDate =
          Number.isFinite(serial) && serial >= 1 && serial <= 2958465
            ? new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000)
                .toISOString()
                .slice(0, 10)
            : "잘못된 날짜";
      }
      if (effectiveDate && !validDate(effectiveDate))
        errors.push("잘못된 적용일 (YYYY-MM-DD)");
      const key = identity({ name, specification, unit });
      const matches = code
        ? current.filter((p) => p.id === code)
        : current.filter((p) => identity(p) === key);
      if (matches.length > 1)
        errors.push("여러 기존품목과 일치합니다. 자재코드를 입력하세요.");
      const before = matches[0];
      const p: WorkPrice = {
        id: before?.id ?? (code || randomUUID()),
        companyId: this.context.companyId,
        name,
        specification,
        unit,
        category: before?.category ?? "재료비",
        trade: str(4),
        manufacturer: str(5),
        supplier: str(6),
        purchasePrice,
        cost,
        salePrice,
        vatIncluded: ["포함", "Y", "TRUE", "true"].includes(vat),
        effectiveDate,
        notes: str(12),
      };
      const result: MaterialImportRow = {
        rowNumber: n,
        values,
        status: errors.length
          ? "오류"
          : before
            ? equalPrice(before, p)
              ? "변경없음"
              : "수정"
            : "신규",
        errors,
        price: p,
        before,
      };
      rows.push(result);
      if (code) seenCodes.set(code, [...(seenCodes.get(code) ?? []), result]);
      seenKeys.set(key, [...(seenKeys.get(key) ?? []), result]);
    }
    for (const [groups, message] of [
      [seenCodes, "동일 파일 내 중복 자재코드"],
      [seenKeys, "동일 파일 내 동일 자재 중복"],
    ] as const)
      for (const group of groups.values())
        if (group.length > 1)
          for (const r of group) {
            r.errors.push(message);
            r.status = "오류";
          }
    if (!rows.length)
      throw new BadRequestException("등록할 자재 행이 없습니다.");
    const job: MaterialImportJob = {
      id: randomUUID(),
      companyId: this.context.companyId,
      filename: filename.slice(0, 300),
      createdAt: new Date().toISOString(),
      createdBy: this.context.identity.userId,
      status: "미리보기",
      rows,
      summary: {
        total: rows.length,
        new: rows.filter((r) => r.status === "신규").length,
        updated: rows.filter((r) => r.status === "수정").length,
        unchanged: rows.filter((r) => r.status === "변경없음").length,
        errors: rows.filter((r) => r.status === "오류").length,
      },
    };
    this.repository.saveImport(job);
    return job;
  }
  apply(id: string, body: { mode: unknown }) {
    const job = this.job(id);
    if (job.status === "반영완료") return job;
    if (!body || !["정상행만", "전체"].includes(body.mode as string))
      throw new BadRequestException("반영 방식을 선택하세요.");
    if (body.mode === "전체" && job.summary.errors)
      throw new BadRequestException(
        "오류를 수정한 파일을 다시 업로드한 후 전체 반영하세요.",
      );
    const rows = job.rows.filter(
      (r) => r.status === "신규" || r.status === "수정",
    );
    const current = this.repository.list().prices;
    for (const r of rows) {
      const now = current.find((p) => p.id === r.price!.id);
      if (
        r.before
          ? !now || !equalPrice(r.before, now)
          : !!now ||
            (!String(r.values[0]).trim() &&
              current.some((p) => identity(p) === identity(r.price!)))
      )
        throw new ConflictException(
          `${r.rowNumber}행: 미리보기 이후 자재DB가 변경되었습니다. 다시 업로드하세요.`,
        );
    }
    const prices = rows.map((r) => r.price!);
    const histories = rows
      .map((r) =>
        priceChange(
          r.price!,
          r.before,
          "Excel 업로드",
          this.context.identity.userId,
        ),
      )
      .filter((h): h is NonNullable<typeof h> => !!h);
    this.repository.commitPrices(prices, histories);
    job.status = "반영완료";
    job.appliedAt = new Date().toISOString();
    job.appliedCount = rows.length;
    this.repository.saveImport(job);
    return job;
  }
}
