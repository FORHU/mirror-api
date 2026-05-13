import GarmentRepo from "../../repositories/garment.repository";
import { GARMENT_TYPES, FITTING_SLOT, CATEGORY, GARMENT_GENDER, LAYER_LEVEL, SILHOUETTE, Prisma } from "@prisma/client";
import FileService from "./file.service";
import { evaluateGarmentImage, GarmentEvaluation } from "../../utils/openai/evaluate-garment.util";

export default class GarmentService {
  static async getGarments(query: any) {
    const { page, limit, garmentType, fittingSlot, category, gender, silhouette, tag } = query;
    
    const filters: any = {};
    if (garmentType) {
      filters.garmentType = { hasSome: Array.isArray(garmentType) ? garmentType : [garmentType] };
    }
    if (fittingSlot) {
      filters.fittingSlot = { hasSome: Array.isArray(fittingSlot) ? fittingSlot : [fittingSlot] };
    }
    if (category) {
      filters.category = { hasSome: Array.isArray(category) ? category : [category] };
    }
    if (gender) filters.gender = gender;
    if (silhouette) filters.silhouette = silhouette;
    if (tag) {
      filters.tags = { some: { name: tag } };
    }

    return GarmentRepo.findAll(
      filters,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20
    );
  }

  static async getGarmentById(id: string) {
    const garment = await GarmentRepo.findById(id);
    if (!garment) throw { status: 404, message: "Garment not found" };
    return garment;
  }

  static async createGarment(data: any) {
    const garmentData: any = {
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

  static async updateGarment(id: string, data: any) {
    await this.getGarmentById(id); // Ensure it exists

    const garmentData: any = {
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

    return GarmentRepo.update(id, garmentData);
  }

  static async deleteGarment(id: string) {
    await this.getGarmentById(id);
    await GarmentRepo.delete(id);
    return { message: "Garment deleted successfully" };
  }

  /**
   * Step 1: upload the image and run GPT-4o vision against our enum vocabulary.
   * Returns the raw evaluation + file record so the controller can validate
   * the AI output before we persist anything.
   */
  static async runGarmentEvaluation(
    file: any,
    options: { imageUrl?: string } = {},
  ): Promise<{ evaluation: GarmentEvaluation; file: any | null; imageUrl: string }> {
    let fileRecord: any = null;
    let urlForAI = options.imageUrl;

    if (file) {
      fileRecord = await FileService.uploadFile(file);
      const signed = await FileService.attachPresignedUrls(fileRecord);
      urlForAI = signed.fileUrl;
    }

    if (!urlForAI) {
      throw { status: 400, message: "Either an uploaded file or an imageUrl is required" };
    }

    const evaluation = await evaluateGarmentImage(urlForAI);
    return { evaluation, file: fileRecord, imageUrl: fileRecord?.fileUrl || urlForAI };
  }

  /**
   * Step 2: persist an already-validated evaluation as a Garment for the user.
   */
  static async persistEvaluatedGarment(
    evaluation: GarmentEvaluation,
    fileRecord: any,
    imageUrl: string,
    userId: string,
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
