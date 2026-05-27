import FashnService from "../../platforms/fashnAi/fashn.service";
import GarmentService from "../shared/garment.service";
import OutfitService from "../shared/outfit.service";
import TryOnModelService from "./tryOnModel.service";
import { notifyCompanion } from "../../utils/socket.util";
import logger from "../../utils/logger";

const COMPOSED_OUTFIT_CATEGORY = "one-pieces";

export default class TryOnService {
  /**
   * Resolves the model image URL for a user
   */
  static async resolveModelImage(userId: string, fromBody?: string): Promise<string> {
    if (fromBody) return fromBody;
    const model = await TryOnModelService.getUserModel(userId);
    if (!model?.fileUrl) {
      throw new Error("No model image provided and no saved model on file.");
    }
    return model.fileUrl;
  }

  /**
   * Triggers a try-on for a specific garment
   */
  static async runByGarment(
    userId: string,
    garmentId: string,
    modelImage?: string,
    prompt?: string
  ) {
    const modelImageUrl = await this.resolveModelImage(userId, modelImage);
    const garment = await GarmentService.getGarmentById(garmentId);
    const garmentImageUrl = garment?.imageUrl || garment?.file?.fileUrl;

    if (!garmentImageUrl) throw new Error("Garment has no usable image URL");

    const result = await FashnService.runTryOn(
      modelImageUrl,
      garmentImageUrl,
      COMPOSED_OUTFIT_CATEGORY,
      prompt
    );

    this.pollStatus(result.id, userId);

    return { predictionId: result.id, category: COMPOSED_OUTFIT_CATEGORY };
  }

  /**
   * Triggers a try-on for a specific outfit
   */
  static async runByOutfit(
    userId: string,
    outfitId: string,
    modelImage?: string,
    prompt?: string
  ) {
    const modelImageUrl = await this.resolveModelImage(userId, modelImage);
    const outfit = await OutfitService.getOutfitById(outfitId, userId);
    const outfitImageUrl = outfit?.file?.fileUrl;

    if (!outfitImageUrl) throw new Error("Outfit has no display image");

    const result = await FashnService.runTryOn(
      modelImageUrl,
      outfitImageUrl,
      COMPOSED_OUTFIT_CATEGORY,
      prompt
    );

    this.pollStatus(result.id, userId);

    return { predictionId: result.id, category: COMPOSED_OUTFIT_CATEGORY };
  }

  /**
   * Video variant: try-on for a specific garment
   */
  static async runVideoByGarment(
    userId: string,
    garmentId: string,
    modelImage?: string,
    prompt?: string
  ) {
    const modelImageUrl = await this.resolveModelImage(userId, modelImage);
    const garment = await GarmentService.getGarmentById(garmentId);
    const garmentImageUrl = garment?.imageUrl || garment?.file?.fileUrl;

    if (!garmentImageUrl) throw new Error("Garment has no usable image URL");

    const result = await FashnService.runVideoTryOn(
      modelImageUrl,
      garmentImageUrl,
      COMPOSED_OUTFIT_CATEGORY,
      prompt
    );

    this.pollStatus(result.id, userId, { media: "video" });

    return { predictionId: result.id, category: COMPOSED_OUTFIT_CATEGORY, media: "video" as const };
  }

  /**
   * Video variant: try-on for a specific outfit
   */
  static async runVideoByOutfit(
    userId: string,
    outfitId: string,
    modelImage?: string,
    prompt?: string
  ) {
    const modelImageUrl = await this.resolveModelImage(userId, modelImage);
    const outfit = await OutfitService.getOutfitById(outfitId, userId);
    const outfitImageUrl = outfit?.file?.fileUrl;

    if (!outfitImageUrl) throw new Error("Outfit has no display image");

    const result = await FashnService.runVideoTryOn(
      modelImageUrl,
      outfitImageUrl,
      COMPOSED_OUTFIT_CATEGORY,
      prompt
    );

    this.pollStatus(result.id, userId, { media: "video" });

    return { predictionId: result.id, category: COMPOSED_OUTFIT_CATEGORY, media: "video" as const };
  }

  /**
   * Background polling logic to update the Kiosk via WebSockets.
   * Pass `{ media: "video" }` for video runs — bumps the timeout and switches
   * the completion payload field from `imageUrl` to `videoUrl`.
   */
  static async pollStatus(
    predictionId: string,
    userId: string,
    options: { media?: "image" | "video" } = {}
  ) {
    const isVideo = options.media === "video";
    let attempts = 0;
    // Video jobs take longer than image jobs.
    const maxAttempts = isVideo ? 150 : 60; // image: 2 min, video: 5 min (2s tick)

    const interval = setInterval(async () => {
      attempts++;

      try {
        const statusData = await FashnService.getStatus(predictionId);
        logger.info(`FASHN.AI Status [${predictionId}]: ${statusData.status}`);

        if (statusData.status === "completed") {
          clearInterval(interval);
          const fashnUrl = statusData.output?.[0];

          // Emit FASHN's URL directly. Persistence to our S3 is intentionally
          // deferred — see notes on the TODO follow-up to re-add a non-presigned
          // persistence path (CDN-backed or public-read bucket).
          notifyCompanion(userId, "tryon_completed", {
            predictionId,
            media: isVideo ? "video" : "image",
            ...(isVideo ? { videoUrl: fashnUrl } : { imageUrl: fashnUrl }),
          });
        } else if (statusData.status === "failed") {
          clearInterval(interval);
          logger.error(
            `FASHN.AI failed [${predictionId}] full response: ${JSON.stringify(statusData)}`
          );
          notifyCompanion(userId, "tryon_failed", {
            predictionId,
            media: isVideo ? "video" : "image",
            error: statusData.error || "Generation failed",
          });
        } else {
          notifyCompanion(userId, "tryon_progress", {
            predictionId,
            media: isVideo ? "video" : "image",
            status: statusData.status,
          });
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          logger.warn(`Polling timed out for ${predictionId}`);
          notifyCompanion(userId, "tryon_failed", {
            media: isVideo ? "video" : "image",
            error: "Generation timed out",
          });
        }
      } catch (err) {
        logger.error(`Polling error for ${predictionId}:`, (err as Error).message);
        clearInterval(interval);
      }
    }, 2000);
  }
}
