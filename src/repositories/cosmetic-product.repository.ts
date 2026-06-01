import { prisma } from "../utils/prisma";
import { COSMETIC_CATEGORY, COSMETIC_TYPE, Prisma } from "@prisma/client";

export default class CosmeticProductRepo {
  static async findAll(
    filters: {
      type?: COSMETIC_TYPE;
      brand?: string;
      category?: COSMETIC_CATEGORY;
      tags?: string[];
      searchTerms?: string[];
    } = {},
    page: number = 1,
    limit: number = 20
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.CosmeticProductWhereInput = {};
    if (filters.type) where.type = filters.type;
    if (filters.category) where.category = filters.category;
    if (filters.brand) where.brand = { equals: filters.brand, mode: "insensitive" };
    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }
    if (filters.searchTerms?.length) {
      const searchTerms = filters.searchTerms;
      const ingredientRows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT "id"
          FROM "CosmeticProduct"
          WHERE "metaData"::text ILIKE ANY (
            ARRAY[${Prisma.join(searchTerms.map((term) => Prisma.sql`${`%${term}%`}`))}]::text[]
          )
        `
      );
      const ingredientIds = ingredientRows.map((row) => row.id);

      const searchWhere: Prisma.CosmeticProductWhereInput[] = [
        ...searchTerms.flatMap((term) => [
          { name: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { brand: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { details: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ]),
        { tags: { hasSome: searchTerms } },
        { benefits: { hasSome: searchTerms } },
        ...(ingredientIds.length ? [{ id: { in: ingredientIds } }] : []),
      ];
      where.OR = searchWhere;
    }

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
