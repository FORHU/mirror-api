import FashnService from "../../platforms/fashnAi/fashn.service";
import GarmentService from "../shared/garment.service";
import OutfitService from "../shared/outfit.service";
import FileService from "../shared/file.service";
import TryOnModelService from "./tryOnModel.service";
import { emitToKiosk } from "../../utils/socket.util";
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
  static async runByGarment(userId: string, garmentId: string, modelImage?: string, kioskId?: string) {
    const modelImageUrl = await this.resolveModelImage(userId, modelImage);
    const garment = await GarmentService.getGarmentById(garmentId);
    const hydrated = await FileService.attachPresignedUrls(garment);
    const garmentImageUrl = hydrated.imageUrl || hydrated.file?.fileUrl;

    if (!garmentImageUrl) throw new Error("Garment has no usable image URL");

    const result = await FashnService.runTryOn(modelImageUrl, garmentImageUrl, COMPOSED_OUTFIT_CATEGORY);

    if (kioskId) {
      this.pollStatus(result.id, kioskId);
    }

    return { predictionId: result.id, category: COMPOSED_OUTFIT_CATEGORY };
  }

  /**
   * Triggers a try-on for a specific outfit
   */
  static async runByOutfit(userId: string, outfitId: string, modelImage?: string, kioskId?: string) {
    const modelImageUrl = await this.resolveModelImage(userId, modelImage);
    const outfit = await OutfitService.getOutfitById(outfitId, userId);
    const hydrated = await FileService.attachPresignedUrls(outfit);
    const outfitImageUrl = hydrated.file?.fileUrl;

    if (!outfitImageUrl) throw new Error("Outfit has no display image");

    const result = await FashnService.runTryOn(modelImageUrl, outfitImageUrl, COMPOSED_OUTFIT_CATEGORY);

    if (kioskId) {
      this.pollStatus(result.id, kioskId);
    }

    return { predictionId: result.id, category: COMPOSED_OUTFIT_CATEGORY };
  }

  /**
   * Background polling logic to update the Kiosk via WebSockets
   */
  static async pollStatus(predictionId: string, kioskId: string) {
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
