import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import OutlineRepo from "../../repositories/outline.repository";
import { responseSuccess, responseError } from "../../helpers/response.helper";

const createSchema = Joi.object({
  userPrompt: Joi.array().items(Joi.string()).default([]),
  location:   Joi.string().optional().allow(null, ""),
  latitude:   Joi.number().optional(),
  longitude:  Joi.number().optional(),
  startTime:  Joi.date().iso().optional(),
});

export default class OutlineController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const { error, value } = createSchema.validate(req.body, { abortEarly: false });
    if (error) return responseError(res, 400, error.message);

    try {
      const outline = await OutlineRepo.create({ userId, ...value });
      return responseSuccess(res, 201, outline, "Outline created");
    } catch (err) {
      next(err);
    }
  }

  static async getActive(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const outlines = await OutlineRepo.findByUserId(userId);
      // Most recent non-deleted outline is "active"
      const active = outlines.find((o) => !o.deletedAt) ?? null;
      return responseSuccess(res, 200, active);
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const outline = await OutlineRepo.findById(req.params.id);
      if (!outline || outline.userId !== userId) return responseError(res, 404, "Outline not found");
      return responseSuccess(res, 200, outline);
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const outlines = await OutlineRepo.findByUserId(userId);
      return responseSuccess(res, 200, outlines);
    } catch (err) {
      next(err);
    }
  }
}
