import sharp from "sharp";
import path from "path";
import axios from "axios";
import FileRepo from "../../repositories/file.repository";
import logger from "../../utils/logger";
import { S3_CDN_URL } from "../../config";

export default class FileService {
  /**
   * Process an uploaded file and save its metadata
   */
  static async uploadFile(file: any, manualMetaData: any = {}) {
    try {
      const { filename, originalname, mimetype, size, path: localPath, location, key, bucket } = file;
      
      let buffer: Buffer;

      // 1. Get buffer for analysis
      if (location) {
        const response = await axios.get(location, { responseType: 'arraybuffer' });
        buffer = Buffer.from(response.data, 'binary');
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

      // 5. Construct URL (Use CDN if available)
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
