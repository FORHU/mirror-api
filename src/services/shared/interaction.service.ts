import InteractionRepo from "../../repositories/interaction.repository";

import { parsePagination } from "../../helpers/pagination.helper";

export default class InteractionService {
  static async getOutfitInteractions(outfitId: string, query: Record<string, string | undefined>) {
    const { page, limit } = parsePagination(query);
    return InteractionRepo.findByOutfitId(outfitId, page, limit);
  }

  static async logInteraction(data: { type: string; garmentId: string; outfitId?: string }) {
    return InteractionRepo.create({
      type: data.type,
      garmentId: data.garmentId,
      outfitId: data.outfitId,
    });
  }
}
