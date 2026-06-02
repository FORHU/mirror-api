import { prisma } from "./prisma";
import logger from "./logger";

/**
 * Fetches a compact outfit catalog from the DB (system + user outfits) and
 * returns it as a JSON string block ready to be appended to the [outfits]
 * persona prompt so ChatWonder can reference real IDs and image URLs.
 *
 * Token-frugal: only the fields the AI needs are included. Limit is capped
 * at 60 outfits to stay within a reasonable context window.
 */
export async function buildOutfitCatalog(userId?: string | null, limit = 60): Promise<string> {
  try {
    const where = userId
      ? { OR: [{ userId }, { userId: null }], isDeleted: false }
      : { userId: null, isDeleted: false };

    const outfits = await prisma.outfit.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        designType: true,
        file: { select: { fileUrl: true } },
        items: {
          select: {
            slot: true,
            garment: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                garmentType: true,
                fittingSlot: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!outfits.length) return "";

    const catalog = outfits.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      designType: o.designType,
      imageUrl: o.file?.fileUrl ?? null,
      items: o.items.map((i) => ({
        slot: i.slot,
        garment: i.garment
          ? {
              id: i.garment.id,
              name: i.garment.name,
              imageUrl: i.garment.imageUrl,
              garmentType: i.garment.garmentType,
              fittingSlot: i.garment.fittingSlot,
              category: i.garment.category,
            }
          : null,
      })),
    }));

    return `\n\nAVAILABLE OUTFIT CATALOG (use these real IDs and imageUrls — do NOT invent ids):\n${JSON.stringify(catalog, null, 2)}`;
  } catch (err) {
    logger.error(`[buildOutfitCatalog] Failed to fetch catalog: ${(err as Error).message}`);
    return "";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OutfitSet {
  outfitId?: string;
  name?: string;
  imageUrl?: string;
  vibe?: string;
  trend_note?: string;
  reason?: string;
  recommendations?: Record<string, unknown>[];
  resolved?: boolean;
  [key: string]: unknown;
}

/**
 * Validates and hydrates the `outfitId` on every set returned by the
 * [outfits] persona. For each set:
 *  - If `outfitId` is a real DB id → keep it, patch in the correct imageUrl,
 *    name, and constituent garment recommendations from the DB record.
 *  - If `outfitId` is missing/invalid → try to match by name; if still
 *    nothing found, mark `resolved: false` so the frontend can filter it out.
 *
 * Mirror of `resolveSetProducts` but operates at the outfit level.
 */
export async function resolveSetOutfits(sets: OutfitSet[] | undefined): Promise<OutfitSet[]> {
  if (!Array.isArray(sets) || sets.length === 0) return sets ?? [];

  let kept = 0;
  let repaired = 0;
  let unresolved = 0;

  for (const set of sets) {
    // 1. Try to validate the id ChatWonder provided
    if (set.outfitId) {
      try {
        const outfit = await prisma.outfit.findUnique({
          where: { id: set.outfitId },
          select: {
            id: true,
            name: true,
            file: { select: { fileUrl: true } },
            items: {
              select: {
                slot: true,
                garment: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                    garmentType: true,
                    fittingSlot: true,
                    category: true,
                  },
                },
              },
            },
          },
        });

        if (outfit) {
          // Patch with authoritative DB values — never trust AI-hallucinated urls
          set.outfitId = outfit.id;
          set.name = outfit.name ?? set.name;
          set.imageUrl = outfit.file?.fileUrl ?? set.imageUrl;
          set.recommendations = outfit.items.map((i) => ({
            id: i.garment?.id,
            name: i.garment?.name,
            imageUrl: i.garment?.imageUrl,
            fittingSlot: i.slot ?? i.garment?.fittingSlot?.[0],
            garmentType: i.garment?.garmentType,
            category: i.garment?.category,
          }));
          set.resolved = true;
          kept++;
          continue;
        }
      } catch {
        // fall through to name-based repair
      }
    }

    // 2. Id was missing/invalid — try to match by name (case-insensitive)
    if (set.name) {
      try {
        const outfit = await prisma.outfit.findFirst({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: { name: { contains: set.name, mode: "insensitive" } } as any,
          select: {
            id: true,
            name: true,
            file: { select: { fileUrl: true } },
            items: {
              select: {
                slot: true,
                garment: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                    garmentType: true,
                    fittingSlot: true,
                    category: true,
                  },
                },
              },
            },
          },
        });

        if (outfit) {
          set.outfitId = outfit.id;
          set.name = outfit.name ?? set.name;
          set.imageUrl = outfit.file?.fileUrl ?? set.imageUrl;
          set.recommendations = outfit.items.map((i) => ({
            id: i.garment?.id,
            name: i.garment?.name,
            imageUrl: i.garment?.imageUrl,
            fittingSlot: i.slot ?? i.garment?.fittingSlot?.[0],
            garmentType: i.garment?.garmentType,
            category: i.garment?.category,
          }));
          set.resolved = true;
          repaired++;
          continue;
        }
      } catch {
        // fall through to unresolved
      }
    }

    // 3. Nothing matched — mark as unresolved
    set.resolved = false;
    unresolved++;
  }

  // Filter out unresolved sets so the frontend doesn't receive broken data
  const resolved = sets.filter((s) => s.resolved);

  logger.info(
    `[resolveSetOutfits] ${sets.length} sets — kept ${kept}, repaired ${repaired}, unresolved ${unresolved} (filtered)`
  );

  return resolved;
}
