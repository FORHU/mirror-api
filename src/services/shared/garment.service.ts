import GarmentRepo from "../../repositories/garment.repository";
import {
  GARMENT_TYPES,
  FITTING_SLOT,
  CATEGORY,
  GARMENT_GENDER,
  LAYER_LEVEL,
  SILHOUETTE,
  Prisma,
  File,
} from "@prisma/client";
import FileService from "./file.service";
import CacheUtil from "../../utils/cache.util";
import { evaluateGarmentImage, GarmentEvaluation } from "../../utils/openai/evaluate-garment.util";

const GARMENT_CACHE_TTL = 1800; // 30 minutes — matches a typical user session
const garmentKey = (id: string) => `garment:${id}`;

export default class GarmentService {
  static async getGarments(query: Record<string, string | string[] | undefined>) {
    const {
      page,
      limit,
      garmentType,
      fittingSlot,
      category,
      gender,
      silhouette,
      tag,
      userId,
      systemOnly,
    } = query;

    const filters: Prisma.GarmentWhereInput = {};
    if (systemOnly === "true") {
      filters.userId = null;
    } else if (userId) {
      filters.userId = userId as string;
    }
    if (garmentType) {
      filters.garmentType = {
        hasSome: (Array.isArray(garmentType) ? garmentType : [garmentType]) as GARMENT_TYPES[],
      };
    }

    if (fittingSlot) {
      const SLOT_MAP: Record<string, FITTING_SLOT> = {
        headgarments: FITTING_SLOT.HeadGarment,
        headgarment: FITTING_SLOT.HeadGarment,
        glasses: FITTING_SLOT.Glasses,
        earrings: FITTING_SLOT.Earrings,
        uppergarments: FITTING_SLOT.UpperGarment,
        uppergarment: FITTING_SLOT.UpperGarment,
        lowergarments: FITTING_SLOT.LowerGarment,
        lowergarment: FITTING_SLOT.LowerGarment,
        fullgarments: FITTING_SLOT.FullGarment,
        fullgarment: FITTING_SLOT.FullGarment,
        footgarments: FITTING_SLOT.FootGarment,
        footgarment: FITTING_SLOT.FootGarment,
        lefthandaccessories: FITTING_SLOT.LeftHandAccessory,
        lefthandaccessory: FITTING_SLOT.LeftHandAccessory,
        righthandaccessories: FITTING_SLOT.RightHandAccessory,
        righthandaccessory: FITTING_SLOT.RightHandAccessory,
        neckaccessories: FITTING_SLOT.NeckAccessory,
        neckaccessory: FITTING_SLOT.NeckAccessory,
        waistaccessories: FITTING_SLOT.WaistAccessory,
        waistaccessory: FITTING_SLOT.WaistAccessory,
        none: FITTING_SLOT.None,
      };

      const rawSlots = Array.isArray(fittingSlot) ? fittingSlot : [fittingSlot];
      const mappedSlots = rawSlots
        .map((s) => {
          if (typeof s !== "string") return null;
          const clean = s.trim().toLowerCase();
          return (
            SLOT_MAP[clean] ||
            (Object.values(FITTING_SLOT) as string[]).find((val) => val.toLowerCase() === clean)
          );
        })
        .filter((s): s is FITTING_SLOT => Boolean(s));

      if (mappedSlots.length > 0) {
        filters.fittingSlot = { hasSome: mappedSlots };
      }
    }

    if (category) {
      filters.category = {
        hasSome: (Array.isArray(category) ? category : [category]) as CATEGORY[],
      };
    }
    if (gender) filters.gender = (Array.isArray(gender) ? gender[0] : gender) as GARMENT_GENDER;
    if (silhouette)
      filters.silhouette = (Array.isArray(silhouette) ? silhouette[0] : silhouette) as SILHOUETTE;
    if (tag) {
      filters.tags = { some: { name: Array.isArray(tag) ? tag[0] : tag } };
    }

    return GarmentRepo.findAll(
      filters,
      page ? parseInt(page as string) : 1,
      limit ? parseInt(limit as string) : 20
    );
  }

  static async getGarmentById(id: string) {
    const garment = await CacheUtil.remember(garmentKey(id), GARMENT_CACHE_TTL, () =>
      GarmentRepo.findById(id)
    );
    if (!garment) throw { status: 404, message: "Garment not found" };
    return garment;
  }

  static async createGarment(data: {
    name: string;
    description?: string;
    imageUrl?: string;
    garmentType?: GARMENT_TYPES | GARMENT_TYPES[];
    fittingSlot?: FITTING_SLOT | FITTING_SLOT[];
    category?: CATEGORY | CATEGORY[];
    gender?: GARMENT_GENDER;
    layerLevel?: LAYER_LEVEL;
    silhouette?: SILHOUETTE;
    metaData?: Prisma.InputJsonValue;
    userId?: string;
    file?: Prisma.FileCreateWithoutGarmentInput;
    fileId?: string;
    tags?: string[];
  }) {
    const garmentData = {
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl || "",
      garmentType: data.garmentType as GARMENT_TYPES[],
      fittingSlot: data.fittingSlot as FITTING_SLOT[],
      category: data.category as CATEGORY[],
      gender: data.gender as GARMENT_GENDER,
      layerLevel: data.layerLevel as LAYER_LEVEL,
      silhouette: data.silhouette as SILHOUETTE,
      metaData: data.metaData,
    } as Prisma.GarmentCreateInput;

    if (data.userId) {
      garmentData.user = { connect: { id: data.userId } };
    }

    if (data.file) {
      garmentData.file = {
        create: data.file,
      };
    } else if (data.fileId) {
      garmentData.file = {
        connect: { id: data.fileId },
      };
    }

    if (data.tags && Array.isArray(data.tags)) {
      garmentData.tags = {
        connectOrCreate: data.tags.map((tag: string) => ({
          where: { name: tag },
          create: { name: tag },
        })),
      };
    }

    return GarmentRepo.create(garmentData);
  }

  static async updateGarment(
    id: string,
    data: {
      name?: string;
      description?: string;
      imageUrl?: string;
      garmentType?: GARMENT_TYPES | GARMENT_TYPES[];
      fittingSlot?: FITTING_SLOT | FITTING_SLOT[];
      category?: CATEGORY | CATEGORY[];
      gender?: GARMENT_GENDER;
      layerLevel?: LAYER_LEVEL;
      silhouette?: SILHOUETTE;
      metaData?: Prisma.InputJsonValue;
      file?: Prisma.FileCreateWithoutGarmentInput;
      fileId?: string;
      tags?: string[];
    }
  ) {
    const existing = await this.getGarmentById(id); // Ensure it exists
    const oldFileId = existing.fileId;

    const garmentData: Prisma.GarmentUpdateInput = {
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      garmentType: data.garmentType as GARMENT_TYPES[],
      fittingSlot: data.fittingSlot as FITTING_SLOT[],
      category: data.category as CATEGORY[],
      gender: data.gender as GARMENT_GENDER,
      layerLevel: data.layerLevel as LAYER_LEVEL,
      silhouette: data.silhouette as SILHOUETTE,
      metaData: data.metaData,
    };

    if (data.file) {
      garmentData.file = {
        upsert: {
          create: data.file,
          update: data.file,
        },
      };
    } else if (data.fileId) {
      garmentData.file = {
        connect: { id: data.fileId },
      };
    }

    if (data.tags && Array.isArray(data.tags)) {
      garmentData.tags = {
        set: [], // Clear existing tags
        connectOrCreate: data.tags.map((tag: string) => ({
          where: { name: tag },
          create: { name: tag },
        })),
      };
    }

    const updated = await GarmentRepo.update(id, garmentData);
    await CacheUtil.del(garmentKey(id));

    // If the file pointer changed (caller swapped fileId or uploaded a new
    // file), the previous File row is now unreferenced from this garment.
    // Hand it to FileService — it deletes the row + S3 object only when no
    // other entity still holds onto it. Wrapped so a cleanup failure can't
    // mask the successful update.
    if (data.fileId && oldFileId && data.fileId !== oldFileId) {
      try {
        await FileService.discardIfUnreferenced(oldFileId);
      } catch (err) {
        // Already best-effort inside discardIfUnreferenced; this is belt-and-suspenders.
      }
    }

    return updated;
  }

  static async deleteGarment(id: string) {
    const existing = await this.getGarmentById(id);
    const fileId = existing.fileId;

    await GarmentRepo.delete(id);
    await CacheUtil.del(garmentKey(id));

    // The Garment is gone — nothing here points at the File anymore.
    // Defer to FileService.discardIfUnreferenced so S3 and the File row
    // are reaped only when no other model (Outfit, User avatar) still
    // references the same file.
    if (fileId) {
      try {
        await FileService.discardIfUnreferenced(fileId);
      } catch (err) {
        // Best-effort cleanup; the delete itself already succeeded.
      }
    }

    return { message: "Garment deleted successfully" };
  }

  /**
   * Just the upload step: takes the multipart file (or a pre-existing URL),
   * saves the File row, returns a presigned URL the controller can hand to AI.
   * Fast — no AI call here. Use this when you want to respond to the client
   * early and finish AI work in the background.
   */
  static async uploadGarmentFile(
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
   * Step 1: upload the image and run GPT-4o vision against our enum vocabulary.
   * Returns the raw evaluation + file record so the controller can validate
   * the AI output before we persist anything.
   */
  static async runGarmentEvaluation(
    file: Express.Multer.File,
    options: { imageUrl?: string } = {}
  ): Promise<{ evaluation: GarmentEvaluation; file: File | null; imageUrl: string }> {
    const { file: fileRecord, imageUrl } = await this.uploadGarmentFile(file, options.imageUrl);
    const evaluation = await evaluateGarmentImage(imageUrl);
    return { evaluation, file: fileRecord, imageUrl };
  }

  /**
   * Step 2: persist an already-validated evaluation as a Garment for the user.
   */
  static async persistEvaluatedGarment(
    evaluation: GarmentEvaluation,
    fileRecord: File | null,
    imageUrl: string,
    userId: string
  ) {
    return this.createGarment({
      name: evaluation.name,
      description: evaluation.description,
      imageUrl,
      garmentType: evaluation.garmentType,
      fittingSlot: evaluation.fittingSlot,
      category: evaluation.category,
      gender: evaluation.gender,
      layerLevel: evaluation.layerLevel,
      silhouette: evaluation.silhouette,
      metaData: {
        dominantColor: evaluation.dominantColor,
        generatedBy: "openai:gpt-4o",
      },
      tags: evaluation.tags,
      fileId: fileRecord?.id,
      userId,
    });
  }
}
