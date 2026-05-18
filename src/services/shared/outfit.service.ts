import OutfitRepo from "../../repositories/outfit.repository";
import GarmentRepo from "../../repositories/garment.repository";
import FileRepo from "../../repositories/file.repository";
import FileService from "./file.service";
import logger from "../../utils/logger";
import { s3Client } from "../../utils/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { findExistingComposition } from "../../validations/outfit.validation";
import {
  OutfitEvaluation,
  OutfitComposition,
  OutfitMatch,
  WardrobeGarment,
} from "../../utils/openai/evaluate-outfit.util";

export default class OutfitService {
  static async getUserOutfits(userId?: string, query: any = {}) {
    const { page, limit } = query;
    return OutfitRepo.findByUserId(
      userId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20
    );
  }

  static async getOutfitById(id: string, userId?: string) {
    const outfit = await OutfitRepo.findById(id);
    if (!outfit) throw { status: 404, message: "Outfit not found" };
    if (userId && outfit.userId !== userId) throw { status: 403, message: "Unauthorized" };
    return outfit;
  }

  static async createOutfit(userId?: string, data: any = {}) {
    // Idempotent: if this user already has an outfit with the same garment set,
    // return it instead of creating a duplicate (and avoid wasting a File row).
    const existing = await findExistingComposition(userId, data.items);
    if (existing) return existing;

    let fileId = data.fileId;

    // Fallback: when the client doesn't upload its own display image, mint a NEW
    // File row pointing at the first usable garment's URL. We can't reuse the
    // garment's existing File row directly — `Outfit.fileId` is @unique, so each
    // Outfit must own a distinct File.id. This creates a separate DB row that
    // references the same underlying URL, satisfying the unique constraint.
    if (!fileId && data.items && data.items.length > 0) {
      for (const item of data.items) {
        const garment = await GarmentRepo.findById(item.garmentId);
        const sourceUrl = garment?.imageUrl || garment?.file?.fileUrl;
        if (sourceUrl) {
          const newFile = await FileRepo.create({
            filename: `outfit-display-${Date.now()}`,
            fileUrl: sourceUrl,
            provider: "EXTERNAL",
          });
          fileId = newFile.id;
          break;
        }
      }
    }

    if (!fileId) {
      throw { status: 400, message: "Outfit requires a display image (upload a file, pass fileId, or include at least one garment with an image)" };
    }

    return OutfitRepo.create({
      userId,
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      designType: data.designType,
      fileId: fileId,
      items: data.items || [],
      metaData: data.metaData,
    });
  }

  static async updateOutfit(id: string, userId?: string, data: any = {}) {
    await this.getOutfitById(id, userId); // Ensure it exists and belongs to user

    return OutfitRepo.update(id, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      designType: data.designType,
      fileId: data.fileId,
      items: data.items,
    });
  }

  static async deleteOutfit(id: string, userId?: string) {
    await this.getOutfitById(id, userId); // Ensure it exists and belongs to user
    await OutfitRepo.delete(id);
    return { message: "Outfit deleted successfully" };
  }

  /**
   * Upload step shared by `evaluate` and `evaluateHybrid`. Mirrors
   * `GarmentService.uploadGarmentFile` — fast, no AI work — so the controller
   * can 202 the client before the model call. The returned `imageUrl` is
   * the CDN-fronted public URL that OpenAI can fetch directly.
   */
  static async uploadOutfitFile(
    file: any,
    fallbackImageUrl?: string,
  ): Promise<{ file: any | null; imageUrl: string }> {
    let fileRecord: any = null;
    let urlForAI = fallbackImageUrl;

    if (file) {
      fileRecord = await FileService.uploadFile(file);
      urlForAI = fileRecord?.fileUrl;
    }

    if (!urlForAI) {
      throw { status: 400, message: "Either an uploaded file or an imageUrl is required" };
    }

    return { file: fileRecord, imageUrl: urlForAI };
  }

  /**
   * Best-effort cleanup for an orphaned File created during an AI flow
   * that failed before persisting an Outfit. Deletes the S3 object and
   * the File row; swallows + logs errors so the original failure surfaces.
   */
  static async discardOrphanedFile(fileRecord: any) {
    if (!fileRecord?.id) return;
    try {
      if (fileRecord.provider === "S3" && fileRecord.path && fileRecord.bucket) {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: fileRecord.bucket, Key: fileRecord.path }),
        );
      }
      await FileRepo.softDelete(fileRecord.id);
    } catch (err: any) {
      // Intentional: don't mask the original error path.
      // Caller has already logged the real failure.
      logger.error(`[OutfitService.discardOrphanedFile] fileId=${fileRecord.id} cleanup failed: ${err.message}`);
    }
  }

  /**
   * Compact-shape garments for prompts. Used to ground `evaluate` and
   * `evaluateHybrid` in the actual items composing the outfit.
   */
  static async loadGarmentsForAI(ids: string[]): Promise<WardrobeGarment[]> {
    if (!ids.length) return [];
    const rows = await GarmentRepo.findByIds(ids);
    return rows.map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      garmentType: g.garmentType,
      fittingSlot: g.fittingSlot,
      category: g.category,
      gender: g.gender,
      layerLevel: g.layerLevel,
      silhouette: g.silhouette,
      tags: Array.isArray(g.tags) ? g.tags.map((t: any) => t.name) : [],
      dominantColor: g.metaData?.dominantColor,
    }));
  }

  /**
   * Returns the user's wardrobe in a token-frugal shape for the AI prompt.
   * Includes the user's own garments plus system garments (userId = null).
   */
  static async loadWardrobeForAI(userId: string, limit = 80): Promise<WardrobeGarment[]> {
    const { data } = await GarmentRepo.findAll(
      { OR: [{ userId }, { userId: null }] },
      1,
      limit,
    );
    return data.map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      garmentType: g.garmentType,
      fittingSlot: g.fittingSlot,
      category: g.category,
      gender: g.gender,
      layerLevel: g.layerLevel,
      silhouette: g.silhouette,
      tags: Array.isArray(g.tags) ? g.tags.map((t: any) => t.name) : [],
      dominantColor: g.metaData?.dominantColor,
    }));
  }

  /**
   * Persists an outfit assembled from an `OutfitEvaluation` (image-only flow).
   * Caller supplies the composition (`items`) — the AI did not pick garments.
   */
  static async persistEvaluatedOutfit(
    evaluation: OutfitEvaluation,
    fileRecord: any,
    userId: string,
    items: { garmentId: string }[],
  ) {
    return this.createOutfit(userId, {
      name: evaluation.name,
      description: evaluation.description,
      designType: evaluation.designType,
      fileId: fileRecord?.id,
      items,
      metaData: {
        tags: evaluation.tags,
        dominantColor: evaluation.dominantColor,
        generatedBy: "openai:gpt-4o:evaluate",
      },
    });
  }

  /**
   * Persists an outfit composed entirely by the AI from the wardrobe.
   * No image is uploaded — `createOutfit`'s garment-image fallback supplies
   * the display File.
   */
  static async persistComposedOutfit(
    composition: OutfitComposition,
    userId: string,
  ) {
    return this.createOutfit(userId, {
      name: composition.name,
      description: composition.description,
      designType: composition.designType,
      items: composition.items,
      metaData: {
        tags: composition.tags,
        generatedBy: "openai:gpt-4o:compose",
      },
    });
  }

  /**
   * Persists an outfit produced by the hybrid (image -> wardrobe match) flow.
   */
  static async persistMatchedOutfit(
    match: OutfitMatch,
    fileRecord: any,
    userId: string,
  ) {
    return this.createOutfit(userId, {
      name: match.name,
      description: match.description,
      designType: match.designType,
      fileId: fileRecord?.id,
      items: match.items,
      metaData: {
        tags: match.tags,
        dominantColor: match.dominantColor,
        unmatchedDescriptions: match.unmatchedDescriptions,
        generatedBy: "openai:gpt-4o:match",
      },
    });
  }
}
