import GarmentRepo from "../../repositories/garment.repository";
import { GarmentTypes, FittingSlots, Category, Gender, LayerLevel, Prisma } from "@prisma/client";

export default class GarmentService {
  static async getGarments(query: any) {
    const { page, limit, garmentType, fittingSlot, category, gender, tag } = query;
    
    const filters: any = {};
    if (garmentType) filters.garmentType = garmentType;
    if (fittingSlot) filters.fittingSlot = fittingSlot;
    if (category) filters.category = category;
    if (gender) filters.gender = gender;
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
    const garmentData: Prisma.GarmentCreateInput = {
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      garmentType: data.garmentType as GarmentTypes,
      fittingSlot: data.fittingSlot as FittingSlots,
      category: data.category as Category,
      gender: data.gender as Gender,
      layerLevel: data.layerLevel as LayerLevel,
      metaData: data.metaData,
    };

    if (data.file) {
      garmentData.file = {
        create: data.file,
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

    const garmentData: Prisma.GarmentUpdateInput = {
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      garmentType: data.garmentType as GarmentTypes,
      fittingSlot: data.fittingSlot as FittingSlots,
      category: data.category as Category,
      gender: data.gender as Gender,
      layerLevel: data.layerLevel as LayerLevel,
      metaData: data.metaData,
    };

    if (data.file) {
      garmentData.file = {
        upsert: {
          create: data.file,
          update: data.file,
        },
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
}
