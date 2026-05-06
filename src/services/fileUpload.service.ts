import logger from "../utils/logger";
import FileRepo from "../repositories/file.repository";

export default class FileUploadService {
  /**
   * Process an uploaded file and save to Prisma File table
   */
  static async upload(file: Express.Multer.File) {
    logger.info(`File uploaded to S3: ${(file as any).location}`);

    // Create a record in the File table
    const savedFile = await FileRepo.create({
      filename: file.originalname,
      fileUrl: (file as any).location,
      metaData: {
        size: file.size,
        mimetype: file.mimetype,
        s3Key: (file as any).key,
      },
    });

    return savedFile;
  }
}
