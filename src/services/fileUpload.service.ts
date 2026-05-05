import logger from "../utils/logger";

export interface UploadedFileSummary {
  name: string;
  size: number;
  mimetype: string;
}

export default class FileUploadService {
  /**
   * Process an uploaded file and return its summary.
   * Currently does not persist; storage is in-memory via multer.
   */
  static async upload(file: Express.Multer.File): Promise<UploadedFileSummary> {
    logger.info(`File uploaded: ${file.originalname} (${file.size} bytes)`);
    return {
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }
}
