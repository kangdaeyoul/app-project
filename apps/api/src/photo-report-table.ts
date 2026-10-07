import {
  InspectionItemInput,
  PhotoView,
  INSPECTION_REPORT_TITLE,
} from "@jongno/shared";
/** Submission table uses original inspection numbers, never row indices. */
export function appendInspectionTables(
  doc: PDFKit.PDFDocument,
  options: {
    items: InspectionItemInput[];
    photos: PhotoView[];
    images: Map<string, Buffer>;
    layout: 6 | 8;
    workDate: string;
    siteName: string;
    photosOnly: boolean;
  },
) {
  const { items, photos, images, layout, photosOnly } = options;
  const top = 75,
    bottom = 787,
    width = 535,
    slot = (bottom - top) / (layout / 2);
  let y = top;
  const page = () => {
    doc.addPage();
    doc
      .font("Korean")
      .fontSize(12)
      .fillColor("#183d43")
      .text(
        photosOnly ? "점검지적사항 사진대지" : INSPECTION_REPORT_TITLE,
        30,
        25,
        { width },
      );
    doc
      .fontSize(8)
      .fillColor("#657579")
      .text(
        `${options.siteName.replace(/\s+/g, " ").slice(0, 65)} · ${options.workDate}`,
        30,
        44,
        { width },
      );
    doc.text("전 사진", 30, 58, { width: 267.5, align: "center" });
    doc.text("후 사진", 297.5, 58, { width: 267.5, align: "center" });
    y = top;
  };
  page();
  for (const item of items) {
    if (photosOnly && !item.beforePhotoIds.length && !item.afterPhotoIds.length)
      continue;
    doc.fontSize(9);
    const heading = `점검번호 ${item.number}${item.location ? " | " + item.location : ""}`,
      inspection = `지적사항: ${item.inspection}`,
      repair = `보수내용: ${item.result}`;
    const headingH =
      doc.heightOfString(heading, { width: 519, lineGap: 1 }) + 12;
    const h1 = photosOnly
        ? 0
        : doc.heightOfString(inspection, { width: 519, lineGap: 2 }),
      h2 = photosOnly
        ? 0
        : doc.heightOfString(repair, { width: 519, lineGap: 2 });
    const metaH = headingH + (photosOnly ? 0 : h1 + h2 + 6),
      long = !photosOnly && metaH > slot - 105;
    if (long) {
      if (y !== top) page();
      doc.fontSize(11).fillColor("#183d43").text(heading, 30, y, { width });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .fillColor("#20373b")
        .text(inspection, { width, lineGap: 3 });
      doc.moveDown(0.8);
      doc.text(repair, { width, lineGap: 3 });
      page();
    }
    for (
      let n = 0;
      n < Math.max(1, item.beforePhotoIds.length, item.afterPhotoIds.length);
      n++
    ) {
      if (y + slot > bottom + 0.1) page();
      const headerH = long ? headingH : metaH,
        cellY = y + headerH,
        cellH = slot - headerH - 5;
      doc
        .lineWidth(0.5)
        .strokeColor("#aebec1")
        .rect(30, y, width, slot - 5)
        .stroke();
      doc.moveTo(30, cellY).lineTo(565, cellY).stroke();
      doc
        .moveTo(297.5, cellY)
        .lineTo(297.5, y + slot - 5)
        .stroke();
      doc
        .fontSize(9)
        .fillColor("#183d43")
        .text(heading + (n || long ? " · 계속" : ""), 38, y + 7, {
          width: 519,
          lineGap: 1,
        });
      if (!photosOnly && !long) {
        doc
          .fontSize(9)
          .fillColor("#20373b")
          .text(inspection, 38, y + headingH, { width: 519, lineGap: 2 });
        doc.text(repair, 38, doc.y + 3, { width: 519, lineGap: 2 });
      }
      for (const [col, id, stage] of [
        [0, item.beforePhotoIds[n], "작업 전"],
        [1, item.afterPhotoIds[n], "작업 후"],
      ] as const) {
        const x = 30 + col * 267.5,
          photo = photos.find((p) => p.id === id),
          imageHeight = cellH - 50;
        if (photo) {
          doc.image(images.get(id)!, x + 8, cellY + 6, {
            fit: [251.5, imageHeight],
            align: "center",
            valign: "center",
          });
          const short = (v: string, max: number) =>
            v.replace(/\s+/g, " ").slice(0, max);
          const subject = (
            item.photoContent ||
            photo.description ||
            item.result
          )
            .replace(/\s*(작업|보수)\s*(전|후)\s*$/, "")
            .trim();
          doc
            .fontSize(8)
            .fillColor("#20373b")
            .text(
              `사진내용 | ${short(subject, 45)} ${stage}\n위치 | ${short(item.location || photo.location, 30) || "미입력"}`,
              x + 8,
              cellY + imageHeight + 11,
              { width: 251.5, height: 38, ellipsis: true },
            );
        } else
          doc
            .fontSize(9)
            .fillColor("#657579")
            .text(`${stage} 사진 없음`, x + 8, cellY + 25, {
              width: 251.5,
              align: "center",
            });
      }
      y += slot;
    }
  }
}
