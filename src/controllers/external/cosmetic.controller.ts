import { Request, Response, NextFunction } from "express";
import CosmeticProductService from "../../services/shared/cosmetic-product.service";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const mapCosmeticForAI = (cosmetic: any) => ({
  id: cosmetic.id,
  name: cosmetic.name,
  brand: cosmetic.brand,
  type: cosmetic.type,
  category: cosmetic.category,
  hexColor: cosmetic.hexColor,
  finish: cosmetic.finish,
  benefits: cosmetic.benefits,
  tags: cosmetic.tags,
  priceAmount: cosmetic.priceAmount,
  priceUnit: cosmetic.priceUnit,
  imageUrl: cosmetic.fileUrl ? cosmetic.fileUrl.url : null,
});

export default class ExternalCosmeticController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await CosmeticProductService.getProducts(
        req.query as unknown as Record<string, string | undefined | string[]>
      );
      const responseData = {
        ...result,
        data: result.data.map(mapCosmeticForAI),
      };
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
