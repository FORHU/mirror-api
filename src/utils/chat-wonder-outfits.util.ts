import { prisma } from "./prisma";
import logger from "./logger";
import OutfitService from "../services/shared/outfit.service";

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

/**
 * Parses the query string ChatWonder puts in GARMENT_DATA and fetches matching
 * outfits from the DB. Returns { outfits, reason } ready to forward to the
 * frontend as garment_data, or null if the block is in the old sets[] format.
 */
export async function resolveOutfitsFromQuery(
  garmentData: unknown,
  userId: string
): Promise<{ outfits: unknown[]; reason: string } | null> {
  if (!garmentData || typeof garmentData !== "object") return null;
  const data = garmentData as Record<string, unknown>;
  const queryStr = typeof data.query === "string" ? data.query : "";
  if (!queryStr) return null;

  const reason = typeof data.reason === "string" ? data.reason : "";
  const params = Object.fromEntries(new URLSearchParams(queryStr)) as Record<string, string>;

  try {
    const result = await OutfitService.getUserOutfits(userId, params);
    logger.info(`[resolveOutfitsFromQuery] Resolved ${result.data.length} outfits for query: ${queryStr}`);
    return { outfits: result.data, reason };
  } catch (err) {
    logger.error(`[resolveOutfitsFromQuery] ${(err as Error).message}`);
    return null;
  }
}

/**
 * Persists the outfits ChatWonder recommends (GARMENT_DATA block) into the
 * active UserOutline. Because catalog outfits are shared (system-owned), we
 * duplicate each recommended outfit — including its display File row — so the
 * copy is owned exclusively by this outline (UserDesign).
 *
 * Old outline outfits are wiped first, keeping the list fresh each turn.
 *
 * GARMENT_DATA shape: { sets: [{ outfit_id, outfit_name, outfit_imageUrl, recommendations[], ... }] }
 *
 * Each turn wipes the previous AI outfits and creates fresh Garment + File + Outfit records
 * directly from ChatWonder's data — no DB catalog lookup required.
 */

export async function persistOutlineOutfits(
  conversationId: string,
  garmentData: unknown
): Promise<void> {
  try {
    if (!garmentData || typeof garmentData !== "object") return;
    const data = garmentData as Record<string, unknown>;
    const sets = Array.isArray(data.sets) ? data.sets : [];
    if (sets.length === 0) return;

    const outline = await prisma.userOutline.findUnique({
      where: { conversationId },
      select: { id: true, userId: true },
    });
    if (!outline) {
      logger.warn(`[persistOutlineOutfits] No outline for conversation ${conversationId}`);
      return;
    }

    // 1. Cascade-delete previous AI outfits for this outline
    const existingOutfits = await prisma.outfit.findMany({
      where: { userOutlineId: outline.id },
      select: {
        id: true,
        fileId: true,
        items: { select: { id: true, garmentId: true, garment: { select: { fileId: true } } } },
      },
    });

    if (existingOutfits.length > 0) {
      const itemIds = existingOutfits.flatMap((o) => o.items.map((i) => i.id));
      const garmentIds = existingOutfits.flatMap((o) => o.items.map((i) => i.garmentId));
      const fileIds = [
        ...new Set([
          ...existingOutfits.flatMap((o) => o.items.map((i) => i.garment.fileId)),
          ...existingOutfits.map((o) => o.fileId),
        ]),
      ];

      await prisma.garmentInOutfit.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.outfit.deleteMany({ where: { userOutlineId: outline.id } });
      if (garmentIds.length) await prisma.garment.deleteMany({ where: { id: { in: garmentIds } } });
      if (fileIds.length) await prisma.file.deleteMany({ where: { id: { in: fileIds } } });
    }

    // 2. Create new outfits directly from ChatWonder data
    let created = 0;
    for (const rawSet of sets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const set = rawSet as any;
      const outfitName: string = set.outfit_name || "AI Outfit";
      const outfitImageUrl: string = set.outfit_imageUrl ?? "";
      const recommendations: unknown[] = Array.isArray(set.recommendations) ? set.recommendations : [];

      const outfitFile = await prisma.file.create({
        data: { filename: outfitName, fileUrl: outfitImageUrl, mimeType: "image/jpeg", provider: "External" },
      });

      const items: Array<{ garmentId: string; slot: string; layerLevel: string }> = [];
      for (const rawRec of recommendations) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec = rawRec as any;
        const name: string = rec.name || "Garment";
        const imageUrl: string = rec.imageUrl ?? "";

        const garmentFile = await prisma.file.create({
          data: { filename: name, fileUrl: imageUrl, mimeType: "image/jpeg", provider: "External" },
        });

        const garment = await prisma.garment.create({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: {
            name,
            description: rec.description ?? undefined,
            imageUrl,
            garmentType: Array.isArray(rec.garmentType) ? rec.garmentType : [],
            fittingSlot: Array.isArray(rec.fittingSlot) ? rec.fittingSlot : ["None"],
            category: Array.isArray(rec.category) ? rec.category : [],
            layerLevel: rec.layerLevel ?? "BASE",
            ...(outline.userId && { userId: outline.userId }),
            fileId: garmentFile.id,
          } as any,
        });

        const slot: string = Array.isArray(rec.fittingSlot) ? (rec.fittingSlot[0] ?? "None") : "None";
        items.push({ garmentId: garment.id, slot, layerLevel: rec.layerLevel ?? "BASE" });
      }

      await prisma.outfit.create({
        data: {
          name: outfitName,
          description: set.reason ?? null,
          designType: "UserDesign",
          isPublic: false,
          ...(outline.userId && { userId: outline.userId }),
          userOutlineId: outline.id,
          fileId: outfitFile.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items: { create: items.map(({ garmentId, slot, layerLevel }) => ({ garmentId, slot, layerLevel })) as any },
        },
      });
      created++;
    }

    logger.info(`[persistOutlineOutfits] Persisted ${created} AI outfits to outline ${outline.id}`);
  } catch (error) {
    logger.error(`[persistOutlineOutfits] ${(error as Error).message}`);
  }
}
