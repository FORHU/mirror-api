import { prisma } from "./prisma";
import logger from "./logger";

/**
 * Persists the cosmetics ChatWonder recommends into the active UserOutline so
 * the /overview dashboard can hydrate them later (and so the recommendations are
 * "connected" to the outline as a refreshable master list).
 *
 * Flow (per ADR: cosmetics hang off the outline as the master list):
 *   ChatWonder → COSMETICS_DATA block → here → `outline.cosmeticRecommendations`
 *
 * Called on every ChatWonder completion that carries a COSMETICS_DATA payload, so
 * the master list is wiped and rewritten each turn (always reflects the latest
 * recommendation). Skin-analysis recommendations (linked via `skinAnalysisId`,
 * not `userOutlineId`) are intentionally left untouched.
 */

interface ParsedCosmeticRec {
  id: string;
  rank?: number | null;
  score?: number | null;
  reason?: string | null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Flattens the COSMETICS_DATA block into a flat list of {id, rank, score, reason}.
 * Accepts the three shapes ChatWonder emits: a bare array, `{ recommendations: [] }`,
 * or `{ sets: [{ recommendations: [] }] }` (the canonical `[cosmetics]` persona shape).
 */
function extractCosmeticRecs(raw: unknown): ParsedCosmeticRec[] {
  const out: ParsedCosmeticRec[] = [];

  const pushRec = (rawRec: unknown) => {
    if (!rawRec || typeof rawRec !== "object") return;
    const rec = rawRec as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) return;
    out.push({
      id,
      rank: num(rec.rank),
      score: num(rec.score),
      reason: typeof rec.reason === "string" ? rec.reason : null,
    });
  };

  if (Array.isArray(raw)) {
    raw.forEach(pushRec);
    return out;
  }
  if (raw && typeof raw === "object") {
    const data = raw as Record<string, unknown>;
    if (Array.isArray(data.recommendations)) {
      data.recommendations.forEach(pushRec);
    }
    if (Array.isArray(data.sets)) {
      for (const rawSet of data.sets) {
        const set = rawSet as Record<string, unknown> | null;
        if (set && Array.isArray(set.recommendations)) set.recommendations.forEach(pushRec);
      }
    }
  }
  return out;
}

export async function persistOutlineCosmetics(
  conversationId: string,
  cosmeticsData: unknown
): Promise<void> {
  try {
    const recs = extractCosmeticRecs(cosmeticsData);
    if (!recs.length) return;

    // The outline tied to this chat session is where the master list lives.
    const outline = await prisma.userOutline.findUnique({
      where: { conversationId },
      select: { id: true },
    });
    if (!outline) {
      logger.warn(`[persistOutlineCosmetics] No outline for conversation ${conversationId}`);
      return;
    }

    // ChatWonder is given the real catalog ids, but it's still an LLM — drop any
    // hallucinated/unknown ids so createMany doesn't hit a FK violation.
    const ids = [...new Set(recs.map((r) => r.id))];
    const existing = await prisma.cosmeticProduct.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const validIds = new Set(existing.map((p) => p.id));

    // Dedup by product id (first occurrence wins — preserves ChatWonder's order).
    const seen = new Set<string>();
    const valid = recs.filter((r) => {
      if (!validIds.has(r.id) || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    if (!valid.length) {
      logger.warn(
        `[persistOutlineCosmetics] None of ${ids.length} recommended ids exist in catalog (outline ${outline.id})`
      );
      return;
    }

    // Refresh the master list: wipe the outline's previous cosmetics, write fresh.
    await prisma.$transaction([
      prisma.cosmeticRecommendation.deleteMany({ where: { userOutlineId: outline.id } }),
      prisma.cosmeticRecommendation.createMany({
        data: valid.map((r, i) => ({
          userOutlineId: outline.id,
          cosmeticProductId: r.id,
          rank: r.rank ?? i + 1,
          score: r.score ?? null,
          reason: r.reason ?? null,
          signals: {},
        })),
      }),
    ]);

    logger.info(
      `[persistOutlineCosmetics] Persisted ${valid.length} cosmetics to outline ${outline.id}`
    );
  } catch (error) {
    logger.error(`[persistOutlineCosmetics] ${(error as Error).message}`);
  }
}
