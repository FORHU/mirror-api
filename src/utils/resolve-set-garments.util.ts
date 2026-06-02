import { prisma } from "./prisma";
import logger from "./logger";

/**
 * A single recommendation inside a ChatWonder `set`.
 *
 * ChatWonder now fetches the real catalog from /external/garments and
 * /external/cosmetics, so it usually returns REAL ids/imageUrls. We therefore
 * VALIDATE rather than override: a valid, attribute-consistent id is kept
 * untouched. We only re-match by attributes when the id is missing, not in the
 * DB, duplicated within the set, or inconsistent with the recommendation's slot
 * /type (e.g. a FootGarment carrying a Pants id). The catalog never leaves our
 * system and ChatWonder's correct choices are never altered.
 */
interface SetRecommendation {
  id?: string;
  name?: string;
  description?: string;
  fittingSlot?: string;
  garmentType?: string[];
  category?: string[];
  type?: string; // cosmetic type (e.g. "FOUNDATION")
  reason?: string;
  imageUrl?: string;
  resolved?: boolean;
  [key: string]: unknown;
}

interface RecommendationSet {
  recommendations?: SetRecommendation[];
  [key: string]: unknown;
}

interface GarmentMatch {
  id: string;
  name: string;
  imageUrl: string;
  file: { fileUrl: string } | null;
}

interface CosmeticMatch {
  id: string;
  name: string;
  fileUrl: { fileUrl: string } | null;
}

/**
 * Validate the id ChatWonder already provided. Returns the garment only if the
 * id exists, isn't already used in this set, and its slot is consistent with
 * the recommendation. Otherwise null (caller will re-match by attributes).
 */
async function validateGarmentId(
  rec: SetRecommendation,
  usedIds: Set<string>
): Promise<GarmentMatch | null> {
  if (!rec.id || usedIds.has(rec.id)) return null;
  try {
    const g = await prisma.garment.findUnique({
      where: { id: rec.id },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        fittingSlot: true,
        file: { select: { fileUrl: true } },
      },
    });
    if (!g) return null;
    // If the recommendation names a slot, the id's garment must match it —
    // catches ChatWonder reusing one id across different slots.
    if (rec.fittingSlot && !g.fittingSlot.includes(rec.fittingSlot as never)) {
      return null;
    }
    return { id: g.id, name: g.name, imageUrl: g.imageUrl, file: g.file };
  } catch {
    return null;
  }
}

/**
 * Match a garment by attributes — the fallback when the provided id is bad.
 * Progressively relaxes the filters so a sparse catalog still yields a hit.
 */
async function findGarment(
  rec: SetRecommendation,
  genderFilter: string[],
  usedIds: Set<string>
): Promise<GarmentMatch | null> {
  const slot = rec.fittingSlot ? [rec.fittingSlot] : undefined;
  const types = rec.garmentType?.length ? rec.garmentType : undefined;
  const cats = rec.category?.length ? rec.category : undefined;

  // Tightest match first, then drop category, then drop type — slot is the anchor.
  const attempts: Record<string, unknown>[] = [
    { fittingSlot: slot, garmentType: types, category: cats },
    { fittingSlot: slot, garmentType: types },
    { fittingSlot: slot },
  ];

  for (const a of attempts) {
    const where: Record<string, unknown> = { gender: { in: genderFilter } };
    if (usedIds.size) where.id = { notIn: Array.from(usedIds) };
    if (a.fittingSlot) where.fittingSlot = { hasSome: a.fittingSlot };
    if (a.garmentType) where.garmentType = { hasSome: a.garmentType };
    if (a.category) where.category = { hasSome: a.category };

    try {
      const g = await prisma.garment.findFirst({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: where as any,
        select: {
          id: true,
          name: true,
          imageUrl: true,
          file: { select: { fileUrl: true } },
        },
      });
      if (g) return g as GarmentMatch;
    } catch (err) {
      logger.warn(
        `[resolveSetProducts] Garment query failed (likely bad enum), relaxing: ${(err as Error).message}`
      );
    }
  }
  return null;
}

/** Validate the cosmetic id ChatWonder provided (exists, unused, type matches). */
async function validateCosmeticId(
  rec: SetRecommendation,
  usedIds: Set<string>
): Promise<CosmeticMatch | null> {
  if (!rec.id || usedIds.has(rec.id)) return null;
  const normalizedRecType =
    typeof rec.type === "string" ? rec.type.toUpperCase().replace(/\s+/g, "_") : undefined;
  try {
    const c = await prisma.cosmeticProduct.findUnique({
      where: { id: rec.id },
      select: { id: true, name: true, type: true, fileUrl: { select: { fileUrl: true } } },
    });
    if (!c) return null;
    if (normalizedRecType && c.type && String(c.type) !== normalizedRecType) return null;
    return { id: c.id, name: c.name, fileUrl: c.fileUrl };
  } catch {
    return null;
  }
}

/** Match a cosmetic by type — the fallback when the provided id is bad. */
async function findCosmetic(
  rec: SetRecommendation,
  usedIds: Set<string>
): Promise<CosmeticMatch | null> {
  const type =
    typeof rec.type === "string" ? rec.type.toUpperCase().replace(/\s+/g, "_") : undefined;
  if (!type) return null;

  const where: Record<string, unknown> = { type };
  if (usedIds.size) where.id = { notIn: Array.from(usedIds) };

  try {
    const c = await prisma.cosmeticProduct.findFirst({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      select: { id: true, name: true, fileUrl: { select: { fileUrl: true } } },
    });
    return (c as CosmeticMatch) ?? null;
  } catch (err) {
    logger.warn(
      `[resolveSetProducts] Cosmetic query failed (likely bad type "${type}"): ${(err as Error).message}`
    );
    return null;
  }
}

/**
 * Validate (and only when necessary, repair) the ids/imageUrls in ChatWonder
 * `sets`. ChatWonder-provided ids that check out are KEPT untouched; only
 * missing/invalid/duplicate/mismatched ones are re-matched by attributes.
 * Mutates and returns the sets array.
 */
export async function resolveSetProducts(
  sets: RecommendationSet[] | undefined,
  gender: string
): Promise<RecommendationSet[]> {
  if (!Array.isArray(sets) || sets.length === 0) return sets ?? [];

  const genderFilter = [gender, "UNISEX"]; // match requested gender or unisex items
  let kept = 0;
  let repaired = 0;
  let unresolved = 0;
  let total = 0;

  for (const set of sets) {
    if (!Array.isArray(set.recommendations)) continue;
    const usedIds = new Set<string>();

    for (const rec of set.recommendations) {
      const isGarment = Boolean(rec.fittingSlot) || Boolean(rec.garmentType?.length);
      const isCosmetic = !isGarment && typeof rec.type === "string";
      if (!isGarment && !isCosmetic) continue;
      total++;

      // 1. Trust ChatWonder's id if it validates (real + consistent + unused).
      const valid = isGarment
        ? await validateGarmentId(rec, usedIds)
        : await validateCosmeticId(rec, usedIds);

      if (valid) {
        usedIds.add(valid.id);
        rec.resolved = true;
        kept++; // left untouched — no alteration of a good ChatWonder choice
        continue;
      }

      // 2. Id was missing/invalid/duplicate/mismatched — re-match by attributes.
      const match = isGarment
        ? await findGarment(rec, genderFilter, usedIds)
        : await findCosmetic(rec, usedIds);

      if (match) {
        usedIds.add(match.id);
        rec.id = match.id;
        rec.imageUrl =
          ("imageUrl" in match && match.imageUrl) ||
          ("file" in match && match.file?.fileUrl) ||
          ("fileUrl" in match && match.fileUrl?.fileUrl) ||
          rec.imageUrl;
        rec.name = match.name ?? rec.name;
        rec.resolved = true;
        repaired++;
      } else {
        rec.resolved = false;
        unresolved++;
      }
    }

    // Filter out unresolved placeholders so they don't break the frontend UI with fake images/ids
    set.recommendations = set.recommendations.filter((r) => r.resolved);
  }

  logger.info(
    `[resolveSetProducts] ${total} recs — kept ${kept}, repaired ${repaired}, unresolved ${unresolved} (filtered out)`
  );
  return sets;
}
