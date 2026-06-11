import CosmeticProductRepo from "../../repositories/cosmetic-product.repository";
import FileRepo from "../../repositories/file.repository";
import { COSMETIC_CATEGORY, COSMETIC_FINISH, COSMETIC_TYPE, Prisma } from "@prisma/client";

import { parsePagination } from "../../helpers/pagination.helper";

const fileNotFound = () => ({ status: 400, message: "Referenced file (fileUrlId) does not exist" });

const splitSearchTerms = (value: string) =>
  value
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

export default class CosmeticProductService {
  static async getProducts(query: Record<string, string | undefined | string[]>) {
    const { type, brand, category, tags, metaCategory } = query;
    const {
      page,
      limit,
      sortBy,
      sortOrder,
      search,
      filters: parsedFilters,
    } = parsePagination(query as Record<string, unknown>);
    const rawSearch =
      typeof query.search === "string"
        ? query.search
        : typeof query.q === "string"
          ? query.q
          : undefined;

    const filters: {
      type?: COSMETIC_TYPE;
      brand?: string;
      category?: COSMETIC_CATEGORY;
      tags?: string[];
      searchTerms?: string[];
      skinType?: string;
    } = {};
    if (
      type &&
      typeof type === "string" &&
      (Object.values(COSMETIC_TYPE) as string[]).includes(type)
    ) {
      filters.type = type as COSMETIC_TYPE;
    }
    if (
      category &&
      typeof category === "string" &&
      (Object.values(COSMETIC_CATEGORY) as string[]).includes(category)
    ) {
      filters.category = category as COSMETIC_CATEGORY;
    }
    if (typeof brand === "string" && brand.trim()) filters.brand = brand.trim();
    if (tags) {
      filters.tags = Array.isArray(tags) ? tags : [tags];
    }
    if (rawSearch?.trim()) {
      filters.searchTerms = splitSearchTerms(rawSearch);
    }

    if (typeof metaCategory === "string" && metaCategory.trim()) {
      filters.skinType = metaCategory.trim().toLowerCase();
    }

    const result = await CosmeticProductRepo.findAll(filters, page, limit);
    return { ...result, sortBy, sortOrder, search: rawSearch ?? search, filters: parsedFilters };
  }

  static async getProductById(id: string) {
    const product = await CosmeticProductRepo.findById(id);
    if (!product) throw { status: 404, message: "Cosmetic product not found" };
    return product;
  }

  static async createProduct(data: {
    name: string;
    brand?: string;
    details?: string;
    fileUrlId?: string;
    hexColor?: string;
    type?: COSMETIC_TYPE;
    category?: COSMETIC_CATEGORY | null;
    priceAmount?: number | null;
    priceUnit?: string | null;
    tags?: string[];
    benefits?: string[];
    spf?: number | null;
    waterproof?: boolean;
    transferProof?: boolean;
    hydrating?: boolean;
    oilFree?: boolean;
    finish?: COSMETIC_FINISH | null;
    metaData?: Prisma.InputJsonValue;
  }) {
    if (data.fileUrlId) {
      const file = await FileRepo.findById(data.fileUrlId);
      if (!file) throw fileNotFound();
    }

    const createInput: Prisma.CosmeticProductCreateInput = {
      name: data.name,
      brand: data.brand,
      details: data.details,
      hexColor: data.hexColor,
      type: data.type,
      category: data.category,
      priceAmount: data.priceAmount,
      priceUnit: data.priceUnit,
      tags: data.tags,
      benefits: data.benefits,
      spf: data.spf,
      waterproof: data.waterproof,
      transferProof: data.transferProof,
      hydrating: data.hydrating,
      oilFree: data.oilFree,
      finish: data.finish,
      metaData: data.metaData,
      ...(data.fileUrlId && { fileUrl: { connect: { id: data.fileUrlId } } }),
    };

    return CosmeticProductRepo.create(createInput);
  }

  static async updateProduct(
    id: string,
    data: {
      name?: string;
      brand?: string;
      details?: string;
      fileUrlId?: string | null;
      hexColor?: string;
      type?: COSMETIC_TYPE;
      category?: COSMETIC_CATEGORY | null;
      priceAmount?: number | null;
      priceUnit?: string | null;
      tags?: string[];
      benefits?: string[];
      spf?: number | null;
      waterproof?: boolean;
      transferProof?: boolean;
      hydrating?: boolean;
      oilFree?: boolean;
      finish?: COSMETIC_FINISH | null;
      metaData?: Prisma.InputJsonValue;
    }
  ) {
    await this.getProductById(id);

    if (data.fileUrlId) {
      const file = await FileRepo.findById(data.fileUrlId);
      if (!file) throw fileNotFound();
    }

    const updateInput: Prisma.CosmeticProductUpdateInput = {
      name: data.name,
      brand: data.brand,
      details: data.details,
      hexColor: data.hexColor,
      type: data.type,
      category: data.category,
      priceAmount: data.priceAmount,
      priceUnit: data.priceUnit,
      tags: data.tags,
      benefits: data.benefits,
      spf: data.spf,
      waterproof: data.waterproof,
      transferProof: data.transferProof,
      hydrating: data.hydrating,
      oilFree: data.oilFree,
      finish: data.finish,
      metaData: data.metaData,
      // Explicit null clears the image link; undefined leaves it alone.
      ...(data.fileUrlId === null
        ? { fileUrl: { disconnect: true } }
        : data.fileUrlId
          ? { fileUrl: { connect: { id: data.fileUrlId } } }
          : {}),
    };

    return CosmeticProductRepo.update(id, updateInput);
  }

  static async deleteProduct(id: string) {
    await this.getProductById(id);
    await CosmeticProductRepo.delete(id);
    return { message: "Cosmetic product deleted successfully" };
  }
}
