import { Request, Response, NextFunction } from "express";
import CosmeticProductService from "../../services/shared/cosmetic-product.service";
import { responseSuccess } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

/* eslint-disable @typescript-eslint/no-explicit-any */
const extractIngredients = (metaData: any) => {
  if (Array.isArray(metaData)) return metaData;
  if (Array.isArray(metaData?.ingredients)) return metaData.ingredients;
  return [];
};

export const mapCosmeticProductForAI = (product: any) => ({
  id: product.id,
  name: product.name,
  brand: product.brand,
  details: product.details,
  imageUrl: product.fileUrl?.fileUrl ?? null,
  category: product.category,
  type: product.type,
  tags: product.tags ?? [],
  benefits: product.benefits ?? [],
  ingredients: extractIngredients(product.metaData),
  spf: product.spf,
  waterproof: product.waterproof,
  transferProof: product.transferProof,
  hydrating: product.hydrating,
  oilFree: product.oilFree,
  finish: product.finish,
});

export default class ExternalCosmeticProductController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CosmeticProductService.getProducts(
        req.query as unknown as Record<string, string | string[] | undefined>
      );
      const responseData = {
        ...result,
        data: result.data.map(mapCosmeticProductForAI),
      };
      responseSuccess(res, 200, pageFromRepo(responseData));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await CosmeticProductService.getProductById(req.params.id);
      responseSuccess(res, 200, mapCosmeticProductForAI(data));
    } catch (err) {
      next(err);
    }
  }
}
