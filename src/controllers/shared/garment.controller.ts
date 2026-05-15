import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import GarmentService from "../../services/shared/garment.service";
import FileService from "../../services/shared/file.service";
import { evaluateGarmentImage } from "../../utils/openai/evaluate-garment.util";
import { emitToKiosk } from "../../utils/socket.util";
import logger from "../../utils/logger";
import { GARMENT_TYPES, FITTING_SLOT, CATEGORY, GARMENT_GENDER, LAYER_LEVEL, SILHOUETTE } from "@prisma/client";

const validationError = (message: string) => ({ status: 400, message });

const garmentSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  imageUrl: Joi.string().uri().optional(), // Now optional because it can be auto-set by the file upload
  garmentType: Joi.array().items(Joi.string().valid(...Object.values(GARMENT_TYPES))).optional(),
  fittingSlot: Joi.array().items(Joi.string().valid(...Object.values(FITTING_SLOT))).optional(),
  category: Joi.array().items(Joi.string().valid(...Object.values(CATEGORY))).optional(),
  gender: Joi.string().valid(...Object.values(GARMENT_GENDER)).optional(),
  layerLevel: Joi.string().valid(...Object.values(LAYER_LEVEL)).optional(),
  silhouette: Joi.string().valid(...Object.values(SILHOUETTE)).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  metaData: Joi.object().optional().allow(null),
  fileId: Joi.string().optional(),
  file: Joi.object().optional(), // Manual file metadata
});

// Validates the AI's classification against our Prisma enums before persisting.
const evaluationSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required().allow(""),
  garmentType: Joi.array().items(Joi.string().valid(...Object.values(GARMENT_TYPES))).min(1).required(),
  fittingSlot: Joi.array().items(Joi.string().valid(...Object.values(FITTING_SLOT))).min(1).required(),
  category: Joi.array().items(Joi.string().valid(...Object.values(CATEGORY))).min(1).required(),
  gender: Joi.string().valid(...Object.values(GARMENT_GENDER)).required(),
  layerLevel: Joi.string().valid(...Object.values(LAYER_LEVEL)).required(),
  silhouette: Joi.string().valid(...Object.values(SILHOUETTE)).required(),
  tags: Joi.array().items(Joi.string()).required(), // strings only
  dominantColor: Joi.string().optional().allow(null, ""),
});

export default class GarmentController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GarmentService.getGarments(req.query);
      const hydratedData = {
        ...data,
        data: await FileService.uploadFile(data.data)
      };
      res.json({ status: "success", data: hydratedData });
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GarmentService.getGarmentById(req.params.id);
      const hydratedData = await FileService.uploadFile(data);
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
      const hydratedData = await FileService.uploadFile(data);
      res.status(201).json({ status: "success", data: hydratedData });
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
      const hydratedData = await FileService.uploadFile(data);
      res.json({ status: "success", data: hydratedData });
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

  /**
   * POST /garments/evaluate
   * Authenticated. Accepts ONE image (`file`) or an `imageUrl`, optionally
   * a `kioskId` for websocket notifications.
   *
   * Flow:
   *  1. Uploads the file to S3 (fast).
   *  2. Responds immediately with 202 + the File record so the client can
   *     show a "processing" state.
   *  3. In the background: GPT-4o vision → Joi validation → persist Garment.
   *  4. Emits websocket events to the kiosk room when done or on failure.
   *
   * Websocket events (when `kioskId` is provided):
   *  - "garment_evaluated"  { fileId, garment }
   *  - "garment_failed"     { fileId, error }
   */
  static async evaluate(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return next({ status: 401, message: "Authentication required" });

      const imageUrl = req.body?.imageUrl;
      const kioskId = req.body?.kioskId;
      if (!req.file && !imageUrl) {
        return next(validationError("Provide either an uploaded `file` or an `imageUrl`"));
      }

      // Step 1: upload only — fast, blocks the response just long enough
      // for the client to know the upload itself succeeded.
      const { file: fileRecord, imageUrl: finalImageUrl } =
        await GarmentService.uploadGarmentFile(req.file, imageUrl);

      // Step 2: respond immediately. AI work continues below.
      res.status(202).json({
        status: "queued",
        data: {
          fileId: fileRecord?.id || null,
          imageUrl: finalImageUrl,
          kioskId: kioskId || null,
        },
        message: "Upload received. Evaluation in progress.",
      });

      // Step 3: background AI work — no await on the response path.
      (async () => {
        try {
          const evaluation = await evaluateGarmentImage(finalImageUrl);

          const { error, value } = evaluationSchema.validate(evaluation);
          if (error) throw new Error(`AI returned invalid evaluation: ${error.message}`);

          const garment = await GarmentService.persistEvaluatedGarment(
            value,
            fileRecord,
            finalImageUrl,
            userId,
          );

          const hydrated = await FileService.uploadFile(garment);
          logger.info(`[GarmentEvaluate] Completed garment ${garment.id} for user ${userId}`);

          if (kioskId) {
            emitToKiosk(kioskId, "garment_evaluated", {
              fileId: fileRecord?.id,
              garment: hydrated,
            });
          }
        } catch (err: any) {
          logger.error(`[GarmentEvaluate] Background failure: ${err.message}`);
          if (kioskId) {
            emitToKiosk(kioskId, "garment_failed", {
              fileId: fileRecord?.id,
              error: err.message,
            });
          }
        }
      })();
    } catch (err) {
      next(err);
    }
  }
}
