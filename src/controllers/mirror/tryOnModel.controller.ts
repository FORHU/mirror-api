import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import TryOnModelService from "../../services/mirror/tryOnModel.service";

const validationError = (message: string) => ({ status: 400, message });

export default class TryOnModelController {
  /**
   * POST /try-on/model/presign
   * Returns a presigned PUT URL so the client can upload directly to S3.
   */
  static async presign(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      filename: Joi.string().required(),
      mimetype: Joi.string().valid("image/jpeg", "image/png", "image/webp").required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const data = await TryOnModelService.presignModelUpload(userId, value.filename, value.mimetype);
      res.json({ status: "success", data, message: "Upload URL generated" });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /try-on/model/confirm
   * Called after the client successfully PUT the file to S3.
   * Persists the File record and sets it as the user's model image.
   */
  static async confirm(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      key: Joi.string().required(),
      filename: Joi.string().required(),
      size: Joi.number().integer().min(1).required(),
      mimetype: Joi.string().valid("image/jpeg", "image/png", "image/webp").required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const data = await TryOnModelService.confirmModelUpload(userId, value);
      res.status(201).json({ status: "success", data, message: "Model image saved" });
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
      const userId = (req as any).user.id;
      const data = await TryOnModelService.getUserModel(userId);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }
}
