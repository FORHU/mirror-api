import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import FashnService from "../../platforms/fashnAi/fashn.service";
import { emitToKiosk } from "../../utils/socket.util";
import logger from "../../utils/logger";

const validationError = (message: string) => ({ status: 400, message });

export default class TryOnController {
  /**
   * Starts a virtual try-on session
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
