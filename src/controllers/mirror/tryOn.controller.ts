import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import FashnService from "../../platforms/fashnAi/fashn.service";
import GarmentService from "../../services/shared/garment.service";
import FileService from "../../services/shared/file.service";
import { emitToKiosk } from "../../utils/socket.util";
import logger from "../../utils/logger";

const validationError = (message: string) => ({ status: 400, message });

/**
 * The frontend composites the outfit onto a body canvas before calling
 * try-on, so we always treat the input as a full-body garment to FASHN.
 */
const COMPOSED_OUTFIT_CATEGORY = "one-pieces";

export default class TryOnController {
  /**
   * Starts a virtual try-on session.
   *
   * Expects the caller to provide a single `garmentImage` URL. For full
   * outfits, the frontend composes the garments on its canvas, screenshots
   * the result, uploads to S3 (via the presigned-URL endpoint), and passes
   * the resulting URL here.
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
      // 1. Trigger the FASHN.AI run
      const result = await FashnService.runTryOn(
        value.modelImage,
        value.garmentImage,
        value.category
      );

      // 2. Respond to the client immediately with the prediction ID
      res.status(202).json({
        status: "success",
        data: { predictionId: result.id },
        message: "Try-on process started",
      });

      // 3. Start background polling for status updates
      this.pollStatus(result.id, value.kioskId);
      
    } catch (err) {
      next(err);
    }
  }

  /**
   * Starts a try-on using a stored Garment by ID.
   * Body: { garmentId, modelImage, kioskId? }
   * Category is always "one-pieces" — the frontend composites the outfit
   * onto a body canvas before this call, so FASHN swaps the full silhouette.
   * Optional kioskId — when provided, status updates are emitted via websocket.
   * REST polling is always available via `GET /try-on/:predictionId/status`.
   */
  static async runByGarment(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      garmentId: Joi.string().required(),
      modelImage: Joi.string().uri().required(),
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const garment = await GarmentService.getGarmentById(value.garmentId);
      const hydrated = await FileService.attachPresignedUrls(garment);
      const garmentImage = hydrated.imageUrl || hydrated.file?.fileUrl;
      if (!garmentImage) return next(validationError("Garment has no usable image URL"));

      const category = COMPOSED_OUTFIT_CATEGORY;
      const result = await FashnService.runTryOn(value.modelImage, garmentImage, category);

      res.status(202).json({
        status: "success",
        data: { predictionId: result.id, category },
        message: "Try-on process started",
      });

      if (value.kioskId) this.pollStatus(result.id, value.kioskId);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /try-on/:predictionId/status
   * REST alternative to the websocket flow.
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

  /**
   * Background polling logic to update the Kiosk via WebSockets
   */
  private static async pollStatus(predictionId: string, kioskId: string) {
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max (2s * 60)
    
    const interval = setInterval(async () => {
      attempts++;
      
      try {
        const statusData = await FashnService.getStatus(predictionId);
        logger.info(`FASHN.AI Status [${predictionId}]: ${statusData.status}`);

        if (statusData.status === "completed") {
          clearInterval(interval);
          emitToKiosk(kioskId, "tryon_completed", {
            predictionId,
            imageUrl: statusData.output?.[0],
          });
        } else if (statusData.status === "failed") {
          clearInterval(interval);
          emitToKiosk(kioskId, "tryon_failed", {
            predictionId,
            error: statusData.error || "Generation failed",
          });
        } else {
          // Notify kiosk of progress (starting, processing)
          emitToKiosk(kioskId, "tryon_progress", {
            predictionId,
            status: statusData.status,
          });
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          logger.warn(`Polling timed out for ${predictionId}`);
          emitToKiosk(kioskId, "tryon_failed", { error: "Generation timed out" });
        }

      } catch (err) {
        logger.error(`Polling error for ${predictionId}:`, err);
        clearInterval(interval);
      }
    }, 2000);
  }
}
