import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import InteractionService from "../services/interaction.service";

const validationError = (message: string) => ({ status: 400, message });

const interactionSchema = Joi.object({
  message: Joi.string().required(),
  response: Joi.string().required(),
  intent: Joi.string().optional().allow(null, ""),
  outfitId: Joi.string().optional().allow(null, ""),
});

export default class InteractionController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const { outfitId } = req.query;
      if (!outfitId) {
        return res.status(400).json({ status: "error", message: "outfitId query param is required" });
      }
      const data = await InteractionService.getOutfitInteractions(outfitId as string, req.query);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const { error, value } = interactionSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await InteractionService.logInteraction(value);
      res.status(201).json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }
}
