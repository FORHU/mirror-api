import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import CosmeticRecommendationService from "../../services/shared/cosmetic-recommendation.service";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

const createSchema = Joi.object({
  userOutlineId: Joi.string().required(),
  cosmeticProductId: Joi.string().required(),
  score: Joi.number().optional(),
  rank: Joi.number().integer().min(0).optional(),
  reason: Joi.string().optional().allow(null, ""),
  signals: Joi.object().optional().allow(null),
});

const updateSchema = Joi.object({
  cosmeticProductId: Joi.string().optional(),
  score: Joi.number().optional(),
  rank: Joi.number().integer().min(0).optional(),
  reason: Joi.string().optional().allow(null, ""),
  signals: Joi.object().optional().allow(null),
});

export default class CosmeticRecommendationController {
  /**
   * GET /cosmetic-recommendations?outlineId=...
   * Lists recommendations scoped to a specific outline (must belong to caller).
   */
  static async index(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const outlineId = typeof req.query.outlineId === "string" ? req.query.outlineId : null;
    if (!outlineId) return responseError(res, 400, "outlineId query parameter is required");

    try {
      const result = await CosmeticRecommendationService.listForOutline(
        outlineId as string,
        userId,
        req.query as unknown as Record<string, string | undefined>
      );
      return responseSuccess(res, 200, pageFromRepo(result));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const data = await CosmeticRecommendationService.getById(req.params.id, userId);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const { error, value } = createSchema.validate(req.body, { abortEarly: false });
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await CosmeticRecommendationService.create(value, userId);
      return responseSuccess(res, 201, data, "Cosmetic recommendation created");
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const { error, value } = updateSchema.validate(req.body, { abortEarly: false });
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await CosmeticRecommendationService.update(req.params.id, value, userId);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const data = await CosmeticRecommendationService.destroy(req.params.id, userId);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }
}
