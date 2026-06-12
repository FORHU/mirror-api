import { prisma } from "../utils/prisma";
import { Prisma, DESIGN_TYPE, FITTING_SLOT, LAYER_LEVEL } from "@prisma/client";

// Metadata keys that can be filtered on via `findByUserId`. Whitelisted so the
// key fed to the `->>` lookup is always a known column path. Arrays (category,
// tags) match against their stringified form; scalars (gender, silhouette) match
// exactly. Add a key here to expose a new metadata filter.
const META_TEXT_FIELDS = ["category", "gender", "silhouette", "tags", "garmentType"] as const;
type MetaTextField = (typeof META_TEXT_FIELDS)[number];

export default class OutfitRepo {
  static async findByUserId(
    userId?: string | null,
    page: number = 1,
    limit: number = 20,
    filters: { fileProvider?: string; fileProviderNot?: string; includeSystem?: boolean } = {},
    searchOutfit?: string,
    metaFilters: Partial<Record<MetaTextField, string>> = {},
    metaCategoryIn?: string
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
      // metaData is a JSON object, so Prisma's `string_contains` never matches its
      // nested values. Cast the whole blob to text and ILIKE it so the term hits any
      // field (tags, gender, category, silhouette, garmentType, …) and any future key.
      const metaRows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT "id"
          FROM "Outfit"
          WHERE "metaData"::text ILIKE ${`%${outfitTerm}%`}
        `
      );
      const metaIds = metaRows.map((row) => row.id);

      andClauses.push({
        OR: [
          { name: { contains: outfitTerm, mode: "insensitive" } },
          { description: { contains: outfitTerm, mode: "insensitive" } },
          ...(metaIds.length ? [{ id: { in: metaIds } }] : []),
        ],
      });
    }

    // Each supplied metadata filter narrows the result set independently (AND).
    // `"metaData"->>${field}` binds the whitelisted key as a parameter, so the
    // lookup is injection-safe. Array fields match against their stringified form.
    for (const field of META_TEXT_FIELDS) {
      const term = metaFilters[field]?.trim();
      if (!term) continue;

      const metaDataRows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT "id"
          FROM "Outfit"
          WHERE "metaData"->>${field} ILIKE ${`%${term}%`}
        `
      );
      andClauses.push({ id: { in: metaDataRows.map((row) => row.id) } });
    }

    if (metaCategoryIn) {
      const categories = metaCategoryIn
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (categories.length > 0) {
        // Build a regex pattern like '(?i)Casual|Streetwear|Vintage'
        const regexPattern = `(?i)${categories.join("|")}`;
        const metaDataRows = await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`
            SELECT "id"
            FROM "Outfit"
            WHERE "metaData"->>'category' ~ ${regexPattern}
          `
        );
        andClauses.push({ id: { in: metaDataRows.map((row) => row.id) } });
      }
    }

    if (andClauses.length) where.AND = andClauses;

    // When filtering by metaCategory (AI-driven fetch), randomise the pool so
    // the same query never returns the same order twice.
    if (metaCategoryIn) {
      const allIds = await prisma.outfit.findMany({ where, select: { id: true } });
      const shuffled = allIds.map((r) => r.id).sort(() => Math.random() - 0.5);
      const selectedIds = shuffled.slice(skip, skip + limit);

      const unordered = await prisma.outfit.findMany({
        where: { id: { in: selectedIds } },
        include: {
          file: true,
          items: { include: { garment: { include: { file: true } } } },
        },
      });
      // Re-apply the shuffled order (findMany with `in` doesn't preserve it).
      const byId = new Map(unordered.map((o) => [o.id, o]));
      const data = selectedIds.map((id) => byId.get(id)).filter(Boolean) as typeof unordered;

      return { data, total: allIds.length, page, limit };
    }

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
   * Enumerates every distinct top-level key found in outfit `metaData`, with the
   * deduplicated set of values seen for that key across all non-deleted outfits.
   * Array values (tags, category, garmentType, …) are exploded into their
   * elements; scalars (gender, silhouette, …) are taken as-is. Useful for
   * building search facets / filter dropdowns.
   *
   * Scope:
   *   - userId === undefined → every outfit
   *   - userId === null      → system outfits only
   *   - userId === "<id>"    → that user's outfits + system outfits
   */
  static async getMetaDataFields(userId?: string | null) {
    const scope =
      userId === undefined
        ? Prisma.empty
        : userId === null
          ? Prisma.sql`AND o."userId" IS NULL`
          : Prisma.sql`AND (o."userId" = ${userId} OR o."userId" IS NULL)`;

    const rows = await prisma.$queryRaw<{ field: string; values: string[] }[]>(
      Prisma.sql`
        WITH pairs AS (
          SELECT kv.key AS field, kv.value AS value
          FROM "Outfit" o,
               LATERAL jsonb_each(o."metaData") AS kv(key, value)
          WHERE o."metaData" IS NOT NULL
            AND o."isDeleted" = false
            ${scope}
        ),
        expanded AS (
          -- array fields: one row per element
          SELECT field, jsonb_array_elements_text(value) AS val
          FROM pairs
          WHERE jsonb_typeof(value) = 'array'
          UNION
          -- scalar fields: strip the surrounding JSON quotes from strings
          SELECT field, btrim(value::text, '"') AS val
          FROM pairs
          WHERE jsonb_typeof(value) <> 'array'
        )
        SELECT field, array_agg(DISTINCT val ORDER BY val) AS "values"
        FROM expanded
        GROUP BY field
        ORDER BY field
      `
    );

    return rows;
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
