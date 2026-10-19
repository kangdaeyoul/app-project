import { CompanyTemplateResolver } from "./company-template";
import { Inject, Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { companyPresentation } from "./quote-presentation";
import { addQuoteImages, genericQuoteExcel } from "./quote-excel-images";
import { CustomerQuote } from "@jongro/shared";
export type ExcelQuote = CustomerQuote & {
  contactName: string;
  phone: string;
  groups: number[][];
};
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const xml = (d: ReturnType<typeof parse>) =>
  strToU8(new XMLSerializer().serializeToString(d));
@Injectable()
export class QuoteExcelService {
  constructor(
    @Inject(CompanyTemplateResolver)
    private readonly templates: CompanyTemplateResolver,
  ) {}
  generate(q: ExcelQuote): Buffer {
    q = {
      ...q,
      companySnapshot:
        q.companySnapshot ?? companyPresentation(this.templates.settings()),
    };
    if (q.companySnapshot?.companyId !== "jongro") return genericQuoteExcel(q);
    const files = unzipSync(readFileSync(this.templates.quotePath()));
    const wb = parse(strFromU8(files["xl/workbook.xml"]));
    const rels = parse(strFromU8(files["xl/_rels/workbook.xml.rels"]));
    const content = parse(strFromU8(files["[Content_Types].xml"]));
    const sheets = wb.getElementsByTagName("sheets")[0];
    const names = wb.getElementsByTagName("definedNames")[0];
    const hideAmounts = q.printMode === "금액 숨김";
    const hideUnits = hideAmounts || q.printMode === "단가 숨김";
    const cover = parse(strFromU8(files["xl/worksheets/sheet1.xml"]));
    const set = (
      d: ReturnType<typeof parse>,
      ref: string,
      value: string | number,
      style?: string,
    ) => {
      let cell = Array.from(d.getElementsByTagName("c")).find(
        (c) => c.getAttribute("r") === ref,
      );
      if (!cell) {
        const row = Array.from(d.getElementsByTagName("row")).find(
          (r) => r.getAttribute("r") === ref.replace(/^[A-Z]+/, ""),
        );
        if (!row) throw new Error(`Template row missing: ${ref}`);
        cell = d.createElement("c");
        cell.setAttribute("r", ref);
        const column = (r: string) =>
          r
            .match(/^[A-Z]+/)![0]
            .split("")
            .reduce((v, c) => v * 26 + c.charCodeAt(0) - 64, 0);
        const after = Array.from(row.getElementsByTagName("c")).find(
          (c) => column(c.getAttribute("r")!) > column(ref),
        );
        row.insertBefore(cell, after ?? null);
      }
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      cell.removeAttribute("t");
      if (style) cell.setAttribute("s", style);
      if (typeof value === "number") {
        const v = d.createElement("v");
        v.appendChild(d.createTextNode(String(value)));
        cell.appendChild(v);
      } else {
        cell.setAttribute("t", "inlineStr");
        const is = d.createElement("is"),
          t = d.createElement("t");
        t.setAttribute("xml:space", "preserve");
        t.appendChild(d.createTextNode(value));
        is.appendChild(t);
        cell.appendChild(is);
      }
    };
    const company =
      q.companySnapshot ?? companyPresentation(this.templates.settings());
    set(cover, "I6", company.name);
    set(
      cover,
      "I7",
      [
        company.representative && `대표 : ${company.representative}`,
        company.contactName && `담당 : ${company.contactName}`,
      ]
        .filter(Boolean)
        .join(" / "),
    );
    set(
      cover,
      "I8",
      company.registrationNumber
        ? `사업자등록번호 ${company.registrationNumber}`
        : "",
    );
    set(cover, "I9", company.address);
    set(
      cover,
      "I10",
      [company.businessType, company.businessItem].filter(Boolean).join(" / "),
    );
    set(
      cover,
      "I11",
      [
        company.phone && `전화 ${company.phone}`,
        company.fax && `팩스 ${company.fax}`,
      ]
        .filter(Boolean)
        .join(" / "),
    );
    set(cover, "I12", company.email);
    set(cover, "I13", company.website);
    set(cover, "C1", `견적번호 ${q.quoteNumber ?? q.id}`);
    set(cover, "E6", q.quoteDate);
    set(cover, "E7", q.siteName);
    set(cover, "E8", q.address);
    set(cover, "B8", q.address ? "현장주소" : "");
    set(cover, "D8", q.address ? ":" : "");
    set(cover, "B9", q.customerName ? "거래처" : "");
    set(cover, "E9", q.customerName);
    set(cover, "D9", q.customerName ? ":" : "");
    set(cover, "F9", q.customerName ? "귀중" : "");
    set(cover, "B10", q.phone ? "연락처" : "");
    set(cover, "E10", q.phone);
    set(cover, "D10", q.phone ? ":" : "");
    const notes = [
      q.customerSnapshot?.recipient && `수신: ${q.customerSnapshot.recipient}`,
      q.contactName && `담당자: ${q.contactName}`,
      q.workContent && `공사내용: ${q.workContent}`,
      q.workPeriod && `공사기간 / 납기: ${q.workPeriod}`,
      `견적 유효기간: ${q.validUntil}`,
      q.notes,
      company.footer,
      company.contactPhone && `회사 담당자 연락처: ${company.contactPhone}`,
      company.bankInfo && `계좌: ${company.bankInfo}`,
    ]
      .filter(Boolean)
      .join("\n");
    set(cover, "B32", notes);
    const groupedTotals = [0, 0, 0, 0, 0];
    q.sections.forEach((s, si) =>
      s.items.forEach((i, ii) => (groupedTotals[q.groups[si][ii]] += i.amount)),
    );
    const values = [
      ...groupedTotals,
      q.totals.generalFee,
      q.totals.supportFee,
      q.totals.adjustment,
    ];
    const labels = [
      "1. 주자재비",
      "2. 배관자재비",
      "3. 전기자재비",
      "4. 노무비",
      "5. 경비",
      "6. 일반관리비",
      "7. 착·준공지원비",
      "8. 고객가격 반올림 조정",
    ];
    labels.forEach((label, i) => {
      const r = 16 + i;
      const row = Array.from(cover.getElementsByTagName("row")).find(
        (v) => v.getAttribute("r") === String(r),
      );
      if (values[i] === 0) row?.setAttribute("hidden", "1");
      set(cover, `C${r}`, label, "3");
      set(cover, `G${r}`, 1);
      set(cover, `H${r}`, "식");
      if (!hideUnits) set(cover, `I${r}`, values[i]);
      if (!hideAmounts) set(cover, `J${r}`, values[i]);
    });
    [
      ["C24", "공급가액"],
      ["C25", "VAT"],
      ["C26", "VAT 포함 총액"],
    ].forEach(([r, t]) => set(cover, r, t, "3"));
    if (!hideAmounts) {
      set(cover, "B12", "총 견적금액 (VAT 포함)");
      set(cover, "E12", `₩${q.totals.totalAmount.toLocaleString("en-US")}`);
      set(cover, "J24", q.totals.supplyAmount);
      set(cover, "J25", q.totals.vat);
      set(cover, "J26", q.totals.totalAmount);
      set(cover, "C30", "총 견적금액 (VAT 포함)");
      set(cover, "J30", q.totals.totalAmount);
    }
    files["xl/worksheets/sheet1.xml"] = xml(cover);
    let next = 4;
    for (const [kind, base, ranges, subtotals, last] of [
      [
        "기계",
        2,
        [
          [5, 19],
          [23, 69],
          [73, 83],
          [87, 96],
        ],
        [20, 70, 84, 97],
        99,
      ],
      [
        "전기",
        3,
        [
          [5, 14],
          [18, 45],
          [49, 59],
          [63, 72],
        ],
        [15, 46, 60, 73],
        75,
      ],
    ] as const) {
      const si = q.sections.findIndex((s) => s.kind === kind);
      const source = si < 0 ? [] : q.sections[si].items;
      const existingSheet = Array.from(
        sheets.getElementsByTagName("sheet"),
      ).find((s) => s.getAttribute("r:id") === `rId${base}`);
      if (!source.length || q.printMode === "총액 위주") {
        if (existingSheet) sheets.removeChild(existingSheet);
        delete files[`xl/worksheets/sheet${base}.xml`];
        delete files[`xl/worksheets/_rels/sheet${base}.xml.rels`];
        for (const rel of Array.from(rels.getElementsByTagName("Relationship")))
          if (rel.getAttribute("Id") === `rId${base}`)
            rels.documentElement!.removeChild(rel);
        for (const ct of Array.from(content.getElementsByTagName("Override")))
          if (ct.getAttribute("PartName") === `/xl/worksheets/sheet${base}.xml`)
            content.documentElement!.removeChild(ct);
        continue;
      }
      existingSheet?.setAttribute("name", `${kind} 상세 내역서`);
      const buckets = ranges.map((_, g) =>
        source.filter((_, i) => Math.min(q.groups[si][i], 3) === g),
      );
      // Optional public grouping uses only sale prices. Internal costs never enter the renderer.
      if (q.printMode === "공종별 묶음")
        for (let g = 0; g < 4; g++) {
          const grouped = new Map<string, (typeof source)[number]>();
          for (const i of buckets[g]) {
            const old = grouped.get(i.trade);
            grouped.set(i.trade, {
              ...i,
              name: i.trade,
              specification: "공종별 합계",
              quantity: 1,
              unit: "식",
              saleUnitPrice: (old?.amount ?? 0) + i.amount,
              amount: (old?.amount ?? 0) + i.amount,
              notes: "",
            });
          }
          buckets[g] = [...grouped.values()];
        }

      const pending = buckets.map((b) => [...b]);
      const pages: (typeof buckets)[] = [];
      while (pending.some((b) => b.length)) {
        let slots = 22;
        const groups = pending.map((b, g) => {
          const take = Math.min(slots, ranges[g][1] - ranges[g][0] + 1);
          const rows = b.splice(0, take);
          slots -= rows.length;
          return rows;
        });
        pages.push(groups);
      }
      const count = pages.length;
      const template = strFromU8(files[`xl/worksheets/sheet${base}.xml`]);
      for (let page = 0; page < count; page++) {
        const id = page === 0 ? base : next++,
          d = parse(template);
        set(
          d,
          "B1",
          `${kind} 상세 내역서 · ${q.siteName}${page ? ` (계속 ${page + 1})` : ""}`,
        );
        let pageTotal = 0;
        ranges.forEach(([start, end], g) => {
          set(
            d,
            `B${start - 2}`,
            ["주자재비", "배관자재비", "전기자재비", "노무비·경비"][g],
          );
          const rows = pages[page][g];
          for (const row of Array.from(d.getElementsByTagName("row"))) {
            const n = Number(row.getAttribute("r"));
            if (
              (!rows.length && n >= start - 2 && n <= subtotals[g]) ||
              (n >= start + rows.length && n <= end) ||
              n === start - 1
            )
              row.setAttribute("hidden", "1");
          }
          let sum = 0;
          rows.forEach((i, index) => {
            const r = start + index;
            set(d, `B${r}`, i.name);
            set(d, `C${r}`, i.specification);
            set(d, `D${r}`, i.unit);
            set(d, `E${r}`, i.quantityPending ? "" : i.quantity);
            set(d, `H${r}`, i.notes);
            if (!hideUnits) set(d, `F${r}`, i.pricePending ? "" : i.saleUnitPrice);
            if (!hideAmounts) set(d, `G${r}`, i.quantityPending || i.pricePending ? "" : i.amount);
            sum += i.amount;
          });
          pageTotal += sum;
          if (!hideAmounts) set(d, `G${subtotals[g]}`, sum);
        });
        if (!hideAmounts) set(d, `G${last}`, pageTotal);
        const path = `xl/worksheets/sheet${id}.xml`;
        files[path] = xml(d);
        if (page) {
          const name = `${kind} 상세 내역서-${page + 1}`,
            s = wb.createElement("sheet");
          s.setAttribute("name", name);
          s.setAttribute("sheetId", String(id + 30));
          s.setAttribute("r:id", `rIdQuote${id}`);
          sheets.appendChild(s);
          const rel = rels.createElement("Relationship");
          rel.setAttribute("Id", `rIdQuote${id}`);
          rel.setAttribute(
            "Type",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
          );
          rel.setAttribute("Target", `worksheets/sheet${id}.xml`);
          rels.documentElement!.appendChild(rel);
          const ct = content.createElement("Override");
          ct.setAttribute("PartName", `/${path}`);
          ct.setAttribute(
            "ContentType",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
          );
          content.documentElement!.appendChild(ct);
          files[`xl/worksheets/_rels/sheet${id}.xml.rels`] =
            files[`xl/worksheets/_rels/sheet${base}.xml.rels`];
          const area = wb.createElement("definedName");
          area.setAttribute("name", "_xlnm.Print_Area");
          area.setAttribute(
            "localSheetId",
            String(sheets.getElementsByTagName("sheet").length - 1),
          );
          area.appendChild(wb.createTextNode(`'${name}'!$A$1:$I$${last + 1}`));
          names.appendChild(area);
        }
      }
    }
    sheets.getElementsByTagName("sheet")[0].setAttribute("name", "견적 요약");
    const ordered = Array.from(sheets.getElementsByTagName("sheet")).sort(
      (a, b) => {
        const rank = (v: typeof a) =>
          v.getAttribute("name") === "견적 요약"
            ? 0
            : v.getAttribute("name")!.startsWith("기계")
              ? 1
              : 2;
        return rank(a) - rank(b);
      },
    );
    ordered.forEach((s) => sheets.appendChild(s));
    while (names.firstChild) names.removeChild(names.firstChild);
    ordered.forEach((s, index) => {
      const area = wb.createElement("definedName");
      area.setAttribute("name", "_xlnm.Print_Area");
      area.setAttribute("localSheetId", String(index));
      const name = s.getAttribute("name")!;
      area.appendChild(
        wb.createTextNode(
          `'${name}'!${index === 0 ? "$A$1:$L$40" : name.startsWith("기계") ? "$A$1:$I$100" : "$A$1:$I$76"}`,
        ),
      );
      names.appendChild(area);
    });
    addQuoteImages(files, company);
    files["xl/workbook.xml"] = xml(wb);
    files["xl/_rels/workbook.xml.rels"] = xml(rels);
    files["[Content_Types].xml"] = xml(content);
    const appMeta = parse(
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>현장관리</Application><TitlesOfParts><vt:vector baseType="lpstr" size="0"/></TitlesOfParts></Properties>',
    );
    const vector = appMeta.getElementsByTagName("vt:vector")[0];
    vector.setAttribute("size", String(ordered.length));
    ordered.forEach((s) => {
      const t = appMeta.createElement("vt:lpstr");
      t.appendChild(appMeta.createTextNode(s.getAttribute("name")!));
      vector.appendChild(t);
    });
    const companyMeta = appMeta.createElement("Company");
    companyMeta.appendChild(appMeta.createTextNode(company.name));
    appMeta.documentElement!.appendChild(companyMeta);
    files["docProps/app.xml"] = xml(appMeta);
    return Buffer.from(zipSync(files));
  }
}
