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
      const outlines = await OutlineRepo.findByUserId(userId);
      // Most recent non-deleted outline is "active"
      const active = outlines.find((o) => !o.deletedAt) ?? null;
      return responseSuccess(res, 200, active);
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
   * RESET — clears the user's itinerary by soft-deleting all active outlines.
   * Used on page refresh so the user starts with a clean itinerary.
   */
  static async reset(req: Request, res: Response, next: NextFunction) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) return responseError(res, 401, "Unauthorized");

    try {
      const result = await OutlineRepo.softDeleteAllByUserId(userId);
      return responseSuccess(res, 200, { cleared: result.count }, "Itinerary reset");
    } catch (err) {
      next(err);
    }
  }

}
