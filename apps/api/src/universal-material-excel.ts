import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import * as XLSX from "@e965/xlsx";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { randomUUID } from "node:crypto";
import { MATERIAL_EXCEL_COLUMNS, MaterialImportJob } from "@jongro/shared";
import { CompanyContext } from "./company-context";
import { MaterialExcelService } from "./material-excel.service";
import {
  STANDARD_WORK_REPOSITORY,
  StandardWorkRepository,
} from "./standard-work.repository";
import { equalPrice } from "./material-price";
const aliases: Record<string, string[]> = {
  name: ["품명", "자재명", "제품명", "상품명"],
  specification: ["규격", "사이즈", "규격명"],
  unit: ["단위"],
  manufacturer: ["제조사", "제조업체"],
  cost: ["원가", "매입가", "구입가", "기준원가"],
  salePrice: ["판매단가", "기준판매단가", "견적가", "판매가"],
  trade: ["분류", "공종"],
  notes: ["비고", "메모"],
};
type Mapping = Record<string, number>;
type Format = { name: string; signature: string; mapping: Mapping };
@Injectable()
export class UniversalMaterialExcelService {
  private uploads = new Map<
    string,
    {
      companyId: string;
      filename: string;
      sheets: Record<string, (string | number)[][]>;
      created: number;
    }
  >();
  private formats = new Map<string, Format[]>();
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(MaterialExcelService) private excel: MaterialExcelService,
    @Inject(STANDARD_WORK_REPOSITORY)
    private repository: StandardWorkRepository,
  ) {}
  inspect(buffer: Buffer, filename: string) {
    this.company.assertMember(true);
    if (!buffer?.length || buffer.length > 10 * 1024 * 1024)
      throw new BadRequestException("10MB 이하 XLS/XLSX 파일을 선택하세요.");
    if (!(
      (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
      (buffer[0] === 0xd0 && buffer[1] === 0xcf)
    ))
      throw new BadRequestException("XLS 또는 XLSX 형식만 지원합니다.");
    let workbook: XLSX.WorkBook;
    try {
      if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
        let size = 0,
          count = 0;
        unzipSync(buffer, {
          filter: (f) => {
            size += f.originalSize;
            if (size > 50 * 1024 * 1024 || ++count > 1000) throw Error();
            return false;
          },
        });
      }
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellFormula: false,
        sheetRows: 2002,
      });
    } catch {
      throw new BadRequestException("유효한 XLS/XLSX 파일을 선택하세요.");
    }
    if (workbook.SheetNames.length > 30)
      throw new BadRequestException("최대 30개 시트만 지원합니다.");
    const sheets: Record<string, (string | number)[][]> = Object.create(null);
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const range = sheet["!ref"]
        ? XLSX.utils.decode_range(sheet["!ref"])
        : null;
      if (range && (range.e.r > 2000 || range.e.c > 255))
        throw new BadRequestException(
          "시트당 헤더 포함 2,001행, 256열까지 지원합니다.",
        );
      sheets[name] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
        defval: "",
      });
    }
    if (!Object.keys(sheets).length)
      throw new BadRequestException("시트가 없습니다.");
    for (const [id, u] of this.uploads)
      if (Date.now() - u.created > 3600000) this.uploads.delete(id);
    if (this.uploads.size >= 100)
      throw new BadRequestException(
        "업로드가 많습니다. 잠시 후 다시 시도하세요.",
      );
    const id = randomUUID();
    this.uploads.set(id, {
      companyId: this.company.companyId,
      filename,
      sheets,
      created: Date.now(),
    });
    return {
      id,
      sheets: Object.entries(sheets).map(([name, rows]) => ({
        name,
        rows: rows.slice(0, 12),
        rowCount: rows.length,
      })),
      formats: this.formats.get(this.company.companyId) ?? [],
      suggestions: aliases,
    };
  }
  preview = async (
    id: string,
    b: {
      sheetName: string;
      headerRow: number;
      mapping: Mapping;
      policy: string;
      templateName?: string;
    },
  ) => {
    this.company.assertMember(true);
    const u = this.uploads.get(id);
    if (!u || u.companyId !== this.company.companyId)
      throw new NotFoundException();
    if (!b || typeof b !== "object")
      throw new BadRequestException("열 매핑을 확인하세요.");
    const rows = u.sheets[b.sheetName];
    if (
      !rows ||
      !Number.isInteger(b.headerRow) ||
      b.headerRow < 1 ||
      b.headerRow > rows.length ||
      !b.mapping ||
      ![
        "기존값 유지",
        "단가 업데이트",
        "전체정보 업데이트",
        "신규 등록",
      ].includes(b.policy)
    )
      throw new BadRequestException("시트·헤더·중복처리 방식을 확인하세요.");
    if (b.templateName !== undefined && typeof b.templateName !== "string")
      throw new BadRequestException("양식 이름을 확인하세요.");
    const mapping = b.mapping;
    if (
      !Number.isInteger(mapping.name) ||
      mapping.name < 0 ||
      !Number.isInteger(mapping.unit) ||
      mapping.unit < 0
    )
      throw new BadRequestException("품명과 단위를 연결하세요.");
    for (const [k, v] of Object.entries(mapping))
      if (
        !Object.hasOwn(aliases, k) ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > 255
      )
        throw new BadRequestException("열 매핑을 확인하세요.");
    const current = this.repository.list().prices;
    const wb = new ExcelJS.Workbook(),
      s = wb.addWorksheet("자재단가");
    s.addRow([...MATERIAL_EXCEL_COLUMNS]);
    const get = (r: (string | number)[], k: string) =>
      mapping[k] === undefined ? "" : (r[mapping[k]] ?? "");
    for (const r of rows.slice(b.headerRow)) {
      if (r.every((v) => v === "")) continue;
      const name = String(get(r, "name")).trim(),
        specification = String(get(r, "specification")).trim(),
        unit = String(get(r, "unit")).trim();
      const old = current.find(
        (p) =>
          p.name.trim() === name &&
          p.specification.trim() === specification &&
          p.unit.trim() === unit,
      );
      const preserve = b.policy === "기존값 유지" && old;
      const priceOnly = b.policy === "단가 업데이트" && old;
      const p = old;
      const mapped = (k: string, fallback: unknown) =>
        mapping[k] === undefined ? fallback : get(r, k);
      s.addRow([
        b.policy === "신규 등록" ? `MAT-${randomUUID()}` : (p?.id ?? ""),
        name,
        specification,
        unit,
        preserve || priceOnly
          ? (p?.trade ?? "")
          : mapped("trade", p?.trade ?? ""),
        preserve || priceOnly
          ? (p?.manufacturer ?? "")
          : mapped("manufacturer", p?.manufacturer ?? ""),
        p?.supplier ?? "",
        p?.purchasePrice ?? 0,
        preserve ? (p?.cost ?? "") : mapped("cost", p?.cost ?? ""),
        preserve
          ? (p?.salePrice ?? "")
          : mapped(
              "salePrice",
              p?.priceRegistered === false ? "" : (p?.salePrice ?? ""),
            ),
        p?.vatIncluded ? "포함" : "미포함",
        p?.effectiveDate ?? "",
        preserve || priceOnly
          ? (p?.notes ?? "")
          : mapped("notes", p?.notes ?? ""),
      ]);
    }
    const job: MaterialImportJob = await this.excel.preview(
      Buffer.from(await wb.xlsx.writeBuffer()),
      u.filename,
    );
    for (const row of job.rows) {
      const matches = current.filter(
        (p) =>
          p.name.trim() === String(row.values[1]).trim() &&
          p.specification.trim() === String(row.values[2]).trim() &&
          p.unit.trim() === String(row.values[3]).trim(),
      );
      if (b.policy !== "신규 등록" && matches.length > 1) {
        row.status = "오류";
        row.errors.push(
          "자재DB에 같은 품명·규격·단위가 여러 건입니다. 표준 양식에서 자재코드로 지정하세요.",
        );
        continue;
      }
      if (
        row.price &&
        row.before &&
        b.policy === "기존값 유지" &&
        row.status !== "오류"
      ) {
        row.price = structuredClone(row.before);
        row.status = "변경없음";
      } else if (row.price && row.before && row.status !== "오류")
        row.status = equalPrice(row.price, row.before) ? "변경없음" : "수정";
    }
    job.summary = {
      total: job.rows.length,
      new: job.rows.filter((r) => r.status === "신규").length,
      updated: job.rows.filter((r) => r.status === "수정").length,
      unchanged: job.rows.filter((r) => r.status === "변경없음").length,
      errors: job.rows.filter((r) => r.status === "오류").length,
    };
    this.repository.saveImport(job);
    if (b.templateName?.trim()) {
      if (b.templateName.length > 100)
        throw new BadRequestException("양식 이름은 100자 이내입니다.");
      const signature = JSON.stringify(
        rows[b.headerRow - 1].map((v) => String(v).trim().toLowerCase()),
      );
      const formats = this.formats.get(this.company.companyId) ?? [];
      const format = {
        name: b.templateName.trim(),
        signature,
        mapping: structuredClone(mapping),
      };
      const i = formats.findIndex((f) => f.name === format.name);
      if (i < 0) formats.push(format);
      else formats[i] = format;
      this.formats.set(this.company.companyId, formats);
    }
    return job;
  };
}
@Controller("material-prices/universal")
export class UniversalMaterialExcelController {
  constructor(
    @Inject(UniversalMaterialExcelService)
    private service: UniversalMaterialExcelService,
  ) {}
  @Post("inspect")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  inspect(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException("파일을 선택하세요.");
    return this.service.inspect(file.buffer, file.originalname);
  }
  @Post(":id/preview") preview(
    @Param("id") id: string,
    @Body() body: Parameters<UniversalMaterialExcelService["preview"]>[1],
  ) {
    return this.service.preview(id, body);
  }
}
