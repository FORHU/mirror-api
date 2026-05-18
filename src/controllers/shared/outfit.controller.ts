import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import OutfitService from "../../services/shared/outfit.service";
import FileService from "../../services/shared/file.service";
import {
  findExistingComposition,
  validateGarmentIds,
} from "../../validations/outfit.validation";
import {
  evaluateOutfitImage,
  composeOutfitFromWardrobe,
  matchOutfitToWardrobe,
} from "../../utils/openai/evaluate-outfit.util";
import { emitToKiosk } from "../../utils/socket.util";
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
        data: await FileService.uploadFile(data.data)
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

      // Validate garment ids BEFORE uploading anything to S3, otherwise a
      // rejection downstream orphans the S3 object + File row.
      await validateGarmentIds(finalValue.items);

      // Idempotency: if the same user already has an outfit with these exact
      // garments, return it instead of creating a duplicate. Skip the file
      // upload entirely so we don't orphan an S3 object either.
      const existing = await findExistingComposition(userId, finalValue.items);
      if (existing) {
        const hydratedExisting = await FileService.uploadFile(existing);
        logger.info(`Outfit reused (same composition): ${existing.id}`);
        return res.status(200).json({ status: "success", data: hydratedExisting });
      }

      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
      }

      const data = await OutfitService.createOutfit(userId, finalValue);
      const hydratedData = await FileService.uploadFile(data);
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
      const hydratedData = await FileService.uploadFile(data);
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

  /**
   * POST /outfits/evaluate
   * Image-only AI flow. Caller still owns the composition (`items[]`).
   *
   * Flow: upload image -> 202 -> background GPT-4o vision -> persist outfit
   *       -> emit "outfit_evaluated" / "outfit_failed" to the kiosk room.
   */
  static async evaluate(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return next({ status: 401, message: "Authentication required" });

      const cleaned = OutfitController.prepareBody(req.body);
      const imageUrl = cleaned.imageUrl;
      const kioskId = cleaned.kioskId;
      const items = Array.isArray(cleaned.items) ? cleaned.items : [];

      if (!req.file && !imageUrl) {
        return next(validationError("Provide either an uploaded `file` or an `imageUrl`"));
      }

      // Validate composition up-front so the AI work isn't wasted on a bad caller.
      await validateGarmentIds(items);

      // Idempotency: if this user already has an outfit with the same garment
      // set, return it directly. Skips both the S3 upload and the AI call so
      // we don't orphan a File row or burn an OpenAI request, and the kiosk
      // sees the canonical outfit (not a re-evaluation with potentially
      // different AI text).
      const existing = await findExistingComposition(userId, items);
      if (existing) {
        logger.info(`[OutfitEvaluate] Reused existing composition: ${existing.id}`);
        if (kioskId) emitToKiosk(kioskId, "outfit_evaluated", { fileId: null, outfit: existing, reused: true });
        return res.status(200).json({ status: "success", data: existing });
      }

      const { file: fileRecord, imageUrl: finalImageUrl } =
        await OutfitService.uploadOutfitFile(req.file, imageUrl);

      res.status(202).json({
        status: "queued",
        data: {
          fileId: fileRecord?.id || null,
          imageUrl: finalImageUrl,
          kioskId: kioskId || null,
        },
        message: "Upload received. Outfit evaluation in progress.",
      });

      const garmentIds = items.map((i: any) => i.garmentId).filter(Boolean);

      (async () => {
        try {
          // Load the authoritative garment data so the AI can ground its
          // name/description/tags in what's actually in the outfit, rather
          // than guessing from pixels alone. Done inside the IIFE so a DB
          // hiccup can't blow up after the 202 has already been sent.
          const garmentContext = await OutfitService.loadGarmentsForAI(garmentIds);
          const evaluation = await evaluateOutfitImage(finalImageUrl, garmentContext);
          const outfit = await OutfitService.persistEvaluatedOutfit(
            evaluation,
            fileRecord,
            userId,
            items,
          );
          logger.info(`[OutfitEvaluate] Completed outfit ${outfit.id} for user ${userId}`);
          if (kioskId) emitToKiosk(kioskId, "outfit_evaluated", { fileId: fileRecord?.id, outfit });
        } catch (err: any) {
          logger.error(`[OutfitEvaluate] Background failure: ${err.message}`);
          // Clean up the just-uploaded image so we don't accumulate orphans.
          await OutfitService.discardOrphanedFile(fileRecord);
          if (kioskId) emitToKiosk(kioskId, "outfit_failed", { fileId: fileRecord?.id, error: err.message });
        }
      })();
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /outfits/compose
   * Text-only AI flow. GPT picks garments from the user's wardrobe given a
   * free-text prompt (occasion, vibe, weather). No image upload.
   */
  static async compose(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return next({ status: 401, message: "Authentication required" });

      const schema = Joi.object({
        prompt: Joi.string().min(2).max(500).required(),
        kioskId: Joi.string().optional().allow(null, ""),
      });
      const { error, value } = schema.validate(req.body);
      if (error) return next(validationError(error.message));

      const { prompt, kioskId } = value;

      res.status(202).json({
        status: "queued",
        data: { kioskId: kioskId || null },
        message: "Composing outfit from wardrobe.",
      });

      (async () => {
        try {
          const wardrobe = await OutfitService.loadWardrobeForAI(userId);
          const composition = await composeOutfitFromWardrobe(wardrobe, prompt);
          const outfit = await OutfitService.persistComposedOutfit(composition, userId);
          logger.info(`[OutfitCompose] Completed outfit ${outfit.id} for user ${userId}`);
          if (kioskId) emitToKiosk(kioskId, "outfit_composed", { outfit });
        } catch (err: any) {
          logger.error(`[OutfitCompose] Background failure: ${err.message}`);
          if (kioskId) emitToKiosk(kioskId, "outfit_compose_failed", { error: err.message });
        }
      })();
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /outfits/evaluate-hybrid
   * Image + wardrobe-matching AI flow. Vision identifies garments in the
   * uploaded outfit photo and matches them to the user's wardrobe; items
   * with no match are returned as free-text descriptions.
   */
  static async evaluateHybrid(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return next({ status: 401, message: "Authentication required" });

      const cleaned = OutfitController.prepareBody(req.body);
      const imageUrl = cleaned.imageUrl;
      const kioskId = cleaned.kioskId;

      if (!req.file && !imageUrl) {
        return next(validationError("Provide either an uploaded `file` or an `imageUrl`"));
      }

      const { file: fileRecord, imageUrl: finalImageUrl } =
        await OutfitService.uploadOutfitFile(req.file, imageUrl);

      res.status(202).json({
        status: "queued",
        data: {
          fileId: fileRecord?.id || null,
          imageUrl: finalImageUrl,
          kioskId: kioskId || null,
        },
        message: "Upload received. Hybrid outfit match in progress.",
      });

      (async () => {
        try {
          const wardrobe = await OutfitService.loadWardrobeForAI(userId);
          const match = await matchOutfitToWardrobe(finalImageUrl, wardrobe);
          const outfit = await OutfitService.persistMatchedOutfit(match, fileRecord, userId);
          logger.info(`[OutfitMatch] Completed outfit ${outfit.id} for user ${userId} (unmatched: ${match.unmatchedDescriptions.length})`);
          if (kioskId) {
            emitToKiosk(kioskId, "outfit_matched", {
              fileId: fileRecord?.id,
              outfit,
              unmatched: match.unmatchedDescriptions,
            });
          }
        } catch (err: any) {
          logger.error(`[OutfitMatch] Background failure: ${err.message}`);
          if (kioskId) emitToKiosk(kioskId, "outfit_match_failed", { fileId: fileRecord?.id, error: err.message });
        }
      })();
    } catch (err) {
      next(err);
    }
  }
}
