import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import GenerationService from "../../services/shared/generation.service";

const validationError = (message: string) => ({ status: 400, message });

const generationSchema = Joi.object({
  userPrompt: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ).required(),
  location: Joi.string().optional(),
  startTime: Joi.date().optional(),
  weather: Joi.object().optional(),
});

export default class GenerationController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    const { error, value } = generationSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user?.id;

      // Normalize userPrompt to array
      const userPrompt = Array.isArray(value.userPrompt) ? value.userPrompt : [value.userPrompt];

      const data = await GenerationService.generateOutfit({
        ...value,
        userId,
        userPrompt,
      });

      res.status(201).json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }
}
