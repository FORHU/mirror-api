import { prisma } from "../../utils/prisma";
import SkinAnalysisRepo from "../../repositories/skin-analysis.repository";
import FileRepo from "../../repositories/file.repository";
import OpenAIService from "../../platforms/openai/openai.service";
import {
  rankProducts,
  type AnalysisInput,
  type ProductForScoring,
  type WeatherContext,
} from "../../utils/cosmetics.util";
import logger from "../../utils/logger";

const fileNotFound = () => ({ status: 400, message: "Referenced file (fileId) does not exist" });
const notFound = () => ({ status: 404, message: "Skin analysis not found" });

type PaginationQuery = {
  page?: string | number;
  limit?: string | number;
};

/**
 * The only thing that writes SkinAnalysis + its CosmeticRecommendation
 * rows. Two-step flow:
 *   1. Frontend uploads the captured photo via /file-uploads
 *   2. Frontend POSTs { fileId, weatherSnapshotId? } here
 *
 * This service runs vision → rule engine → persist atomically.
 */
export default class SkinAnalysisService {
  static async create(
    input: { fileId: string; weatherSnapshotId?: string | null },
    userId: string
  ) {
    // 1. Validate referenced file
    const file = await FileRepo.findById(input.fileId);
    if (!file) throw fileNotFound();

    // 2. Optionally load weather context — we don't fail the request if the
    //    snapshot id is bogus, we just skip the weather signals.
    let weather: WeatherContext | undefined;
    if (input.weatherSnapshotId) {
      const snap = await prisma.weatherSnapshot.findUnique({
        where: { id: input.weatherSnapshotId },
      });
      if (snap) {
        weather = {
          oilRisk: snap.oilRisk,
          drynessRisk: snap.drynessRisk,
          uvRisk: snap.uvRisk,
          smudgeRisk: snap.smudgeRisk,
          sweatRisk: snap.sweatRisk,
          tags: snap.tags,
        };
      } else {
        logger.warn(
          `SkinAnalysis: weatherSnapshotId ${input.weatherSnapshotId} not found, skipping weather signals`
        );
      }
    }

    // 3. Vision analysis (the slow step)
    const vision = await OpenAIService.analyzeFaceImage(file.fileUrl);

    // 4. Load catalog and run rule engine
    const catalog = await prisma.cosmeticProduct.findMany({
      select: {
        id: true,
        type: true,
        tags: true,
        spf: true,
        waterproof: true,
        transferProof: true,
        hydrating: true,
        oilFree: true,
        finish: true,
      },
    });

    const engineInput: AnalysisInput = {
      skinType: vision.skinType,
      hydrationPct: vision.hydrationPct,
      oilinessPct: vision.oilinessPct,
      concerns: vision.concerns,
      weather,
    };

    const ranked = rankProducts(engineInput, catalog as ProductForScoring[]);

    // 5. Persist analysis + recommendations atomically
    const created = await SkinAnalysisRepo.createWithRecommendations(
      {
        fileId: file.id,
        skinType: vision.skinType,
        skinTone: vision.skinTone ?? null,
        hydrationPct: clampPct(vision.hydrationPct),
        oilinessPct: clampPct(vision.oilinessPct),
        concerns: vision.concerns,
        routineTip: vision.routineTip,
        weatherSnapshotId: weather ? input.weatherSnapshotId : null,
        rawSignals: { vision, weather: weather ?? null },
      },
      ranked.map((r) => ({
        cosmeticProductId: r.productId,
        score: r.score,
        rank: r.rank,
        reason: r.reason.join(", "),
        signals: r.signals,
      }))
    );

    // 6. Link this SkinAnalysis to the user's active/latest UserOutline
    let outline = await prisma.userOutline.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!outline) {
      outline = await prisma.userOutline.create({
        data: {
          userId,
          userPrompt: ["Kiosk Scan Session"],
          location: "Kiosk",
        },
      });
    }

    await prisma.userOutline.update({
      where: { id: outline.id },
      data: { skinAnalysisId: created.id },
    });

    return created;
  }

  static async getById(id: string, userId: string) {
    const analysis = await SkinAnalysisRepo.findById(id);
    if (!analysis) throw notFound();

    // Verify ownership by checking if this skin analysis is linked to any outline belonging to this user
    const ownsScan = await prisma.userOutline.findFirst({
      where: {
        skinAnalysisId: id,
        userId,
      },
    });
    if (!ownsScan) throw notFound();

    return analysis;
  }

  static async listForUser(userId: string, query: PaginationQuery = {}) {
    const { page, limit } = query;
    return SkinAnalysisRepo.findByUser(
      userId,
      page ? parseInt(String(page), 10) : 1,
      limit ? parseInt(String(limit), 10) : 20
    );
  }

  static async destroy(id: string, userId: string) {
    await this.getById(id, userId); // ownership check
    await SkinAnalysisRepo.delete(id);
    return { message: "Skin analysis deleted successfully" };
  }
}

function clampPct(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
