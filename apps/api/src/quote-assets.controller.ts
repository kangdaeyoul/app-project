import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
  Param,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import sharp from "sharp";
import { CompanyContext } from "./company-context";
@Controller("company/quote-assets")
export class QuoteAssetsController {
  constructor(@Inject(CompanyContext) private company: CompanyContext) {}
  @Post(":kind")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 1024 * 1024, files: 1 } }),
  )
  async upload(
    @Param("kind") kind: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    this.company.assertMember(true);
    if (!["logo", "seal"].includes(kind) || !file?.buffer)
      throw new BadRequestException("PNG/JPG 파일을 선택하세요.");
    try {
      const image = sharp(file.buffer, { limitInputPixels: 10000000 });
      const meta = await image.metadata();
      if (!["png", "jpeg"].includes(meta.format!))
        throw new BadRequestException("PNG/JPG만 업로드할 수 있습니다.");
      let output = file.buffer,
        removed = false;
      const decoded = await image
        .clone()
        .rotate()
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const transparentPng =
        meta.format === "png" &&
        meta.hasAlpha &&
        decoded.data.some((value, index) => index % 4 === 3 && value < 255);
      const processedSeal = kind === "seal" && !transparentPng;
      if (processedSeal) {
        const { data, info } = decoded;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          const light = Math.min(r, g, b),
            spread = Math.max(r, g, b) - light;
          const red = r > g * 1.12 && r > b * 1.12;
          if (!red && light > 180 && spread < 55) {
            const alpha =
              light >= 235 ? 0 : Math.round(((235 - light) / 55) * data[i + 3]);
            data[i + 3] = alpha;
            removed ||= alpha < 255;
          }
        }
        output = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toBuffer();
      } else if (meta.format === "jpeg")
        output = await image.rotate().toColourspace("srgb").jpeg().toBuffer();
      if (output.length > 2 * 1024 * 1024)
        throw new BadRequestException(
          "처리 결과가 큽니다. 작은 이미지로 다시 업로드하세요.",
        );
      const dimensions = await sharp(output, {
        limitInputPixels: 10000000,
      }).metadata();
      return {
        pixelWidth: dimensions.width,
        pixelHeight: dimensions.height,
        companyId: this.company.companyId,
        filename: file.originalname.slice(0, 200),
        dataUrl: `data:image/${processedSeal ? "png" : meta.format};base64,${output.toString("base64")}`,
        originalDataUrl: `data:image/${meta.format};base64,${file.buffer.toString("base64")}`,
        backgroundRemoved: removed,
      };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        "이미지를 읽을 수 없습니다. 정상 PNG/JPG를 다시 업로드하세요.",
      );
    }
  }
}
