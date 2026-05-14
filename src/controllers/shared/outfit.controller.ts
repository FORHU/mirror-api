import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import OutfitService from "../../services/shared/outfit.service";
import FileService from "../../services/shared/file.service";
import {
  assertNoDuplicateComposition,
  validateGarmentIds,
} from "../../validations/outfit.validation";
import logger from "../../utils/logger";
import { DESIGN_TYPE, FITTING_SLOT, LAYER_LEVEL } from "@prisma/client";

const validationError = (message: string) => ({ status: 400, message });

const outfitSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  items: Joi.array().items(
    Joi.object({
      garmentId: Joi.string().required(),
      slot: Joi.string().valid(...Object.values(FITTING_SLOT)).optional(),
      layerLevel: Joi.string().valid(...Object.values(LAYER_LEVEL)).optional(),
    })
  ).default([]),
  isPublic: Joi.boolean().optional().default(false),
  designType: Joi.string().valid(...Object.values(DESIGN_TYPE)).optional(),
  fileId: Joi.string().optional(),
  file: Joi.object().optional(), // Manual file metadata
});

export default class OutfitController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const data = await OutfitService.getUserOutfits(userId, req.query);
      const hydratedData = {
        ...data,
        data: await FileService.attachPresignedUrls(data.data)
      };
      res.json({ status: "success", data: hydratedData });
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const data = await OutfitService.getOutfitById(req.params.id, userId);
      const hydratedData = await FileService.attachPresignedUrls(data);
      res.json({ status: "success", data: hydratedData });
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
    const jsonFields = ['items', 'isPublic', 'designType', 'file'];
    jsonFields.forEach(field => {
      if (typeof cleaned[field] === 'string') {
        try {
          cleaned[field] = JSON.parse(cleaned[field]);
        } catch (e) {
          // If not valid JSON, leave as is
        }
      }
    });

    return cleaned;
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    const cleanedBody = OutfitController.prepareBody(req.body);
    const { error, value } = outfitSchema.validate(cleanedBody);
    if (error) return next(validationError(error.message));

    try {
      const finalValue = value;
      const userId = (req as any).user?.id;

      // Reject ambiguous input: caller sent both a multipart file and a fileId.
      if (req.file && finalValue.fileId) {
        return next(validationError("Provide either an uploaded file or a fileId, not both"));
      }

      // Reject non-image uploads up front so Sharp doesn't throw a 500 later.
      if (req.file && !req.file.mimetype?.startsWith("image/")) {
        return next(validationError("Uploaded file must be an image"));
      }

      // Validate garment ids + duplicate composition BEFORE uploading anything
      // to S3, otherwise a rejection downstream orphans the S3 object + File row.
      await validateGarmentIds(finalValue.items);
      await assertNoDuplicateComposition(userId, finalValue.items);

      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
      }

      const data = await OutfitService.createOutfit(userId, finalValue);
      const hydratedData = await FileService.attachPresignedUrls(data);
      logger.info(`Outfit created: ${data.id}`);
      res.status(201).json({ status: "success", data: hydratedData });
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const cleanedBody = OutfitController.prepareBody(req.body);
    const { error, value } = outfitSchema.validate(cleanedBody);
    if (error) return next(validationError(error.message));

    try {
      let finalValue = { ...value };
      const userId = (req as any).user?.id;

      // If a new physical file was uploaded, process it
      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
      }

      const data = await OutfitService.updateOutfit(req.params.id, userId, finalValue);
      const hydratedData = await FileService.attachPresignedUrls(data);
      res.json({ status: "success", data: hydratedData });
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const data = await OutfitService.deleteOutfit(req.params.id, userId);
      res.json({ status: "success", data });
    } catch (err) {
      next(err);
    }
  }
}
