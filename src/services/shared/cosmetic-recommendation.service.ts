import CosmeticRecommendationRepo from "../../repositories/cosmetic-recommendation.repository";
import CosmeticProductRepo from "../../repositories/cosmetic-product.repository";
import OutlineRepo from "../../repositories/outline.repository";
import { Prisma } from "@prisma/client";

const notFound = () => ({ status: 404, message: "Cosmetic recommendation not found" });
const productNotFound = () => ({ status: 404, message: "Cosmetic product not found" });

/**
 * Verifies the outline exists and belongs to `userId`. Throws 404 on either
 * miss so callers can't probe for outline existence by id.
 */
async function assertOutlineOwned(outlineId: string, userId: string) {
  const outline = await OutlineRepo.findById(outlineId);
  if (!outline || outline.userId !== userId) {
    throw { status: 404, message: "Outline not found" };
  }
  return outline;
}

import { parsePagination } from "../../helpers/pagination.helper";

export default class CosmeticRecommendationService {
  /**
   * Lists recommendations for the caller's outline. Refuses to serve
   * recommendations for outlines that don't belong to the user.
   */
  static async listForOutline(
    outlineId: string,
    userId: string,
    query: Record<string, string | undefined> = {}
  ) {
    await assertOutlineOwned(outlineId, userId);
    const { page, limit } = parsePagination(query);
    return CosmeticRecommendationRepo.findByOutline(outlineId, page, limit);
  }

  static async getById(id: string, userId: string) {
    const rec = await CosmeticRecommendationRepo.findById(id);
    if (!rec) throw notFound();
    if (rec.userOutline?.userId !== userId) throw notFound();
    return rec;
  }

  static async create(
    data: {
      userOutlineId: string;
      cosmeticProductId: string;
      score?: number;
      rank?: number;
      reason?: string;
      signals?: Prisma.InputJsonValue;
    },
    userId: string
  ) {
    await assertOutlineOwned(data.userOutlineId, userId);
    const product = await CosmeticProductRepo.findById(data.cosmeticProductId);
    if (!product) throw productNotFound();
    return CosmeticRecommendationRepo.create(data);
  }

  static async update(
    id: string,
    data: {
      cosmeticProductId?: string;
      score?: number;
      rank?: number;
      reason?: string;
      signals?: Prisma.InputJsonValue;
    },
    userId: string
  ) {
    await this.getById(id, userId); // ownership check
    if (data.cosmeticProductId) {
      const product = await CosmeticProductRepo.findById(data.cosmeticProductId);
      if (!product) throw productNotFound();
    }
    return CosmeticRecommendationRepo.update(id, data);
  }

  static async destroy(id: string, userId: string) {
    await this.getById(id, userId); // ownership check
    await CosmeticRecommendationRepo.delete(id);
    return { message: "Cosmetic recommendation deleted successfully" };
  }
}
