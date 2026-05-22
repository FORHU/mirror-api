import { prisma } from "../utils/prisma";
import { COSMETIC_CATEGORY, COSMETIC_TYPE, Prisma } from "@prisma/client";

export default class CosmeticProductRepo {
  static async findAll(
    filters: { type?: COSMETIC_TYPE; brand?: string; category?: COSMETIC_CATEGORY } = {},
    page: number = 1,
    limit: number = 20
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.CosmeticProductWhereInput = {};
    if (filters.type) where.type = filters.type;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = { equals: filters.brand, mode: "insensitive" };

    const [data, total] = await Promise.all([
      prisma.cosmeticProduct.findMany({
        where,
        skip,
        take: limit,
        include: { fileUrl: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.cosmeticProduct.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  static async findById(id: string) {
    return prisma.cosmeticProduct.findUnique({
      where: { id },
      include: { fileUrl: true },
    });
  }

  static async findByIds(ids: string[]) {
    if (!ids.length) return [];
    return prisma.cosmeticProduct.findMany({
      where: { id: { in: ids } },
      include: { fileUrl: true },
    });
  }

  static async create(data: Prisma.CosmeticProductCreateInput) {
    return prisma.cosmeticProduct.create({
      data,
      include: { fileUrl: true },
    });
  }

  static async update(id: string, data: Prisma.CosmeticProductUpdateInput) {
    return prisma.cosmeticProduct.update({
      where: { id },
      data,
      include: { fileUrl: true },
    });
  }

  static async delete(id: string) {
    return prisma.cosmeticProduct.delete({ where: { id } });
  }
}
