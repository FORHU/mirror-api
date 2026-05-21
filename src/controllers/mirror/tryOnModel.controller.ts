import { Request, Response, NextFunction } from "express";
import TryOnModelService from "../../services/mirror/tryOnModel.service";
import { responseSuccess } from "../../helpers/response.helper";
import logger from "../../utils/logger";

const validationError = (message: string) => ({ status: 400, message });

export default class TryOnModelController {
  /**
   * POST /try-on/model
   * Multipart upload of the model image. Saves the File row and attaches it
   * as the authenticated user's avatar.
   */
  static async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      if (!req.file) return next(validationError("file is required (multipart field 'file')"));

      const data = await TryOnModelService.uploadModel(userId, req.file);
      logger.info("------ Model has been captured and saved to S3 ------");
      responseSuccess(res, 201, data, "Model image saved");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /try-on/model
   * Returns the current model image with a fresh presigned GET URL.
   */
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const data = await TryOnModelService.getUserModel(userId);
      responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }
}
