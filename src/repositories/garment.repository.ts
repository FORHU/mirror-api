import { prisma } from "../utils/prisma";
import { Prisma } from "@prisma/client";

export default class GarmentRepo {
  static async findAll(filters: any, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.GarmentWhereInput = {
      ...filters,
    };

    const [data, total] = await Promise.all([
      prisma.garment.findMany({
        where,
        skip,
        take: limit,
        include: {
          tags: true,
          file: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.garment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  static async findById(id: string) {
    return prisma.garment.findFirst({
      where: { id },
      include: {
        tags: true,
        file: true,
      },
    });
  }

  static async create(data: Prisma.GarmentCreateInput) {
    return prisma.garment.create({
      data,
      include: {
        tags: true,
        file: true,
      },
    });
  }

  static async update(id: string, data: Prisma.GarmentUpdateInput) {
    return prisma.garment.update({
      where: { id },
      data,
      include: {
        tags: true,
        file: true,
      },
    });
  }

  static async delete(id: string) {
    return prisma.garment.delete({
      where: { id },
    });
  }
}
