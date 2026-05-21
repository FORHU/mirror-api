import InteractionRepo from "../../repositories/interaction.repository";

export default class InteractionService {
  static async getOutfitInteractions(outfitId: string, query: Record<string, string | undefined>) {
    const { page, limit } = query;
    return InteractionRepo.findByOutfitId(
      outfitId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20
    );
  }

  static async logInteraction(data: { type: string; garmentId: string; outfitId?: string }) {
    return InteractionRepo.create({
      type: data.type,
      garmentId: data.garmentId,
      outfitId: data.outfitId,
    });
  }
}
