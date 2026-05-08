import InteractionRepo from "../../repositories/interaction.repository";

export default class InteractionService {
  static async getOutfitInteractions(outfitId: string, query: any) {
    const { page, limit } = query;
    return InteractionRepo.findByOutfitId(
      outfitId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20
    );
  }

  static async logInteraction(data: any) {
    return InteractionRepo.create({
      type: data.type,
      garmentId: data.garmentId,
      outfitId: data.outfitId,
    });
  }
}
