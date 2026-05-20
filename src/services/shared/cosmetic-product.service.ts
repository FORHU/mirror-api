import CosmeticProductRepo from "../../repositories/cosmetic-product.repository";
import FileRepo from "../../repositories/file.repository";
import { COSMETIC_TYPE, Prisma } from "@prisma/client";

const fileNotFound = () => ({ status: 400, message: "Referenced file (fileUrlId) does not exist" });

export default class CosmeticProductService {
  static async getProducts(query: any) {
    const { page, limit, type, brand } = query;

    const filters: { type?: COSMETIC_TYPE; brand?: string } = {};
    if (type && (Object.values(COSMETIC_TYPE) as string[]).includes(type)) {
      filters.type = type as COSMETIC_TYPE;
    }
    if (typeof brand === "string" && brand.trim()) filters.brand = brand.trim();

    return CosmeticProductRepo.findAll(
      filters,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
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
    metaData?: any;
  }) {
    if (data.fileUrlId) {
      const file = await FileRepo.findById(data.fileUrlId);
      if (!file) throw fileNotFound();
    }

    const createInput: Prisma.CosmeticProductCreateInput = {
      name:     data.name,
      brand:    data.brand,
      details:  data.details,
      hexColor: data.hexColor,
      type:     data.type,
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
      metaData?: any;
    },
  ) {
    await this.getProductById(id);

    if (data.fileUrlId) {
      const file = await FileRepo.findById(data.fileUrlId);
      if (!file) throw fileNotFound();
    }

    const updateInput: Prisma.CosmeticProductUpdateInput = {
      name:     data.name,
      brand:    data.brand,
      details:  data.details,
      hexColor: data.hexColor,
      type:     data.type,
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
