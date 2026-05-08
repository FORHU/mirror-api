import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import GarmentService from "../../services/shared/garment.service";
import FileService from "../../services/shared/file.service";
import { GARMENT_TYPES, FITING_SLOTS, CATEGORY, GARMENT_GENDER, LAYER_LEVEL } from "@prisma/client";

const validationError = (message: string) => ({ status: 400, message });

const garmentSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  imageUrl: Joi.string().uri().optional(), // Now optional because it can be auto-set by the file upload
  garmentType: Joi.array().items(Joi.string().valid(...Object.values(GARMENT_TYPES))).optional(),
  fittingSlot: Joi.array().items(Joi.string().valid(...Object.values(FITING_SLOTS))).optional(),
  category: Joi.array().items(Joi.string().valid(...Object.values(CATEGORY))).optional(),
  gender: Joi.string().valid(...Object.values(GARMENT_GENDER)).optional(),
  layerLevel: Joi.string().valid(...Object.values(LAYER_LEVEL)).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  metaData: Joi.object().optional().allow(null),
  fileId: Joi.string().optional(),
  file: Joi.object().optional(), // Manual file metadata
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

  /**
   * Cleans and parses form-data into correct types
   */
  private static prepareBody(body: any) {
    const cleaned = { ...body };
    
    // Parse JSON strings from multipart form-data
    const jsonFields = ['garmentType', 'fittingSlot', 'category', 'tags', 'metaData', 'file'];
    jsonFields.forEach(field => {
      if (typeof cleaned[field] === 'string') {
        try {
          cleaned[field] = JSON.parse(cleaned[field]);
        } catch (e) {
          // If not valid JSON, leave as is (Joi will catch if it's wrong type)
        }
      }
    });

    return cleaned;
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const cleanedBody = GarmentController.prepareBody(req.body);
    const { error, value } = garmentSchema.validate(cleanedBody);
    if (error) return next(validationError(error.message));

    try {
      let finalValue = { ...value };

      // If a physical file was uploaded, process it
      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
        if (!finalValue.imageUrl) {
          finalValue.imageUrl = fileRecord.fileUrl;
        }
      }

      const data = await GarmentService.createGarment(finalValue);
      res.status(201).json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const cleanedBody = GarmentController.prepareBody(req.body);
    const { error, value } = garmentSchema.validate(cleanedBody);
    if (error) return next(validationError(error.message));

    try {
      let finalValue = { ...value };

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
