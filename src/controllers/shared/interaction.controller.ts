import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import InteractionService from "../../services/shared/interaction.service";
import { responseSuccess, responseError } from "../../helpers/response.helper";

const validationError = (message: string) => ({ status: 400, message });

const interactionSchema = Joi.object({
  type: Joi.string().required(),
  garmentId: Joi.string().required(),
  outfitId: Joi.string().optional().allow(null, ""),
});

export default class InteractionController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const { outfitId } = req.query;
      if (!outfitId) {
        return responseError(res, 400, "outfitId query param is required");
      }
      const data = await InteractionService.getOutfitInteractions(outfitId as string, req.query);
      responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const { error, value } = interactionSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await InteractionService.logInteraction(value);
      responseSuccess(res, 201, data);
    } catch (err) {
      next(err);
    }
  }
}
