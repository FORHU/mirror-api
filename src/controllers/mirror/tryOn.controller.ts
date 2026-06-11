import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import TryOnService from "../../services/mirror/tryOn.service";
import FashnService from "../../platforms/fashnAi/fashn.service";
import { responseSuccess } from "../../helpers/response.helper";

const validationError = (message: string) => ({ status: 400, message });

export default class TryOnController {
  /**
   * Starts a virtual try-on session.
   * Legacy raw-URL endpoint.
   */
  static async run(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      modelImage: Joi.string().uri().required(),
      outfitImage: Joi.string().uri().required(),
      category: Joi.string().valid("tops", "bottoms", "one-pieces").required(),
      prompt: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const result = await FashnService.runTryOn(
        value.modelImage,
        value.outfitImage,
        value.category,
        value.prompt
      );

      responseSuccess(res, 202, { predictionId: result.id }, "Try-on process started");

      TryOnService.pollStatus(result.id, userId);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Starts a virtual try-on session by uploading a new outfit image to S3 first.
   * Accepts multipart/form-data with a `file` containing the outfit image.
   */
  static async uploadAndRun(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      modelImage: Joi.string().uri().required(),
      category: Joi.string().valid("tops", "bottoms", "one-pieces").required(),
      prompt: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    if (!req.file) {
      return next(validationError("Outfit image file is required"));
    }

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      // multer-s3 automatically uploads the file and attaches the S3 URL to req.file.location
      const outfitImage = (req.file as Express.Multer.File & { location: string }).location;

      const result = await FashnService.runTryOn(
        value.modelImage,
        outfitImage,
        value.category,
        value.prompt
      );

      responseSuccess(res, 202, { predictionId: result.id, outfitImage }, "Try-on process started");

      TryOnService.pollStatus(result.id, userId);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Starts a try-on using a stored Garment by ID.
   */
  static async runByGarment(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      garmentId: Joi.string().required(),
      modelImage: Joi.string().uri().optional(),
      prompt: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const result = await TryOnService.runByGarment(
        userId,
        value.garmentId,
        value.modelImage,
        value.prompt
      );

      responseSuccess(res, 202, result, "Try-on process started");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Starts a try-on using a stored Outfit by ID.
   */
  static async runByOutfit(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      outfitId: Joi.string().required(),
      modelImage: Joi.string().uri().optional(),
      prompt: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const result = await TryOnService.runByOutfit(
        userId,
        value.outfitId,
        value.modelImage,
        value.prompt
      );

      responseSuccess(res, 202, result, "Try-on process started");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Video variant: try-on using a stored Garment by ID.
   * FASHN model id comes from FASHN_VIDEO_MODEL env var.
   */
  static async runVideoByGarment(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      garmentId: Joi.string().required(),
      modelImage: Joi.string().uri().optional(),
      prompt: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const result = await TryOnService.runVideoByGarment(
        userId,
        value.garmentId,
        value.modelImage,
        value.prompt
      );

      responseSuccess(res, 202, result, "Video try-on process started");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Video variant: try-on using a stored Outfit by ID.
   */
  static async runVideoByOutfit(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      outfitId: Joi.string().required(),
      modelImage: Joi.string().uri().optional(),
      prompt: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const result = await TryOnService.runVideoByOutfit(
        userId,
        value.outfitId,
        value.modelImage,
        value.prompt
      );

      responseSuccess(res, 202, result, "Video try-on process started");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /try-on/:predictionId/status
   */
  static async status(req: Request, res: Response, next: NextFunction) {
    try {
      const { predictionId } = req.params;
      if (!predictionId) return next(validationError("predictionId is required"));

      const statusData = await FashnService.getStatus(predictionId);
      responseSuccess(res, 200, {
        predictionId,
        predictionStatus: statusData.status,
        outputUrl: statusData.output?.[0] || null,
        error: statusData.error || null,
      });
    } catch (err) {
      next(err);
    }
  }
}
