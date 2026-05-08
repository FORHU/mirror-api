import { prisma } from "../utils/prisma";

export default class OutfitRepo {
  static async findByUserId(userId?: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.outfit.findMany({
        where: { userId },
        skip,
        take: limit,
        include: {
          items: {
            include: {
              garment: {
                include: { file: true }
              },
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
            garment: {
              include: { file: true }
            },
          },
          orderBy: { order: "asc" },
        },
      },
    });
  }

  static async create(data: {
    userId?: string;
    name: string;
    description?: string;
    isPublic?: boolean;
    designType?: any; // Using any or specific enum if imported
    fileId: string;
    items: { garmentId: string; order: number }[];
  }) {
    return prisma.outfit.create({
      data: {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
        designType: data.designType,
        ...(data.userId && { user: { connect: { id: data.userId } } }),
        file: { connect: { id: data.fileId } },
        items: {
          create: data.items.map((item) => ({
            garment: { connect: { id: item.garmentId } },
            order: item.order,
          })),
        },
      },
      include: {
        items: {
          include: { 
            garment: {
              include: { file: true }
            }
          },
          orderBy: { order: "asc" },
        },
      },
    });
  }

  static async update(id: string, data: {
    name?: string;
    description?: string;
    isPublic?: boolean;
    designType?: any;
    fileId?: string;
    items?: { garmentId: string; order: number }[];
  }) {
    // If items are provided, replace them
    if (data.items) {
      await prisma.garmentInOutfit.deleteMany({
        where: { outfitId: id },
      });
    }

    return prisma.outfit.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
        designType: data.designType,
        ...(data.fileId && { file: { connect: { id: data.fileId } } }),
        ...(data.items && {
          items: {
            create: data.items.map((item) => ({
              garment: { connect: { id: item.garmentId } },
              order: item.order,
            })),
          },
        }),
      },
      include: {
        items: {
          include: {
            garment: {
              include: { file: true }
            }
          },
          orderBy: { order: "asc" },
        },
      },
    });
  }

  static async delete(id: string) {
    // Delete related GarmentInOutfit records first due to foreign keys
    await prisma.garmentInOutfit.deleteMany({
      where: { outfitId: id },
    });

    return prisma.outfit.delete({
      where: { id },
    });
  }
}
