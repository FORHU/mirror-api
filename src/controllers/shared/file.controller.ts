import { Request, Response, NextFunction } from "express";
import FileService from "../../services/shared/file.service";
import logger from "../../utils/logger";
import { responseSuccess, responseError } from "../../helpers/response.helper";

export default class FileController {
  /**
   * Handles single file upload and returns metadata
   */
  static async upload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return responseError(res, 400, "No file uploaded");
      }

      const fileRecord = await FileService.uploadFile(req.file);

      logger.info(`File uploaded successfully: ${fileRecord.id}`);

      return responseSuccess(res, 201, fileRecord, "File uploaded and processed successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Handles multiple file uploads
   */
  static async uploadMany(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return responseError(res, 400, "No files uploaded");
      }

      const uploadPromises = files.map((file) => FileService.uploadFile(file));
      const results = await Promise.all(uploadPromises);

      return responseSuccess(res, 201, results, `${results.length} files processed successfully`);
    } catch (err) {
      next(err);
    }
  }
}
