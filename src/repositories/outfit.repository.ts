import { prisma } from "../utils/prisma";
import { Prisma, DESIGN_TYPE, FITTING_SLOT, LAYER_LEVEL } from "@prisma/client";

export default class OutfitRepo {
  static async findByUserId(
    userId?: string | null,
    page: number = 1,
    limit: number = 20,
    filters: { fileProvider?: string; fileProviderNot?: string; includeSystem?: boolean } = {},
    searchOutfit?: string
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.OutfitWhereInput = {};
    if (userId !== undefined) {
      if (filters.includeSystem) {
        // Return the user's own outfits + system outfits (userId = null) together
        where.OR = [{ userId }, { userId: null }];
      } else {
        where.userId = userId;
      }
    }
    if (filters.fileProvider) {
      where.file = { provider: filters.fileProvider };
    } else if (filters.fileProviderNot) {
      where.file = { provider: { not: filters.fileProviderNot } };
    }

    const andClauses: Prisma.OutfitWhereInput[] = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];

    const outfitTerm = searchOutfit?.trim();
    if (outfitTerm) {
      andClauses.push({
        OR: [
          { name: { contains: outfitTerm, mode: "insensitive" } },
          { description: { contains: outfitTerm, mode: "insensitive" } },
          // Postgres JSON fields do not support `lower(jsonb)` / case-insensitive
          // string searches across the entire object. Skip metaData search here to
          // avoid the Prisma/Postgres connector error.
        ],
      });
    }

    if (andClauses.length) where.AND = andClauses;

    const [data, total] = await Promise.all([
      prisma.outfit.findMany({
        where,
        skip,
        take: limit,
        include: {
          file: true,
          items: {
            include: {
              garment: { include: { file: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.outfit.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Finds a user's outfit whose item garment-set exactly matches `garmentIds`
   * (order-insensitive, duplicates ignored). Returns null if none.
   */
  static async findByExactGarmentSet(userId: string | null, garmentIds: string[]) {
    const uniqueIds = Array.from(new Set(garmentIds));
    if (!uniqueIds.length) return null;

    // Narrow with Prisma: candidate outfits whose items are all within our set.
    // `every` matches vacuously on zero-item outfits, so we filter on size in JS.
    const candidates = await prisma.outfit.findMany({
      where: {
        userId,
        isDeleted: false,
        items: { every: { garmentId: { in: uniqueIds } } },
      },
      select: {
        id: true,
        name: true,
        items: { select: { garmentId: true } },
      },
    });

    return (
      candidates.find((o) => {
        const ids = new Set(o.items.map((i) => i.garmentId));
        return ids.size === uniqueIds.length && uniqueIds.every((id) => ids.has(id));
      }) ?? null
    );
  }

  static async findById(id: string) {
    return prisma.outfit.findUnique({
      where: { id },
      include: {
        file: true,
        items: {
          include: {
            garment: {
              include: { file: true },
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
    itineraryEventId?: string;
    items: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[];
    metaData?: Prisma.InputJsonValue;
  }) {
    return prisma.outfit.create({
      data: {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
        designType: data.designType,
        ...(data.metaData !== undefined && { metaData: data.metaData }),
        ...(data.userId && { user: { connect: { id: data.userId } } }),
        ...(data.userOutlineId && { userOutline: { connect: { id: data.userOutlineId } } }),
        ...(data.itineraryEventId && {
          itineraryEvent: { connect: { id: data.itineraryEventId } },
        }),
        file: { connect: { id: data.fileId } },
        items: {
          create: data.items.map((item) => ({
            garment: { connect: { id: item.garmentId } },
            slot: item.slot,
            layerLevel: item.layerLevel,
          })),
        },
      },
      include: {
        file: true,
        items: {
          include: {
            garment: {
              include: { file: true },
            },
          },
        },
      },
    });
  }

  static async update(
    id: string,
    data: {
      name?: string;
      description?: string;
      isPublic?: boolean;
      designType?: DESIGN_TYPE;
      fileId?: string;
      items?: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[];
    }
  ) {
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
              layerLevel: item.layerLevel,
            })),
          },
        }),
      },
      include: {
        file: true,
        items: {
          include: {
            garment: {
              include: { file: true },
            },
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
