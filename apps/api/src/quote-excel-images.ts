import { QuoteCompanySnapshot, CustomerQuote } from "@jongro/shared";
import { strToU8, strFromU8, zipSync } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const parse = (s: string) =>
  new DOMParser().parseFromString(s, "application/xml");
const relNS = "http://schemas.openxmlformats.org/package/2006/relationships";
export function addQuoteImages(
  files: Record<string, Uint8Array>,
  p: QuoteCompanySnapshot,
) {
  const NS =
    "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
  const sheetForPosition = parse(strFromU8(files["xl/worksheets/sheet1.xml"]));
  const marker = (x: number, y: number) => {
    let col = 0,
      row = 0;
    const widths = Array.from(sheetForPosition.getElementsByTagName("col"));
    while (col < 100) {
      const c = widths.find(
        (c) =>
          Number(c.getAttribute("min")) <= col + 1 &&
          Number(c.getAttribute("max")) >= col + 1,
      );
      const width =
        Math.floor(
          ((Number(c?.getAttribute("width") ?? 8.43) * 256 +
            Math.floor(128 / 7)) /
            256) *
            7,
        ) *
        12700 *
        0.75;
      if (x < width) break;
      x -= width;
      col++;
    }
    const rows = Array.from(sheetForPosition.getElementsByTagName("row"));
    while (row < 1000) {
      const r = rows.find((r) => Number(r.getAttribute("r")) === row + 1),
        height = Number(r?.getAttribute("ht") ?? 15) * 12700;
      if (y < height) break;
      y -= height;
      row++;
    }
    return `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${Math.round(x)}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${Math.round(y)}</xdr:rowOff></xdr:from>`;
  };
  let anchors = "",
    rels = "";
  for (const [index, kind] of ["logo", "seal"].entries()) {
    const a = p[kind as "logo" | "seal"];
    if (!a) continue;
    const mime = a.dataUrl.split(";")[0],
      ext = mime.endsWith("png") ? "png" : "jpeg";
    const path = `xl/media/quote${kind}.${ext}`;
    files[path] = Buffer.from(a.dataUrl.split(",")[1], "base64");
    const ratio =
      a.pixelWidth && a.pixelHeight ? a.pixelHeight / a.pixelWidth : 1;
    const size = (kind === "logo" ? p.logoWidth : p.sealWidth) * 36000;
    const w = ratio > 1 ? size / ratio : size;
    const h = ratio > 1 ? size : size * ratio;
    const x =
      (kind === "logo" ? 350 : 490) * 12700 +
      (kind === "seal" ? p.sealOffsetX * 36000 : 0);
    const y =
      (kind === "logo" ? 80 : 93) * 12700 +
      (kind === "seal" ? p.sealOffsetY * 36000 : 0);
    anchors += `<xdr:oneCellAnchor>${marker(Math.max(0, x), Math.max(0, y))}<xdr:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="${kind}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    rels += `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/quote${kind}.${ext}"/>`;
  }
  files["xl/drawings/drawing1.xml"] = strToU8(
    `<xdr:wsDr xmlns:xdr="${NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`,
  );
  files["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(
    `<Relationships xmlns="${relNS}">${rels}</Relationships>`,
  );
  const sheet = parse(strFromU8(files["xl/worksheets/sheet1.xml"]));
  let drawing = sheet.getElementsByTagName("drawing")[0];
  if (!drawing) {
    drawing = sheet.createElement("drawing");
    drawing.setAttribute("r:id", "rIdQuoteDrawing");
    sheet.documentElement!.appendChild(drawing);
  } else drawing.setAttribute("r:id", "rIdQuoteDrawing");
  files["xl/worksheets/sheet1.xml"] = strToU8(
    new XMLSerializer().serializeToString(sheet),
  );
  const path = "xl/worksheets/_rels/sheet1.xml.rels";
  const r = parse(
    files[path] ? strFromU8(files[path]) : `<Relationships xmlns="${relNS}"/>`,
  );
  for (const child of Array.from(r.getElementsByTagName("Relationship")))
    if (child.getAttribute("Type")?.endsWith("/drawing"))
      r.documentElement!.removeChild(child);
  const rel = r.createElement("Relationship");
  rel.setAttribute("Id", "rIdQuoteDrawing");
  rel.setAttribute(
    "Type",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  );
  rel.setAttribute("Target", "../drawings/drawing1.xml");
  r.documentElement!.appendChild(rel);
  files[path] = strToU8(new XMLSerializer().serializeToString(r));
  const c = parse(strFromU8(files["[Content_Types].xml"]));
  for (const [extension, type] of [
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
  ])
    if (
      !Array.from(c.getElementsByTagName("Default")).some(
        (d) => d.getAttribute("Extension") === extension,
      )
    ) {
      const d = c.createElement("Default");
      d.setAttribute("Extension", extension);
      d.setAttribute("ContentType", type);
      c.documentElement!.appendChild(d);
    }
  if (
    !Array.from(c.getElementsByTagName("Override")).some(
      (d) => d.getAttribute("PartName") === "/xl/drawings/drawing1.xml",
    )
  ) {
    const o = c.createElement("Override");
    o.setAttribute("PartName", "/xl/drawings/drawing1.xml");
    o.setAttribute(
      "ContentType",
      "application/vnd.openxmlformats-officedocument.drawing+xml",
    );
    c.documentElement!.appendChild(o);
  }
  files["[Content_Types].xml"] = strToU8(
    new XMLSerializer().serializeToString(c),
  );
  // Old template image parts are private branding; never leave them in another company's export.
  for (const key of Object.keys(files))
    if (/^xl\/media\/image\d+\./.test(key)) delete files[key];
}
export function genericQuoteExcel(q: CustomerQuote): Buffer {
  const p = q.companySnapshot!;
  const hidden = q.printMode === "금액 숨김";
  const rows: (string | number)[][] = [
    ["견적서"],
    [p.name],
    [p.representative ? `대표 ${p.representative}` : "", p.registrationNumber],
    [p.address],
    [p.phone, p.fax, p.email, p.website],
    ["견적번호", q.quoteNumber ?? q.id],
    ["견적일", q.quoteDate],
    ...(q.customerName ? [["거래처", q.customerName]] : []),
    ...(q.customerSnapshot?.recipient
      ? [["수신", q.customerSnapshot.recipient]]
      : []),
    ["현장명", q.siteName],
    ...(q.address ? [["현장주소", q.address]] : []),
    ...(q.customerSnapshot?.contactName
      ? [["담당자", q.customerSnapshot.contactName, q.customerSnapshot.phone]]
      : []),
    ...Object.entries({
      재료비: q.totals.material,
      노무비: q.totals.labor,
      경비: q.totals.expense,
      일반관리비: q.totals.generalFee,
      "착·준공지원비": q.totals.supportFee,
      공급가액: q.totals.supplyAmount,
      VAT: q.totals.vat,
      "VAT 포함 총액": q.totals.totalAmount,
    }).filter(([label, value]) => value !== 0 || ["공급가액", "VAT", "VAT 포함 총액"].includes(label)).map(([label, value]) => [label, hidden ? "금액 비공개" : value]),
    ...(q.workPeriod ? [["공사기간 / 납기", q.workPeriod]] : []),
    ["유효기간", q.validUntil],
    ...(q.notes ? [["비고", q.notes]] : []),
    ...(p.footer ? [["안내", p.footer]] : []),
    ...(p.contactName || p.contactPhone
      ? [["회사 담당", p.contactName, p.contactPhone]]
      : []),
    ...(p.bankInfo ? [["계좌", p.bankInfo]] : []),
  ];
  const sections =
    q.printMode === "총액 위주" ? [] : q.sections.filter((s) => s.items.length);
  const sheets = [
    { name: "견적 요약", rows },
    ...sections.map((s) => ({
      name: `${s.kind} 상세 내역서`,
      rows: [
        [q.siteName],
        [s.kind + " 상세 내역서"],
        ["품명", "규격", "수량", "단위", "단가", "금액", "비고"],
        ...s.items.map((i) => [
          i.name,
          i.specification,
          i.quantityPending ? "" : i.quantity,
          i.unit,
          q.printMode === "전체 상세" && !i.pricePending ? i.saleUnitPrice : "",
          hidden || i.quantityPending || i.pricePending ? "" : i.amount,
          i.notes,
        ]),
      ],
    })),
  ];
  const files: Record<string, Uint8Array> = {};
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  files["[Content_Types].xml"] = strToU8(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<Relationships xmlns="${relNS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${sheets.map((s, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${esc(s.name)}'!$A$1:$G$${s.rows.length}</definedName>`).join("")}</definedNames></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<Relationships xmlns="${relNS}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="2" width="30" customWidth="1"/><col min="3" max="7" width="18" customWidth="1"/></cols><sheetData>${s.rows
        .filter((r) => r.some((v) => v !== "" && v !== undefined))
        .map(
          (row, n) =>
            `<row r="${n + 1}">${row.map((v, c) => (typeof v === "number" ? `<c r="${String.fromCharCode(65 + c)}${n + 1}"><v>${v}</v></c>` : `<c r="${String.fromCharCode(65 + c)}${n + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join("")}</row>`,
        )
        .join(
          "",
        )}</sheetData><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`,
    );
  });
  addQuoteImages(files, p);
  return Buffer.from(zipSync(files));
}
