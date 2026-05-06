import GarmentRepo from "../repositories/garment.repository";
import { BodyPart, Category, Prisma } from "@prisma/client";

export default class GarmentService {
  static async getGarments(query: any) {
    const { page, limit, bodyPart, category, tag } = query;
    
    const filters: any = {};
    if (bodyPart) filters.bodyPart = bodyPart;
    if (category) filters.category = category;
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
      bodyPart: data.bodyPart as BodyPart,
      category: data.category as Category,
      colorName: data.colorName,
      colorHex: data.colorHex,
      scaleFactor: data.scaleFactor,
      zIndex: data.zIndex,
    };

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
      bodyPart: data.bodyPart as BodyPart,
      category: data.category as Category,
      colorName: data.colorName,
      colorHex: data.colorHex,
      scaleFactor: data.scaleFactor,
      zIndex: data.zIndex,
    };

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
