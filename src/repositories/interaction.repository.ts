import { prisma } from "../utils/prisma";

export default class InteractionRepo {
  static async findByOutfitId(outfitId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.interaction.findMany({
        where: { outfitId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.interaction.count({ where: { outfitId } }),
    ]);

    return { data, total, page, limit };
  }

  static async create(data: {
    type: string;
    garmentId: string;
    outfitId?: string;
  }) {
    return prisma.interaction.create({
      data,
    });
  }
}
