import { prisma } from "../utils/prisma";
import { Prisma, SKIN_TYPE } from "@prisma/client";

/**
 * Repo for SkinAnalysis. Caller (service) is responsible for verifying that
 * the analysis belongs to the requesting user — this repo does not enforce
 * ownership, matching the convention used by CosmeticRecommendationRepo.
 */

export type CreateSkinAnalysisInput = {
  userId: string;
  fileId: string;
  skinType: SKIN_TYPE;
  skinTone?: string | null;
  hydrationPct: number;
  oilinessPct: number;
  concerns: string[];
  routineTip: string;
  weatherSnapshotId?: string | null;
  rawSignals?: Prisma.InputJsonValue | null;
};

export type RecommendationSeed = {
  cosmeticProductId: string;
  score?: number;
  rank?: number;
  reason?: string;
  signals?: Prisma.InputJsonValue;
};

const includeFull = {
  file: true,
  weatherSnapshot: true,
  recommendations: {
    orderBy: [
      { rank: "asc" },
      { score: "desc" },
    ] as Prisma.CosmeticRecommendationOrderByWithRelationInput[],
    include: { cosmeticProduct: { include: { fileUrl: true } } },
  },
} satisfies Prisma.SkinAnalysisInclude;

export default class SkinAnalysisRepo {
  /**
   * Atomically creates a SkinAnalysis row and its recommendation set in a
   * single transaction. Returns the analysis with everything the UI needs.
   */
  static async createWithRecommendations(
    analysis: CreateSkinAnalysisInput,
    recommendations: RecommendationSeed[]
  ) {
    return prisma.$transaction(async (tx) => {
      const created = await tx.skinAnalysis.create({
        data: {
          user: { connect: { id: analysis.userId } },
          file: { connect: { id: analysis.fileId } },
          skinType: analysis.skinType,
          skinTone: analysis.skinTone ?? null,
          hydrationPct: analysis.hydrationPct,
          oilinessPct: analysis.oilinessPct,
          concerns: analysis.concerns,
          routineTip: analysis.routineTip,
          ...(analysis.weatherSnapshotId && {
            weatherSnapshot: { connect: { id: analysis.weatherSnapshotId } },
          }),
          rawSignals: analysis.rawSignals ?? Prisma.JsonNull,
        },
      });

      if (recommendations.length) {
        await tx.cosmeticRecommendation.createMany({
          data: recommendations.map((r) => ({
            skinAnalysisId: created.id,
            cosmeticProductId: r.cosmeticProductId,
            score: r.score,
            rank: r.rank,
            reason: r.reason,
            signals: r.signals ?? Prisma.JsonNull,
          })),
        });
      }

      return tx.skinAnalysis.findUniqueOrThrow({
        where: { id: created.id },
        include: includeFull,
      });
    });
  }

  static async findById(id: string) {
    return prisma.skinAnalysis.findUnique({
      where: { id },
      include: includeFull,
    });
  }

  static async findByUser(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.SkinAnalysisWhereInput = { userId };

    const [data, total] = await Promise.all([
      prisma.skinAnalysis.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: includeFull,
      }),
      prisma.skinAnalysis.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  static async delete(id: string) {
    return prisma.skinAnalysis.delete({ where: { id } });
  }
}
