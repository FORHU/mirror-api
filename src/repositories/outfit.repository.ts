import { prisma } from "../utils/prisma";
import { DESIGN_TYPE, FITTING_SLOT } from "@prisma/client";

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
        },
      },
    });
  }

  static async create(data: {
    userId?: string;
    name: string;
    description?: string;
    isPublic?: boolean;
    designType?: DESIGN_TYPE;
    fileId: string;
    userOutlineId?: string;
    items: { garmentId: string; slot?: FITTING_SLOT }[];
  }) {
    return prisma.outfit.create({
      data: {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
        designType: data.designType,
        ...(data.userId && { user: { connect: { id: data.userId } } }),
        ...(data.userOutlineId && { userOutline: { connect: { id: data.userOutlineId } } }),
        file: { connect: { id: data.fileId } },
        items: {
          create: data.items.map((item) => ({
            garment: { connect: { id: item.garmentId } },
            slot: item.slot,
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
        },
      },
    });
  }

  static async update(id: string, data: {
    name?: string;
    description?: string;
    isPublic?: boolean;
    designType?: DESIGN_TYPE;
    fileId?: string;
    items?: { garmentId: string; slot?: FITTING_SLOT }[];
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
              slot: item.slot,
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
