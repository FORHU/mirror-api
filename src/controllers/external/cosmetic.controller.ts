import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import CosmeticProductService from "../../services/shared/cosmetic-product.service";
import CacheUtil from "../../utils/cache.util";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

/* eslint-disable @typescript-eslint/no-explicit-any */
const getIngredients = (metaData: any) => {
  if (Array.isArray(metaData)) return metaData;
  if (Array.isArray(metaData?.ingredients)) return metaData.ingredients;
  return [];
};

export const mapCosmeticForAI = (cosmetic: any) => ({
  id: cosmetic.id,
  name: cosmetic.name,
  brand: cosmetic.brand,
  details: cosmetic.details,
  type: cosmetic.type,
  category: cosmetic.category,
  hexColor: cosmetic.hexColor,
  finish: cosmetic.finish,
  benefits: cosmetic.benefits,
  tags: cosmetic.tags,
  ingredients: getIngredients(cosmetic.metaData),
  spf: cosmetic.spf,
  waterproof: cosmetic.waterproof,
  transferProof: cosmetic.transferProof,
  hydrating: cosmetic.hydrating,
  oilFree: cosmetic.oilFree,
  priceAmount: cosmetic.priceAmount,
  priceUnit: cosmetic.priceUnit,
  imageUrl: cosmetic.fileUrl ? cosmetic.fileUrl.fileUrl : null,
});

export default class ExternalCosmeticController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const queryStr = JSON.stringify(req.query, Object.keys(req.query).sort());
      const cacheKey = `external:cosmetics:index:${crypto.createHash("md5").update(queryStr).digest("hex")}`;

      const responseData = await CacheUtil.remember(cacheKey, 3600, async () => {
        const result = await CosmeticProductService.getProducts(
          req.query as unknown as Record<string, string | undefined | string[]>
        );
        return {
          ...result,
          data: result.data.map(mapCosmeticForAI),
        };
      });

      return responseSuccess(res, 200, pageFromRepo(responseData));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await CosmeticProductService.getProductById(req.params.id);
      if (!data) return responseError(res, 404, "Cosmetic product not found");
      return responseSuccess(res, 200, mapCosmeticForAI(data));
    } catch (err) {
      next(err);
    }
  }
}
