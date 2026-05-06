import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import OutfitService from "../../services/shared/outfit.service";

const validationError = (message: string) => ({ status: 400, message });

const outfitSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  items: Joi.array().items(
    Joi.object({
      garmentId: Joi.string().required(),
      order: Joi.number().integer().default(0),
    })
  ).default([]),
});

export default class OutfitController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.id;
      const data = await OutfitService.getUserOutfits(userId, req.query);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.id;
      const data = await OutfitService.getOutfitById(req.params.id, userId);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const { error, value } = outfitSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const data = await OutfitService.createOutfit(userId, value);
      res.status(201).json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.id;
      const data = await OutfitService.deleteOutfit(req.params.id, userId);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }
}
