import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import FileUploadService from "../../services/shared/fileUpload.service";
import { responseSuccess } from "../../helpers/response.helper";

const validationError = (message: string) => ({ status: 400, message });

export default class FileUploadController {
  /**
   * Generates a presigned URL for direct S3 upload
   */
  static async presign(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      filename: Joi.string().required(),
      mimetype: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return next(validationError(error.message));

    try {
      const data = await FileUploadService.generatePresignedUrl(value.filename, value.mimetype);
      return responseSuccess(res, 200, data, "Presigned URL generated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Confirms upload and saves to database
   */
  static async confirm(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      filename: Joi.string().required(),
      fileUrl: Joi.string().uri().required(),
      key: Joi.string().required(),
      size: Joi.number().integer().required(),
      mimetype: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await FileUploadService.confirmUpload(
        value.filename,
        value.fileUrl,
        value.key,
        value.size,
        value.mimetype
      );
      return responseSuccess(res, 201, data, "File record saved successfully");
    } catch (err) {
      next(err);
    }
  }
}
