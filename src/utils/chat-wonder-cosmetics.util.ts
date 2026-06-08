import { prisma } from "./prisma";
import logger from "./logger";
import CacheUtil from "./cache.util";
import { SKIN_TYPE } from "@prisma/client";
import {
  rankProducts,
  scoreProduct,
  type AnalysisInput,
  type ProductForScoring,
} from "./cosmetics.util";

const CATALOG_CACHE_KEY = "cosmetics:catalog_context";
const CATALOG_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

/**
 * Server-side cosmetics grounding.
 *
 * ChatWonder gets a compact candidate catalog from the real DB and should return
 * exact product IDs in COSMETICS_DATA. The server then resolves those IDs back to
 * CosmeticProduct rows before anything reaches the UI. If ChatWonder returns no
 * usable IDs, we fall back to the local ranking engine.
 *
 * Skin-analysis recommendations (linked via `skinAnalysisId`) are untouched.
 */

/** Live-render shape: satisfies both `adaptCosmeticsData` and the cosmetics page. */
export interface ResolvedCosmetic {
  id: string;
  rank: number;
  score: number;
  reason: string;
  // Flat fields consumed by overview's adaptCosmeticsData.
  name: string;
  brand?: string;
  imageUrl: string;
  // Nested shape consumed by /ai-recommendation-cosmetic (SkinRecommendation).
  cosmeticProduct: {
    id: string;
    name: string;
    brand: string | null;
    tags: string[];
    fileUrl: { fileUrl: string } | null;
  };
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function toSkinType(v: unknown): SKIN_TYPE {
  if (typeof v === "string") {
    const upper = v.toUpperCase();
    if ((Object.values(SKIN_TYPE) as string[]).includes(upper)) return upper as SKIN_TYPE;
  }
  return SKIN_TYPE.NORMAL;
}

/**
 * Builds the rule-engine input from (in priority order) the outline's linked
 * SkinAnalysis, the skin profile the client sent on this request, or NORMAL
 * defaults — so we always produce recommendations even without a scan.
 */
function buildProfile(
  linked: {
    skinType: SKIN_TYPE;
    hydrationPct: number;
    oilinessPct: number;
    concerns: string[];
  } | null,
  requestSkin: unknown
): AnalysisInput {
  if (linked) {
    return {
      skinType: linked.skinType,
      hydrationPct: linked.hydrationPct,
      oilinessPct: linked.oilinessPct,
      concerns: Array.isArray(linked.concerns) ? linked.concerns : [],
    };
  }

  const req =
    requestSkin && typeof requestSkin === "object"
      ? (requestSkin as Record<string, unknown>)
      : null;
  return {
    skinType: toSkinType(req?.skinType),
    hydrationPct: num(req?.hydrationPct, 50),
    oilinessPct: num(req?.oilinessPct, 50),
    concerns: Array.isArray(req?.concerns) ? (req?.concerns as unknown[]).map(String) : [],
  };
}

type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  details?: string | null;
  category?: string | null;
  type: ProductForScoring["type"];
  tags: string[];
  benefits?: string[];
  spf: number | null;
  waterproof: boolean;
  transferProof: boolean;
  hydrating: boolean;
  oilFree: boolean;
  finish: ProductForScoring["finish"];
  priceAmount?: unknown;
  priceUnit?: string | null;
  fileUrl: { fileUrl: string | null; thumbnailUrl?: string | null } | null;
};

type ParsedCosmeticRec = {
  id: string;
  rank?: number | null;
  score?: number | null;
  reason?: string | null;
};

const CANDIDATE_POOL_LIMIT = 250;
const DEFAULT_CONTEXT_LIMIT = 60;

function toScoringProduct(product: CatalogProduct): ProductForScoring {
  return {
    id: product.id,
    type: product.type,
    tags: product.tags,
    spf: product.spf,
    waterproof: product.waterproof,
    transferProof: product.transferProof,
    hydrating: product.hydrating,
    oilFree: product.oilFree,
    finish: product.finish,
  };
}

function imageUrl(product: CatalogProduct) {
  return product.fileUrl?.thumbnailUrl ?? product.fileUrl?.fileUrl ?? "";
}

function compact(value: unknown, max = 160) {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function extractRecs(raw: unknown): ParsedCosmeticRec[] {
  const out: ParsedCosmeticRec[] = [];
  const push = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    const id =
      typeof rec.id === "string"
        ? rec.id
        : typeof rec.productId === "string"
          ? rec.productId
          : typeof rec.cosmeticProductId === "string"
            ? rec.cosmeticProductId
            : "";
    if (!id) return;
    out.push({
      id,
      rank: num(rec.rank, NaN),
      score: num(rec.score, NaN),
      reason: typeof rec.reason === "string" ? rec.reason : null,
    });
  };

  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw && typeof raw === "object") {
    const data = raw as Record<string, unknown>;
    if (Array.isArray(data.recommendations)) data.recommendations.forEach(push);
    if (Array.isArray(data.products)) data.products.forEach(push);
    if (Array.isArray(data.items)) data.items.forEach(push);
    if (Array.isArray(data.sets)) {
      for (const setValue of data.sets) {
        const set = setValue as Record<string, unknown> | null;
        if (set && Array.isArray(set.recommendations)) set.recommendations.forEach(push);
      }
    }
  }

  return out;
}

async function loadCatalogForCosmetics() {
  const select = {
    id: true,
    name: true,
    brand: true,
    details: true,
    category: true,
    type: true,
    tags: true,
    benefits: true,
    spf: true,
    waterproof: true,
    transferProof: true,
    hydrating: true,
    oilFree: true,
    finish: true,
    priceAmount: true,
    priceUnit: true,
    fileUrl: { select: { fileUrl: true, thumbnailUrl: true } },
  };

  const withImages = await prisma.cosmeticProduct.findMany({
    where: { fileUrl: { is: { fileUrl: { not: "" } } } },
    take: CANDIDATE_POOL_LIMIT,
    orderBy: [{ fileUrlId: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select,
  });

  if (withImages.length) return withImages as CatalogProduct[];

  const fallback = await prisma.cosmeticProduct.findMany({
    take: CANDIDATE_POOL_LIMIT,
    orderBy: { createdAt: "desc" },
    select,
  });

  return fallback as CatalogProduct[];
}

async function persistOutlineCosmetics(outlineId: string, recs: ResolvedCosmetic[]) {
  await prisma.$transaction([
    prisma.cosmeticRecommendation.deleteMany({ where: { userOutlineId: outlineId } }),
    prisma.cosmeticRecommendation.createMany({
      data: recs.map((rec) => ({
        userOutlineId: outlineId,
        cosmeticProductId: rec.id,
        rank: rec.rank,
        score: rec.score,
        reason: rec.reason,
        signals: { source: "chatwonder_catalog" },
      })),
    }),
  ]);
}

export async function buildCatalogContext(
  requestSkinAnalysis?: unknown,
  limit = DEFAULT_CONTEXT_LIMIT
): Promise<string> {
  try {
    // Serve from Redis cache when available (skin-agnostic: catalog rarely changes)
    const cached = await CacheUtil.get(CATALOG_CACHE_KEY);
    if (cached) {
      logger.info("[buildCatalogContext] Serving catalog from Redis cache");
      return cached as string;
    }

    const catalog = await loadCatalogForCosmetics();
    if (!catalog.length) {
      logger.warn("[buildCatalogContext] Cosmetic catalog is empty");
      return "";
    }

    const profile = buildProfile(null, requestSkinAnalysis);
    const scored = catalog
      .map((product, index) => ({
        product,
        index,
        scored: scoreProduct(profile, toScoringProduct(product)),
      }))
      .sort((a, b) => b.scored.score - a.scored.score || a.index - b.index)
      .slice(0, Math.max(1, Math.min(limit, catalog.length)));

    const lines = scored.map(({ product, scored: productScore }, index) =>
      JSON.stringify({
        id: product.id,
        name: product.name,
        brand: product.brand,
        type: product.type,
        category: product.category,
        tags: Array.isArray(product.tags) ? product.tags.slice(0, 8) : [],
        benefits: Array.isArray(product.benefits) ? product.benefits.slice(0, 8) : [],
        spf: product.spf,
        finish: product.finish,
        hydrating: product.hydrating,
        oilFree: product.oilFree,
        waterproof: product.waterproof,
        transferProof: product.transferProof,
        imageUrl: imageUrl(product) || null,
        details: compact(product.details),
        candidateRank: index + 1,
        matchScore: productScore.score,
      })
    );

    const concerns = profile.concerns.length ? profile.concerns.join(", ") : "general maintenance";
    const result = [
      "COSMETIC PRODUCT CATALOG",
      "Recommend ONLY products from this catalog. Do not invent product names, brands, images, or IDs.",
      "Keep the visible assistant reply concise and organized: one short intro, then at most 3 bullet points with product names and brief reasons.",
      "Do not include long ingredient essays, full product dumps, or repeated details in the visible reply. Put exact product IDs in COSMETICS_DATA instead.",
      "Return a [COSMETICS_DATA] JSON block with this shape:",
      '{"recommendations":[{"id":"exact catalog id","rank":1,"score":95,"reason":"short user-facing reason"}]}',
      "Every recommendation.id must exactly match one id below.",
      `User skin profile: type=${profile.skinType}; hydration=${profile.hydrationPct}; oiliness=${profile.oilinessPct}; concerns=${concerns}.`,
      "Candidate products, one JSON object per line:",
      ...lines,
    ].join("\n");

    // Cache for 5 minutes — catalog changes are infrequent
    await CacheUtil.set(CATALOG_CACHE_KEY, result, CATALOG_CACHE_TTL_SECONDS);
    logger.info(`[buildCatalogContext] Built and cached catalog (${lines.length} products)`);

    return result;
  } catch (error) {
    logger.error(`[buildCatalogContext] ${(error as Error).message}`);
    return "";
  }
}

export async function resolveOutlineCosmeticsByIds(
  conversationId: string,
  cosmeticsData: unknown
): Promise<ResolvedCosmetic[]> {
  try {
    const recs = extractRecs(cosmeticsData);
    if (!recs.length) return [];

    const seen = new Set<string>();
    const ordered = recs.filter((rec) => {
      if (seen.has(rec.id)) return false;
      seen.add(rec.id);
      return true;
    });

    const products = (await prisma.cosmeticProduct.findMany({
      where: { id: { in: ordered.map((rec) => rec.id) } },
      select: {
        id: true,
        name: true,
        brand: true,
        tags: true,
        fileUrl: { select: { fileUrl: true } },
      },
    })) as Array<{
      id: string;
      name: string;
      brand: string | null;
      tags: string[];
      fileUrl: { fileUrl: string | null } | null;
    }>;

    const byId = new Map(products.map((product) => [product.id, product]));
    const resolved: ResolvedCosmetic[] = ordered.flatMap((rec, index) => {
      const product = byId.get(rec.id);
      if (!product) return [];
      const productImageUrl = product.fileUrl?.fileUrl ?? "";
      const rank = rec.rank && Number.isFinite(rec.rank) ? rec.rank : index + 1;
      const score = rec.score && Number.isFinite(rec.score) ? rec.score : 0;
      return [
        {
          id: product.id,
          rank,
          score,
          reason: rec.reason ?? "Selected by ChatWonder from the cosmetic catalog.",
          name: product.name,
          brand: product.brand ?? undefined,
          imageUrl: productImageUrl,
          cosmeticProduct: {
            id: product.id,
            name: product.name,
            brand: product.brand,
            tags: product.tags,
            fileUrl: productImageUrl ? { fileUrl: productImageUrl } : null,
          },
        },
      ];
    });

    if (!resolved.length) return [];

    const outline = await prisma.userOutline.findUnique({
      where: { conversationId },
      select: { id: true },
    });

    if (outline) {
      await persistOutlineCosmetics(outline.id, resolved);
      logger.info(
        `[resolveCosmeticsByIds] Persisted ${resolved.length} ChatWonder cosmetics to outline ${outline.id}`
      );
    } else {
      logger.warn(
        `[resolveCosmeticsByIds] No outline for conversation ${conversationId}; returning live-only`
      );
    }

    return resolved;
  } catch (error) {
    logger.error(`[resolveCosmeticsByIds] ${(error as Error).message}`);
    return [];
  }
}

export async function resolveAndPersistOutlineCosmetics(
  conversationId: string,
  requestSkinAnalysis?: unknown
): Promise<ResolvedCosmetic[]> {
  try {
    // The outline tied to this chat session, plus its linked skin profile.
    const outline = await prisma.userOutline.findUnique({
      where: { conversationId },
      select: {
        id: true,
        skinAnalysis: {
          select: {
            skinType: true,
            hydrationPct: true,
            oilinessPct: true,
            concerns: true,
          },
        },
      },
    });

    const profile = buildProfile(outline?.skinAnalysis ?? null, requestSkinAnalysis);

    // Real catalog (only products that actually have an image to show).
    const catalog = await prisma.cosmeticProduct.findMany({
      where: { fileUrl: { is: { fileUrl: { not: "" } } } },
      select: {
        id: true,
        name: true,
        brand: true,
        type: true,
        tags: true,
        spf: true,
        waterproof: true,
        transferProof: true,
        hydrating: true,
        oilFree: true,
        finish: true,
        fileUrl: { select: { fileUrl: true } },
      },
    });

    if (!catalog.length) {
      logger.warn(
        `[resolveCosmetics] Catalog empty (no products with images) for conversation ${conversationId}`
      );
      return [];
    }

    const scoringInput: ProductForScoring[] = catalog.map((p) => ({
      id: p.id,
      type: p.type,
      tags: p.tags,
      spf: p.spf,
      waterproof: p.waterproof,
      transferProof: p.transferProof,
      hydrating: p.hydrating,
      oilFree: p.oilFree,
      finish: p.finish,
    }));

    const ranked = rankProducts(profile, scoringInput);
    if (!ranked.length) return [];

    const byId = new Map(catalog.map((p) => [p.id, p]));

    const resolved: ResolvedCosmetic[] = ranked.flatMap((s) => {
      const p = byId.get(s.productId);
      if (!p) return [];
      const imageUrl = p.fileUrl?.fileUrl ?? "";
      const reason = s.reason.join(", ");
      return [
        {
          id: p.id,
          rank: s.rank,
          score: s.score,
          reason,
          name: p.name,
          brand: p.brand ?? undefined,
          imageUrl,
          cosmeticProduct: {
            id: p.id,
            name: p.name,
            brand: p.brand,
            tags: p.tags,
            fileUrl: imageUrl ? { fileUrl: imageUrl } : null,
          },
        },
      ];
    });

    // Persist the master list (refresh each cosmetics turn). Only when we have an
    // outline to attach to — otherwise we still return `resolved` for live render.
    if (outline) {
      await prisma.$transaction([
        prisma.cosmeticRecommendation.deleteMany({ where: { userOutlineId: outline.id } }),
        prisma.cosmeticRecommendation.createMany({
          data: ranked.map((s) => ({
            userOutlineId: outline.id,
            cosmeticProductId: s.productId,
            rank: s.rank,
            score: s.score,
            reason: s.reason.join(", "),
            signals: s.signals,
          })),
        }),
      ]);
      logger.info(
        `[resolveCosmetics] Persisted ${ranked.length} cosmetics to outline ${outline.id}`
      );
    } else {
      logger.warn(
        `[resolveCosmetics] No outline for conversation ${conversationId}; returning live-only`
      );
    }

    return resolved;
  } catch (error) {
    logger.error(`[resolveCosmetics] ${(error as Error).message}`);
    return [];
  }
}
