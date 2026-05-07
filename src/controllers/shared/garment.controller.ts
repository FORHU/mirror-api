import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import GarmentService from "../../services/shared/garment.service";
import FileService from "../../services/shared/file.service";
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
      // 1. Parse JSON fields if they are strings (typical for form-data)
      let finalValue = { ...value };
      
      if (typeof req.body.file === 'string') {
        try { finalValue.file = JSON.parse(req.body.file); } catch (e) {}
      } else if (req.body.file) {
        finalValue.file = req.body.file;
      }

      if (typeof req.body.tags === 'string') {
        try { finalValue.tags = JSON.parse(req.body.tags); } catch (e) {}
      }

      // 2. If a physical file was uploaded, process it
      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
        finalValue.imageUrl = fileRecord.fileUrl;
      }

      const data = await GarmentService.createGarment(finalValue);
      res.status(201).json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const { error, value } = garmentSchema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      let finalValue = { ...value };

      if (typeof req.body.file === 'string') {
        try { finalValue.file = JSON.parse(req.body.file); } catch (e) {}
      }
      
      if (typeof req.body.tags === 'string') {
        try { finalValue.tags = JSON.parse(req.body.tags); } catch (e) {}
      }

      // If a new physical file was uploaded, process it
      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
        finalValue.imageUrl = fileRecord.fileUrl;
      }

      const data = await GarmentService.updateGarment(req.params.id, finalValue);
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
