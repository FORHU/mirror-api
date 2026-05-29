import OutfitRepo from "../../repositories/outfit.repository";
import GarmentRepo from "../../repositories/garment.repository";
import FileRepo from "../../repositories/file.repository";
import FileService from "./file.service";
import logger from "../../utils/logger";
import { s3Client } from "../../utils/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { parsePagination } from "../../helpers/pagination.helper";
import {
  CATEGORY,
  FITTING_SLOT,
  GARMENT_GENDER,
  SILHOUETTE,
  Prisma,
  File,
  Garment,
  Outfit,
  DESIGN_TYPE,
  LAYER_LEVEL,
} from "@prisma/client";
import { findExistingComposition } from "../../validations/outfit.validation";
import {
  OutfitEvaluation,
  OutfitComposition,
  OutfitMatch,
  WardrobeGarment,
} from "../../utils/openai/evaluate-outfit.util";

export default class OutfitService {
  static async getUserOutfits(
    userId?: string | null,
    query: Record<string, string | undefined> = {}
  ) {
    const { searchOutfit, searchOutfitItems, systemOnly } = query;
    const { page, limit, search: globalSearch } = parsePagination(query);
    const effectiveUserId = systemOnly === "true" ? null : userId;
    const result = await OutfitRepo.findByUserId(
      effectiveUserId,
      page,
      limit,
      {},
      globalSearch || searchOutfit,
      searchOutfitItems
    );
    const { sortBy, sortOrder, search, filters } = parsePagination(query);
    return { ...result, sortBy, sortOrder, search, filters };
  }

  /**
   * Outfits whose display file is still the EXTERNAL placeholder minted by
   * `createOutfit`'s garment-URL fallback — i.e. rows that haven't had a real
   * image uploaded yet. Powers the "needs-image" admin/dev list.
   */
  static async getOutfitsNeedingImage(
    userId?: string,
    query: Record<string, string | undefined> = {}
  ) {
    const { page, limit, sortBy, sortOrder, search, filters } = parsePagination(query);
    const result = await OutfitRepo.findByUserId(userId, page, limit, { fileProvider: "EXTERNAL" });
    return { ...result, sortBy, sortOrder, search, filters };
  }

  /**
   * Outfits whose display file is a real upload (non-EXTERNAL provider).
   * Powers the "complete" list — outfits considered ready to surface.
   */
  static async getOutfitsWithUploadedImage(
    userId?: string,
    query: Record<string, string | undefined> = {}
  ) {
    const { page, limit, sortBy, sortOrder, search, filters } = parsePagination(query);
    const result = await OutfitRepo.findByUserId(userId, page, limit, { fileProviderNot: "EXTERNAL" });
    return { ...result, sortBy, sortOrder, search, filters };
  }

  static async getOutfitById(id: string, userId?: string) {
    const outfit = await OutfitRepo.findById(id);
    if (!outfit) throw { status: 404, message: "Outfit not found" };
    if (userId && outfit.userId !== userId) throw { status: 403, message: "Unauthorized" };
    return outfit;
  }

  static async createOutfit(
    userId?: string,
    data: {
      fileId?: string;
      items?: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[];
      name?: string;
      description?: string;
      isPublic?: boolean;
      designType?: DESIGN_TYPE;
      metaData?: Prisma.InputJsonValue;
    } = {}
  ) {
    // Idempotent: if this user already has an outfit with the same garment set,
    // return it instead of creating a duplicate (and avoid wasting a File row).
    const existing = await findExistingComposition(userId, data.items);
    if (existing) return existing;

    let fileId = data.fileId;

    // Fallback: when the client doesn't upload its own display image, mint a NEW
    // File row pointing at the first usable garment's URL. We can't reuse the
    // garment's existing File row directly — `Outfit.fileId` is @unique, so each
    // Outfit must own a distinct File.id. This creates a separate DB row that
    // references the same underlying URL, satisfying the unique constraint.
    if (!fileId && data.items && data.items.length > 0) {
      for (const item of data.items) {
        const garment = await GarmentRepo.findById(item.garmentId);
        const sourceUrl = garment?.imageUrl || garment?.file?.fileUrl;
        if (sourceUrl) {
          const newFile = await FileRepo.create({
            filename: `outfit-display-${Date.now()}`,
            fileUrl: sourceUrl,
            provider: "EXTERNAL",
          });
          fileId = newFile.id;
          break;
        }
      }
    }

    if (!fileId) {
      throw {
        status: 400,
        message:
          "Outfit requires a display image (upload a file, pass fileId, or include at least one garment with an image)",
      };
    }

    return OutfitRepo.create({
      userId,
      name: data.name || "Untitled Outfit",
      description: data.description,
      isPublic: data.isPublic,
      designType: data.designType,
      fileId: fileId || "",
      items: data.items || [],
      metaData: data.metaData,
    });
  }

  static async updateOutfit(
    id: string,
    userId?: string,
    data: {
      name?: string;
      description?: string;
      isPublic?: boolean;
      designType?: DESIGN_TYPE;
      fileId?: string;
      items?: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[];
    } = {}
  ) {
    const existing = await this.getOutfitById(id, userId); // Ensure it exists and belongs to user
    const oldFileId = existing.fileId;
    const oldFileProvider = (existing as Outfit & { file?: { provider?: string } }).file?.provider;

    const updated = await OutfitRepo.update(id, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      designType: data.designType,
      fileId: data.fileId,
      items: data.items,
    });

    // Outfit.fileId is @unique, so once the caller swaps in a new fileId the
    // previous File row is unreferenced. The EXTERNAL placeholder minted by
    // createOutfit's garment-URL fallback is the canonical case — drop it
    // here so the File table doesn't accumulate dead pointer rows. S3-backed
    // files are left alone (they own an actual object and need a different
    // cleanup path).
    if (data.fileId && oldFileId && data.fileId !== oldFileId && oldFileProvider === "EXTERNAL") {
      try {
        await FileRepo.softDelete(oldFileId);
      } catch (err) {
        logger.warn(
          `[OutfitService.updateOutfit] placeholder File cleanup failed (fileId=${oldFileId}): ${(err as Error).message}`
        );
      }
    }

    return updated;
  }

  static async deleteOutfit(id: string, userId?: string) {
    const existing = await this.getOutfitById(id, userId); // Ensure it exists and belongs to user
    const fileId = existing.fileId;
    const fileProvider = (existing as Outfit & { file?: { provider?: string } }).file?.provider;

    await OutfitRepo.delete(id);

    // Outfit.fileId is @unique — once the Outfit is gone, the File row is
    // unreferenced. Mirror updateOutfit's cleanup: drop EXTERNAL placeholder
    // rows so the File table doesn't accumulate dead pointers. S3-backed
    // uploads are left alone (they own an S3 object and need a different
    // cleanup path that deletes the object too).
    if (fileId && fileProvider === "EXTERNAL") {
      try {
        await FileRepo.softDelete(fileId);
      } catch (err) {
        logger.warn(
          `[OutfitService.deleteOutfit] placeholder File cleanup failed (fileId=${fileId}): ${(err as Error).message}`
        );
      }
    }

    return { message: "Outfit deleted successfully" };
  }

  /**
   * Upload step shared by `evaluate` and `evaluateHybrid`. Mirrors
   * `GarmentService.uploadGarmentFile` — fast, no AI work — so the controller
   * can 202 the client before the model call. The returned `imageUrl` is
   * the CDN-fronted public URL that OpenAI can fetch directly.
   */
  static async uploadOutfitFile(
    file: Express.Multer.File,
    fallbackImageUrl?: string
  ): Promise<{ file: File | null; imageUrl: string }> {
    let fileRecord: File | null = null;
    let urlForAI = fallbackImageUrl;

    if (file) {
      fileRecord = await FileService.uploadFile(file);
      urlForAI = fileRecord?.fileUrl;
    }

    if (!urlForAI) {
      throw { status: 400, message: "Either an uploaded file or an imageUrl is required" };
    }

    return { file: fileRecord, imageUrl: urlForAI };
  }

  /**
   * Best-effort cleanup for an orphaned File created during an AI flow
   * that failed before persisting an Outfit. Deletes the S3 object and
   * the File row; swallows + logs errors so the original failure surfaces.
   */
  static async discardOrphanedFile(fileRecord: Record<string, unknown>) {
    if (!fileRecord?.id) return;
    try {
      if (fileRecord.provider === "S3" && fileRecord.path && fileRecord.bucket) {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: fileRecord.bucket as string,
            Key: fileRecord.path as string,
          })
        );
      }
      await FileRepo.softDelete(fileRecord.id as string);
    } catch (err) {
      // Intentional: don't mask the original error path.
      // Caller has already logged the real failure.
      logger.error(
        `[OutfitService.discardOrphanedFile] fileId=${fileRecord.id} cleanup failed: ${(err as Error).message}`
      );
    }
  }

  /**
   * Compact-shape garments for prompts. Used to ground `evaluate` and
   * `evaluateHybrid` in the actual items composing the outfit.
   */
  static async loadGarmentsForAI(ids: string[]): Promise<WardrobeGarment[]> {
    if (!ids.length) return [];
    const rows = await GarmentRepo.findByIds(ids);
    return rows.map((g: Garment & { tags?: { name: string }[]; metaData?: Prisma.JsonValue }) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      garmentType: g.garmentType,
      fittingSlot: g.fittingSlot,
      category: g.category,
      gender: g.gender,
      layerLevel: g.layerLevel,
      silhouette: g.silhouette,
      tags: Array.isArray(g.tags) ? g.tags.map((t: { name: string }) => t.name) : [],
      dominantColor: (g.metaData as Prisma.JsonObject)?.dominantColor as string | undefined,
    }));
  }

  /**
   * Returns the user's wardrobe in a token-frugal shape for the AI prompt.
   * Includes the user's own garments plus system garments (userId = null).
   */
  static async loadWardrobeForAI(userId: string, limit = 80): Promise<WardrobeGarment[]> {
    const { data } = await GarmentRepo.findAll({ OR: [{ userId }, { userId: null }] }, 1, limit);
    return data.map((g: Garment & { tags?: { name: string }[]; metaData?: Prisma.JsonValue }) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      garmentType: g.garmentType,
      fittingSlot: g.fittingSlot,
      category: g.category,
      gender: g.gender,
      layerLevel: g.layerLevel,
      silhouette: g.silhouette,
      tags: Array.isArray(g.tags) ? g.tags.map((t: { name: string }) => t.name) : [],
      dominantColor: (g.metaData as Prisma.JsonObject)?.dominantColor as string | undefined,
    }));
  }

  /**
   * Persists an outfit assembled from an `OutfitEvaluation` (image-only flow).
   * Caller supplies the composition (`items`) — the AI did not pick garments.
   */
  static async persistEvaluatedOutfit(
    evaluation: OutfitEvaluation,
    fileRecord: File | null,
    userId: string,
    items: { garmentId: string; slot?: FITTING_SLOT | null }[]
  ) {
    const garmentMap = await this.garmentMapFor(items.map((i) => i.garmentId));
    const stats = this.computeOutfitStats(items, garmentMap);
    return this.createOutfit(userId, {
      name: evaluation.name,
      description: evaluation.description,
      designType: evaluation.designType,
      fileId: fileRecord?.id,
      items: items.map((i) => ({ garmentId: i.garmentId, slot: i.slot ?? undefined })),
      metaData: {
        tags: evaluation.tags,
        dominantColor: evaluation.dominantColor,
        generatedBy: "openai:gpt-4o:evaluate",
        ...stats,
      },
    });
  }

  /**
   * Persists an outfit composed entirely by the AI from the wardrobe.
   * No image is uploaded — `createOutfit`'s garment-image fallback supplies
   * the display File.
   */
  static async persistComposedOutfit(composition: OutfitComposition, userId: string) {
    const garmentMap = await this.garmentMapFor(composition.items.map((i) => i.garmentId));
    const stats = this.computeOutfitStats(composition.items, garmentMap);
    return this.createOutfit(userId, {
      name: composition.name,
      description: composition.description,
      designType: composition.designType,
      items: composition.items,
      metaData: {
        tags: composition.tags,
        generatedBy: "openai:gpt-4o:compose",
        ...stats,
      },
    });
  }

  /**
   * Persists an outfit produced by the hybrid (image -> wardrobe match) flow.
   */
  static async persistMatchedOutfit(match: OutfitMatch, fileRecord: File | null, userId: string) {
    const garmentMap = await this.garmentMapFor(match.items.map((i) => i.garmentId));
    const stats = this.computeOutfitStats(match.items, garmentMap);
    return this.createOutfit(userId, {
      name: match.name,
      description: match.description,
      designType: match.designType,
      fileId: fileRecord?.id,
      items: match.items,
      metaData: {
        tags: match.tags,
        dominantColor: match.dominantColor,
        unmatchedDescriptions: match.unmatchedDescriptions,
        generatedBy: "openai:gpt-4o:match",
        ...stats,
      },
    });
  }

  /**
   * Computes per-outfit metadata from the picked garments:
   *   - categoryMix: per-garment normalized weight (each garment contributes
   *     weight 1, split evenly across its `category` array). Percentages
   *     always sum to 100, rounded to 1 decimal.
   *   - silhouette.perSlot: silhouette per slot (slot taken from the item
   *     if set, otherwise the garment's first fittingSlot).
   *   - silhouette.tally: occurrence count per silhouette value.
   *   - silhouette.dominant: most frequent silhouette; ties broken by enum
   *     order for deterministic output.
   *
   * Garments missing `category` or `silhouette` are simply ignored in their
   * respective bucket — no fabrication, no defaults.
   */
  static computeOutfitStats(
    items: { garmentId: string; slot?: FITTING_SLOT | null }[],
    garmentMap: Map<
      string,
      Garment & { category?: CATEGORY[]; silhouette?: SILHOUETTE; fittingSlot?: FITTING_SLOT[] }
    >
  ) {
    const picked = items
      .map((it) => ({ item: it, garment: garmentMap.get(it.garmentId) }))
      .filter(
        (p): p is { item: typeof p.item; garment: NonNullable<typeof p.garment> } => !!p.garment
      );

    const catTotals: Record<string, number> = {};
    for (const { garment } of picked) {
      const cats: string[] = Array.isArray(garment.category) ? garment.category : [];
      if (!cats.length) continue;
      const w = 1 / cats.length;
      for (const c of cats) catTotals[c] = (catTotals[c] ?? 0) + w;
    }
    const catSum = Object.values(catTotals).reduce((a, b) => a + b, 0);
    const categoryMix: Record<string, number> = {};
    if (catSum > 0) {
      for (const [k, v] of Object.entries(catTotals)) {
        categoryMix[k] = Math.round((v / catSum) * 1000) / 10;
      }
    }

    const perSlot: Record<string, string> = {};
    const tally: Record<string, number> = {};
    for (const { item, garment } of picked) {
      const s = garment.silhouette;
      if (!s) continue;
      const slot = item.slot ?? garment.fittingSlot?.[0];
      if (slot) perSlot[slot] = s;
      tally[s] = (tally[s] ?? 0) + 1;
    }

    let dominant: string | undefined;
    let bestCount = 0;
    for (const s of Object.values(SILHOUETTE) as string[]) {
      const c = tally[s] ?? 0;
      if (c > bestCount) {
        dominant = s;
        bestCount = c;
      }
    }

    return {
      categoryMix,
      silhouette: { perSlot, tally, dominant },
    };
  }

  /**
   * Loads garments by id and returns a Map keyed by id, for stat computation.
   * Returns an empty Map if `ids` is empty.
   */
  private static async garmentMapFor(
    ids: string[]
  ): Promise<
    Map<
      string,
      Garment & { category?: CATEGORY[]; silhouette?: SILHOUETTE; fittingSlot?: FITTING_SLOT[] }
    >
  > {
    if (!ids.length) return new Map();
    const rows = await GarmentRepo.findByIds(ids);
    return new Map(
      rows.map(
        (
          g: Garment & {
            category?: CATEGORY[];
            silhouette?: SILHOUETTE;
            fittingSlot?: FITTING_SLOT[];
          }
        ) => [g.id, g]
      )
    );
  }

  /**
   * Rule-based outfit composer. No AI. Picks garments from the wardrobe
   * matching the requested CATEGORY, one per body slot, at random. The
   * required slots are torso + legs + feet; head and a single accessory
   * are included only if a matching garment exists.
   *
   * Resolves torso+legs via either a FullGarment (dress/jumpsuit) or
   * UpperGarment + LowerGarment separates, chosen at random from whichever
   * paths are viable.
   */
  static async recommendOutfit(opts: {
    category: CATEGORY;
    userId?: string;
    gender?: GARMENT_GENDER;
    name?: string;
    description?: string;
  }) {
    const genderFilter = opts.gender
      ? { gender: { in: [opts.gender, GARMENT_GENDER.UNISEX] } }
      : {};

    const { data: garments } = await GarmentRepo.findAll(
      {
        OR: [{ userId: opts.userId }, { userId: null }],
        category: { has: opts.category },
        ...genderFilter,
      },
      1,
      200
    );

    const bySlot = new Map<FITTING_SLOT, (Garment & { fittingSlot?: FITTING_SLOT[] })[]>();
    for (const g of garments) {
      for (const slot of g.fittingSlot ?? []) {
        const bucket = bySlot.get(slot) ?? [];
        bucket.push(g);
        bySlot.set(slot, bucket);
      }
    }

    const pickRandom = <T>(arr?: T[]): T | undefined =>
      arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;

    const foot = pickRandom(bySlot.get(FITTING_SLOT.FootGarment));
    if (!foot) {
      throw {
        status: 404,
        message: `No footwear found for category "${opts.category}"`,
      };
    }

    const fulls = bySlot.get(FITTING_SLOT.FullGarment);
    const uppers = bySlot.get(FITTING_SLOT.UpperGarment);
    const lowers = bySlot.get(FITTING_SLOT.LowerGarment);
    const paths: ("full" | "separates")[] = [];
    if (fulls?.length) paths.push("full");
    if (uppers?.length && lowers?.length) paths.push("separates");
    if (!paths.length) {
      throw {
        status: 404,
        message: `No torso/leg garments found for category "${opts.category}"`,
      };
    }

    const items: { garmentId: string; slot: FITTING_SLOT }[] = [];
    const path = paths[Math.floor(Math.random() * paths.length)];
    if (path === "full") {
      const fullGarmentId = pickRandom(fulls)?.id;
      if (fullGarmentId) items.push({ garmentId: fullGarmentId, slot: FITTING_SLOT.FullGarment });
    } else {
      const upperGarmentId = pickRandom(uppers)?.id;
      if (upperGarmentId)
        items.push({ garmentId: upperGarmentId, slot: FITTING_SLOT.UpperGarment });
      const lowerGarmentId = pickRandom(lowers)?.id;
      if (lowerGarmentId)
        items.push({ garmentId: lowerGarmentId, slot: FITTING_SLOT.LowerGarment });
    }
    items.push({ garmentId: foot.id, slot: FITTING_SLOT.FootGarment });

    const head = pickRandom(bySlot.get(FITTING_SLOT.HeadGarment));
    if (head) items.push({ garmentId: head.id, slot: FITTING_SLOT.HeadGarment });

    // At most one accessory — pool from every accessory slot, then pick one.
    const accessoryPool: { garmentId: string; slot: FITTING_SLOT }[] = [];
    const accessorySlots: FITTING_SLOT[] = [
      FITTING_SLOT.NeckAccessory,
      FITTING_SLOT.WaistAccessory,
      FITTING_SLOT.LeftHandAccessory,
      FITTING_SLOT.RightHandAccessory,
      FITTING_SLOT.Glasses,
      FITTING_SLOT.Earrings,
    ];
    for (const slot of accessorySlots) {
      const g = pickRandom(bySlot.get(slot));
      if (g) accessoryPool.push({ garmentId: g.id, slot });
    }
    const accessory = pickRandom(accessoryPool);
    if (accessory) items.push(accessory);

    const garmentMap = new Map<
      string,
      Garment & { category?: CATEGORY[]; silhouette?: SILHOUETTE; fittingSlot?: FITTING_SLOT[] }
    >(
      garments.map(
        (
          g: Garment & {
            category?: CATEGORY[];
            silhouette?: SILHOUETTE;
            fittingSlot?: FITTING_SLOT[];
          }
        ) => [g.id, g]
      )
    );
    const stats = this.computeOutfitStats(items, garmentMap);

    return this.createOutfit(opts.userId, {
      name: opts.name || `${opts.category} look`,
      description: opts.description,
      designType: opts.userId ? "UserDesign" : "systemDesign",
      items,
      metaData: {
        generatedBy: "rule:recommend",
        category: opts.category,
        composition: path,
        ...stats,
      },
    });
  }
}
