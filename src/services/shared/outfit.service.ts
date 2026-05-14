import OutfitRepo from "../../repositories/outfit.repository";
import GarmentRepo from "../../repositories/garment.repository";
import { assertNoDuplicateComposition } from "../../validations/outfit.validation";

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
    await assertNoDuplicateComposition(userId, data.items);

    let fileId = data.fileId;

    // Fallback: If no fileId is provided, pick the image from the first garment
    if (!fileId && data.items && data.items.length > 0) {
      const firstGarment = await GarmentRepo.findById(data.items[0].garmentId);
      if (firstGarment) {
        fileId = firstGarment.fileId;
      }
    }

    if (!fileId) throw { status: 400, message: "Outfit display file or at least one garment is required" };

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

    let fileId = data.fileId;

    // Fallback: If no fileId is provided and items are updated, pick from first garment
    if (!fileId && data.items && data.items.length > 0) {
      const firstGarment = await GarmentRepo.findById(data.items[0].garmentId);
      if (firstGarment) {
        fileId = firstGarment.fileId;
      }
    }

    return OutfitRepo.update(id, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      designType: data.designType,
      fileId: fileId,
      items: data.items,
    });
  }

  static async deleteOutfit(id: string, userId?: string) {
    await this.getOutfitById(id, userId); // Ensure it exists and belongs to user
    await OutfitRepo.delete(id);
    return { message: "Outfit deleted successfully" };
  }
}
