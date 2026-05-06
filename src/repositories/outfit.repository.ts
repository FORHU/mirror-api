import { prisma } from "../utils/prisma";

export default class OutfitRepo {
  static async findByUserId(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.outfit.findMany({
        where: { userId },
        skip,
        take: limit,
        include: {
          items: {
            include: {
              garment: true,
            },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.outfit.count({ where: { userId } }),
    ]);

    return { data, total, page, limit };
  }

  static async findById(id: string) {
    return prisma.outfit.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            garment: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });
  }

  static async create(data: {
    userId: string;
    name: string;
    description?: string;
    items: { garmentId: string; order: number }[];
  }) {
    return prisma.outfit.create({
      data: {
        name: data.name,
        description: data.description,
        userId: data.userId,
        items: {
          create: data.items.map((item) => ({
            garment: { connect: { id: item.garmentId } },
            order: item.order,
          })),
        },
      },
      include: {
        items: {
          include: { garment: true },
        },
      },
    });
  }

  static async delete(id: string) {
    // Delete related GarmentInOutfit records first due to foreign keys
    await prisma.garmentInOutfit.deleteMany({
      where: { outfitId: id },
    });
    
    // Also delete interactions
    await prisma.interaction.deleteMany({
      where: { outfitId: id },
    });

    return prisma.outfit.delete({
      where: { id },
    });
  }
}
