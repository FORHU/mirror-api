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
      logger.info(
        `[FileController.upload] incoming req.file: ${JSON.stringify({
          present: !!req.file,
          originalname: req.file?.originalname,
          mimetype: req.file?.mimetype,
          size: req.file?.size,
          bucket: (req.file as { bucket?: string })?.bucket,
          key: (req.file as { key?: string })?.key,
          location: (req.file as { location?: string })?.location,
        })}`
      );

      if (!req.file) {
        logger.warn("[FileController.upload] no file on request — returning 400");
        return responseError(res, 400, "No file uploaded");
      }

      const fileRecord = await FileService.uploadFile(req.file);

      logger.info(
        `[FileController.upload] file uploaded successfully: ${JSON.stringify({
          id: fileRecord?.id,
          fileUrl: fileRecord?.fileUrl,
          mimeType: fileRecord?.mimeType,
        })}`
      );

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
