import sharp from "sharp";
import path from "path";
import axios from "axios";
import FileRepo from "../../repositories/file.repository";
import logger from "../../utils/logger";
import { S3_CDN_URL, S3_BUCKET_NAME } from "../../config";
import { s3Client } from "../../utils/s3";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

export default class FileService {
  /**
   * Process an uploaded file and save its metadata
   */
  static async uploadFile(
    file: {
      originalname?: string;
      mimetype?: string;
      size?: number;
      location?: string;
      key?: string;
      bucket?: string;
    },
    manualMetaData: Record<string, unknown> = {}
  ) {
    try {
      const { originalname, mimetype, size, location, key, bucket } = file;

      if (!bucket || !key) {
        throw new Error("uploadFile expects a multer-s3 file with bucket + key");
      }

      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const response = await s3Client.send(command);
      const byteArray = await response.Body?.transformToByteArray();
      if (!byteArray) throw new Error("S3 object has no body");
      const buffer = Buffer.from(byteArray);

      const image = sharp(buffer);
      const metadata = await image.metadata();
      const stats = await image.stats();

      const autoDominantColor = this.rgbToHex(
        Math.round(stats.channels[0].mean),
        Math.round(stats.channels[1].mean),
        Math.round(stats.channels[2].mean)
      );

      const finalMetaData = {
        width: manualMetaData.width || metadata.width,
        height: manualMetaData.height || metadata.height,
        dominantColor: manualMetaData.dominantColor || autoDominantColor,
        isAlpha: manualMetaData.isAlpha !== undefined ? manualMetaData.isAlpha : metadata.hasAlpha,
        format: manualMetaData.format || metadata.format,
        ...manualMetaData,
      };

      const s3DirectUrl = location || `https://${bucket}.s3.amazonaws.com/${key}`;
      const finalUrl = S3_CDN_URL ? `${S3_CDN_URL}/${key}` : s3DirectUrl;

      const fileRecord = await FileRepo.create({
        filename: key,
        originalName: originalname,
        fileUrl: finalUrl,
        mimeType: mimetype,
        extension: path.extname(originalname || key).replace(".", ""),
        size,
        provider: "S3",
        bucket,
        path: key,
        metaData: finalMetaData,
      });

      return fileRecord;
    } catch (error) {
      logger.error("Error processing file upload:", error);
      throw error;
    }
  }

  /**
   * Downloads a remote image URL, persists it to S3, and creates a File row.
   * Used to capture transient third-party output (e.g. FASHN.AI try-on results)
   * before the source URL expires.
   */
  static async uploadFromUrl(
    sourceUrl: string,
    opts: { keyPrefix?: string; originalName?: string } = {}
  ) {
    const response = await axios.get<ArrayBuffer>(sourceUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    const rawContentType = response.headers["content-type"];
    const mimeType = typeof rawContentType === "string" ? rawContentType : "image/png";
    const extension = mimeType.split("/")[1]?.split(";")[0] || "png";

    const image = sharp(buffer);
    const metadata = await image.metadata();
    const stats = await image.stats();
    const autoDominantColor = this.rgbToHex(
      Math.round(stats.channels[0].mean),
      Math.round(stats.channels[1].mean),
      Math.round(stats.channels[2].mean)
    );

    const key = `${opts.keyPrefix || "uploads"}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    const finalUrl = S3_CDN_URL ? `${S3_CDN_URL}/${key}` : `s3://${S3_BUCKET_NAME}/${key}`;

    return FileRepo.create({
      filename: key.split("/").pop() || key,
      originalName: opts.originalName,
      fileUrl: finalUrl,
      mimeType,
      extension,
      size: buffer.byteLength,
      provider: "S3",
      bucket: S3_BUCKET_NAME,
      path: key,
      metaData: {
        width: metadata.width,
        height: metadata.height,
        dominantColor: autoDominantColor,
        isAlpha: metadata.hasAlpha,
        format: metadata.format,
        sourceUrl,
      },
    });
  }

  private static rgbToHex(r: number, g: number, b: number) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Hard-delete a File row IFF no Garment, Outfit, or User avatar still
   * references it. S3-backed files also have their underlying object
   * removed. Returns true on deletion, false when the file is still in
   * use or doesn't exist.
   *
   * Use this when something stops pointing at a File (e.g. a `fileId`
   * swap on PATCH, or an entity being deleted) and the row should be
   * garbage-collected without risking a file shared with another consumer.
   */
  static async discardIfUnreferenced(fileId: string): Promise<boolean> {
    const file = await FileRepo.findByIdWithRelations(fileId);
    if (!file) return false;
    if (file.garment || file.outfitDisplay || file.userAvatar) return false;

    try {
      if (file.provider === "S3" && file.path && file.bucket) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.path }));
      }
      await FileRepo.softDelete(file.id);
      return true;
    } catch (err) {
      logger.warn(
        `[FileService.discardIfUnreferenced] cleanup failed (fileId=${file.id}): ${(err as Error).message}`
      );
      return false;
    }
  }
}
