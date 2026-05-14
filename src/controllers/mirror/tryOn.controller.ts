import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import TryOnService from "../../services/mirror/tryOn.service";
import FashnService from "../../platforms/fashnAi/fashn.service";

const validationError = (message: string) => ({ status: 400, message });

export default class TryOnController {
  /**
   * Starts a virtual try-on session.
   * Legacy raw-URL endpoint.
   */
  static async run(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      modelImage: Joi.string().uri().required(),
      garmentImage: Joi.string().uri().required(),
      category: Joi.string().valid("tops", "bottoms", "one-pieces").required(),
      kioskId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const result = await FashnService.runTryOn(
        value.modelImage,
        value.garmentImage,
        value.category
      );

      res.status(202).json({
        status: "success",
        data: { predictionId: result.id },
        message: "Try-on process started",
      });

      TryOnService.pollStatus(result.id, value.kioskId);
      
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
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const result = await TryOnService.runByGarment(
        userId,
        value.garmentId,
        value.modelImage,
        value.kioskId
      );

      res.status(202).json({
        status: "success",
        data: result,
        message: "Try-on process started",
      });
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
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const result = await TryOnService.runByOutfit(
        userId,
        value.outfitId,
        value.modelImage,
        value.kioskId
      );

      res.status(202).json({
        status: "success",
        data: result,
        message: "Try-on process started",
      });
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
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const result = await TryOnService.runVideoByGarment(
        userId,
        value.garmentId,
        value.modelImage,
        value.kioskId
      );

      res.status(202).json({
        status: "success",
        data: result,
        message: "Video try-on process started",
      });
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
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const result = await TryOnService.runVideoByOutfit(
        userId,
        value.outfitId,
        value.modelImage,
        value.kioskId
      );

      res.status(202).json({
        status: "success",
        data: result,
        message: "Video try-on process started",
      });
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
      res.json({
        status: "success",
        data: {
          predictionId,
          predictionStatus: statusData.status,
          outputUrl: statusData.output?.[0] || null,
          error: statusData.error || null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
