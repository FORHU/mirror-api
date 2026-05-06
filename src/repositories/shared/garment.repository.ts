import { prisma } from "../../utils/prisma";
import { Prisma } from "@prisma/client";

export default class GarmentRepo {
  static async findAll(filters: any, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.GarmentWhereInput = {
      deletedAt: null,
      ...filters,
    };

    const [data, total] = await Promise.all([
      prisma.garment.findMany({
        where,
        skip,
        take: limit,
        include: {
          tags: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.garment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  static async findById(id: string) {
    return prisma.garment.findFirst({
      where: { id, deletedAt: null },
      include: {
        tags: true,
      },
    });
  }

  static async create(data: Prisma.GarmentCreateInput) {
    return prisma.garment.create({
      data,
      include: {
        tags: true,
      },
    });
  }

  static async update(id: string, data: Prisma.GarmentUpdateInput) {
    return prisma.garment.update({
      where: { id },
      data,
      include: {
        tags: true,
      },
    });
  }

  static async delete(id: string) {
    return prisma.garment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
