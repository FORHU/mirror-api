import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import GarmentService from "../../services/shared/garment.service";
import { GarmentTypes, FittingSlots, Category, Gender, LayerLevel } from "@prisma/client";

const validationError = (message: string) => ({ status: 400, message });

const garmentSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  imageUrl: Joi.string().uri().required(),
  garmentType: Joi.string().valid(...Object.values(GarmentTypes)).optional(),
  fittingSlot: Joi.string().valid(...Object.values(FittingSlots)).optional(),
  category: Joi.string().valid(...Object.values(Category)).optional().allow(null),
  gender: Joi.string().valid(...Object.values(Gender)).optional(),
  layerLevel: Joi.string().valid(...Object.values(LayerLevel)).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  metaData: Joi.object().optional().allow(null),
  file: Joi.object({
    filename: Joi.string().optional(),
    originalName: Joi.string().optional(),
    fileUrl: Joi.string().uri().optional(),
    thumbnailUrl: Joi.string().uri().optional(),
    mimeType: Joi.string().optional(),
    extension: Joi.string().optional(),
    size: Joi.number().optional(),
    provider: Joi.string().optional(),
    bucket: Joi.string().optional(),
    path: Joi.string().optional(),
    metaData: Joi.object().optional(),
  }).optional(),
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
