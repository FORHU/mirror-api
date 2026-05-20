import { prisma } from "../utils/prisma";
import { Prisma } from "@prisma/client";

export default class CosmeticRecommendationRepo {
  /**
   * Lists recommendations for a single outline. Caller is responsible for
   * verifying the outline belongs to the requesting user — this repo does
   * not enforce ownership.
   */
  static async findByOutline(
    outlineId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.CosmeticRecommendationWhereInput = { userOutlineId: outlineId };

    const [data, total] = await Promise.all([
      prisma.cosmeticRecommendation.findMany({
        where,
        skip,
        take: limit,
        include: { cosmeticProduct: true },
        orderBy: [{ rank: "asc" }, { score: "desc" }, { createdAt: "desc" }],
      }),
      prisma.cosmeticRecommendation.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  static async findById(id: string) {
    return prisma.cosmeticRecommendation.findUnique({
      where: { id },
      include: {
        cosmeticProduct: true,
        userOutline: { select: { id: true, userId: true } },
      },
    });
  }

  static async create(data: {
    userOutlineId: string;
    cosmeticProductId: string;
    score?: number;
    rank?: number;
    reason?: string;
    signals?: any;
  }) {
    return prisma.cosmeticRecommendation.create({
      data: {
        userOutline:     { connect: { id: data.userOutlineId } },
        cosmeticProduct: { connect: { id: data.cosmeticProductId } },
        score:   data.score,
        rank:    data.rank,
        reason:  data.reason,
        signals: data.signals,
      },
      include: { cosmeticProduct: true },
    });
  }

  static async update(
    id: string,
    data: {
      cosmeticProductId?: string;
      score?: number;
      rank?: number;
      reason?: string;
      signals?: any;
    },
  ) {
    return prisma.cosmeticRecommendation.update({
      where: { id },
      data: {
        ...(data.cosmeticProductId && {
          cosmeticProduct: { connect: { id: data.cosmeticProductId } },
        }),
        score:   data.score,
        rank:    data.rank,
        reason:  data.reason,
        signals: data.signals,
      },
      include: { cosmeticProduct: true },
    });
  }

  static async delete(id: string) {
    return prisma.cosmeticRecommendation.delete({ where: { id } });
  }
}
