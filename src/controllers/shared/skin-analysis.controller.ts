import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import SkinAnalysisService from "../../services/shared/skin-analysis.service";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

const createSchema = Joi.object({
  fileId: Joi.string().required(),
  weatherSnapshotId: Joi.string().optional().allow(null, ""),
});

type AuthenticatedRequest = Request & { user?: { id: string } };

export default class SkinAnalysisController {
  static async index(req: Request, res: Response, next: NextFunction) {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const result = await SkinAnalysisService.listForUser(userId, req.query);
      return responseSuccess(res, 200, pageFromRepo(result));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const data = await SkinAnalysisService.getById(req.params.id, userId);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const { error, value } = createSchema.validate(req.body, { abortEarly: false });
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await SkinAnalysisService.create(value, userId);
      return responseSuccess(res, 201, data, "Skin analysis created");
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const data = await SkinAnalysisService.destroy(req.params.id, userId);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }
}
