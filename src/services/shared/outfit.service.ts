import OutfitRepo from "../../repositories/outfit.repository";

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
    return OutfitRepo.create({
      userId,
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      designType: data.designType,
      fileId: data.fileId,
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
