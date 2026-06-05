import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import OutlineRepo from "../../repositories/outline.repository";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import { notifyCompanion } from "../../utils/socket.util";

const createSchema = Joi.object({
  userPrompt: Joi.array().items(Joi.string()).default([]),
  location: Joi.string().optional().allow(null, ""),
  latitude: Joi.number().optional(),
  longitude: Joi.number().optional(),
  startTime: Joi.date().iso().optional(),
});

export default class OutlineController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
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
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const active = await OutlineRepo.findActiveWithOverview(userId);
      return responseSuccess(res, 200, active ?? null);
    } catch (err) {
      next(err);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const outline = await OutlineRepo.findById(req.params.id);
      if (!outline || outline.userId !== userId)
        return responseError(res, 404, "Outline not found");
      return responseSuccess(res, 200, outline);
    } catch (err) {
      next(err);
    }
  }

  /**
   * EXTERNAL GET — used by 3rd party AI (ChatWonder) to read an outline via API Key.
   * Does not require a user JWT session.
   */
  static async externalGetById(req: Request, res: Response, next: NextFunction) {
    try {
      // Find the outline including its events so the AI can see the itinerary
      const outline = await OutlineRepo.findByIdWithEvents(req.params.id);
      if (!outline) return responseError(res, 404, "Outline not found");
      return responseSuccess(res, 200, outline);
    } catch (err) {
      next(err);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const outlines = await OutlineRepo.findByUserId(userId);
      return responseSuccess(res, 200, outlines);
    } catch (err) {
      next(err);
    }
  }

  /**
   * RESET — two modes (see ADR 0001):
   *   - No `scope` → full wipe: soft-delete all active outlines. Used by Restart.
   *   - `scope` = "fashion" | "cosmetic" | "itinerary" → scoped per-feature reset
   *     on the active outline, used by the per-screen Reset command.
   */
  static async reset(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    const scope = req.body?.scope as string | undefined;

    try {
      if (!scope) {
        const result = await OutlineRepo.softDeleteAllByUserId(userId);
        return responseSuccess(res, 200, { cleared: result.count }, "Outline reset");
      }

      if (!["fashion", "cosmetic", "itinerary"].includes(scope)) {
        return responseError(res, 400, "Invalid scope");
      }

      const outline = await OutlineRepo.findActiveWithEvents(userId);
      if (!outline) {
        return responseSuccess(res, 200, { cleared: 0, scope }, "No active outline");
      }

      let result: { count: number };
      if (scope === "fashion") {
        result = await OutlineRepo.clearFashionByOutlineId(outline.id);
      } else if (scope === "cosmetic") {
        result = await OutlineRepo.clearCosmeticsByOutlineId(outline.id);
      } else {
        result = await OutlineRepo.clearItineraryByOutlineId(outline.id);
      }

      return responseSuccess(res, 200, { cleared: result.count, scope }, `${scope} reset`);
    } catch (err) {
      next(err);
    }
  }

}
