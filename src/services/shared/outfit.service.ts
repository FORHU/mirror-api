import OutfitRepo from "../../repositories/outfit.repository";
import GarmentRepo from "../../repositories/garment.repository";
import FileRepo from "../../repositories/file.repository";
import { findExistingComposition } from "../../validations/outfit.validation";

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
}
