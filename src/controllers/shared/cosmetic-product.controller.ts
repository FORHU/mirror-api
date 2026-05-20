import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { COSMETIC_TYPE } from "@prisma/client";
import CosmeticProductService from "../../services/shared/cosmetic-product.service";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

const createSchema = Joi.object({
  name:       Joi.string().required(),
  brand:      Joi.string().optional().allow(null, ""),
  details:    Joi.string().optional().allow(null, ""),
  fileUrlId: Joi.string().optional().allow(null, ""),
  hexColor:   Joi.string().pattern(/^#?[0-9a-fA-F]{3,8}$/).optional().allow(null, ""),
  type:       Joi.string().valid(...Object.values(COSMETIC_TYPE)).optional(),
  metaData:   Joi.object().optional().allow(null),
});

// PATCH: every field optional. `cosmeticId: null` clears the image link;
// omit the field entirely to leave it alone.
const updateSchema = Joi.object({
  name:       Joi.string().optional(),
  brand:      Joi.string().optional().allow(null, ""),
  details:    Joi.string().optional().allow(null, ""),
  cosmeticId: Joi.string().optional().allow(null),
  hexColor:   Joi.string().pattern(/^#?[0-9a-fA-F]{3,8}$/).optional().allow(null, ""),
  type:       Joi.string().valid(...Object.values(COSMETIC_TYPE)).optional(),
  metaData:   Joi.object().optional().allow(null),
});

export default class CosmeticProductController {
  static async index(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const result = await CosmeticProductService.getProducts(req.query);
      return responseSuccess(res, 200, pageFromRepo(result));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const data = await CosmeticProductService.getProductById(req.params.id);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const { error, value } = createSchema.validate(req.body, { abortEarly: false });
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await CosmeticProductService.createProduct(value);
      return responseSuccess(res, 201, data, "Cosmetic product created");
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const { error, value } = updateSchema.validate(req.body, { abortEarly: false });
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await CosmeticProductService.updateProduct(req.params.id, value);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const data = await CosmeticProductService.deleteProduct(req.params.id);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }
}
