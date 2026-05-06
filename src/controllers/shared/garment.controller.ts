import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import GarmentService from "../../services/shared/garment.service";
import { BodyPart, Category } from "@prisma/client";

const validationError = (message: string) => ({ status: 400, message });

const garmentSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  imageUrl: Joi.string().uri().required(),
  bodyPart: Joi.string().valid(...Object.values(BodyPart)).optional(),
  category: Joi.string().valid(...Object.values(Category)).optional().allow(null),
  colorName: Joi.string().optional().allow(null, ""),
  colorHex: Joi.string().optional().allow(null, ""),
  scaleFactor: Joi.number().optional(),
  zIndex: Joi.number().integer().optional(),
  tags: Joi.array().items(Joi.string()).optional(),
});

export default class GarmentController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GarmentService.getGarments(req.query);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GarmentService.getGarmentById(req.params.id);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const { error, value } = garmentSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await GarmentService.createGarment(value);
      res.status(201).json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const { error, value } = garmentSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await GarmentService.updateGarment(req.params.id, value);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GarmentService.deleteGarment(req.params.id);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }
}
