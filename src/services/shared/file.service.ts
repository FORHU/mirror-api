import sharp from "sharp";
import path from "path";
import axios from "axios";
import FileRepo from "../../repositories/file.repository";
import logger from "../../utils/logger";
import { S3_CDN_URL, S3_BUCKET_NAME } from "../../config";
import { s3Client } from "../../utils/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export default class FileService {
  /**
   * Generates a presigned URL for an S3 object
   */
  static async getPresignedUrl(key: string, bucket: string = S3_BUCKET_NAME) {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      
      // Default to 1 hour (3600 seconds)
      return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    } catch (error) {
      logger.error("Error generating presigned URL:", error);
      return null;
    }
  }

  /**
   * Recursively traverses an object and replaces S3 file URLs with presigned ones.
   * This ensures that any "imageUrl" or "fileUrl" coming from S3 is valid and temporary.
   */
  static async attachPresignedUrls(data: any): Promise<any> {
    if (!data) return data;

    if (Array.isArray(data)) {
      return Promise.all(data.map((item) => this.attachPresignedUrls(item)));
    }

    if (typeof data === "object") {
      const result = { ...data };

      // Case 1: This is a File object from our database
      if (result.provider === "S3" && result.path) {
        const signedUrl = await this.getPresignedUrl(result.path, result.bucket || undefined);
        if (signedUrl) {
          result.fileUrl = signedUrl;
        }
      }

      // Case 2: Recursively process all properties (handles nested files/items)
      for (const key in result) {
        if (result[key] && typeof result[key] === "object") {
          result[key] = await this.attachPresignedUrls(result[key]);
        }
      }

      // Case 3: Convenience fix for Garments/Outfits that have an "imageUrl" 
      // but also include their "file" relation. Use the signed fileUrl.
      if (result.file && result.file.fileUrl) {
        result.imageUrl = result.file.fileUrl;
      }

      return result;
    }

    return data;
  }

  /**
   * Process an uploaded file and save its metadata
   */
  static async uploadFile(file: any, manualMetaData: any = {}) {
    try {
      const { filename, originalname, mimetype, size, path: localPath, location, key, bucket } = file;
      
      let buffer: Buffer;

      // 1. Get buffer for analysis
      if (location) {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });
        const response = await s3Client.send(command);
        const byteArray = await response.Body?.transformToByteArray();
        buffer = Buffer.from(byteArray!);
      } else {
        const fs = require("fs/promises");
        buffer = await fs.readFile(localPath);
      }

      // 2. Analyze image with Sharp
      const image = sharp(buffer);
      const metadata = await image.metadata();
      const stats = await image.stats();
      
      const autoDominantColor = this.rgbToHex(
        Math.round(stats.channels[0].mean),
        Math.round(stats.channels[1].mean),
        Math.round(stats.channels[2].mean)
      );

      // 3. Merge Manual Metadata with Auto-Detected (Manual wins)
      const finalMetaData = {
        width: manualMetaData.width || metadata.width,
        height: manualMetaData.height || metadata.height,
        dominantColor: manualMetaData.dominantColor || autoDominantColor,
        isAlpha: manualMetaData.isAlpha !== undefined ? manualMetaData.isAlpha : metadata.hasAlpha,
        format: manualMetaData.format || metadata.format,
        ...manualMetaData // Include any other custom fields
      };

      // 5. Construct URL (Use CDN if available, otherwise location)
      // Note: If we use presigned URLs, this "static" URL might just be a fallback or internal ref
      const finalUrl = location 
        ? (S3_CDN_URL ? `${S3_CDN_URL}/${key}` : location)
        : `/uploads/${filename}`;

      // 6. Create record in DB
      const fileRecord = await FileRepo.create({
        filename: filename || key,
        originalName: originalname,
        fileUrl: finalUrl,
        mimeType: mimetype,
        extension: path.extname(originalname || filename || key).replace(".", ""),
        size,
        provider: location ? "S3" : "LOCAL",
        bucket: bucket,
        path: key || localPath,
        metaData: finalMetaData,
      });

      return fileRecord;
    } catch (error) {
      logger.error("Error processing file upload:", error);
      throw error;
    }
  }

  private static rgbToHex(r: number, g: number, b: number) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
}
