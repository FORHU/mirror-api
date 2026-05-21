import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import OutfitService from "../../services/shared/outfit.service";
import FileService from "../../services/shared/file.service";
import { findExistingComposition, validateGarmentIds } from "../../validations/outfit.validation";
import {
  evaluateOutfitImage,
  composeOutfitFromWardrobe,
  matchOutfitToWardrobe,
  GENERABLE_FIELDS,
  GenerableField,
} from "../../utils/openai/evaluate-outfit.util";
import { emitToKiosk } from "../../utils/socket.util";
import logger from "../../utils/logger";
import { CATEGORY, DESIGN_TYPE, FITTING_SLOT, GARMENT_GENDER, LAYER_LEVEL } from "@prisma/client";
import { responseSuccess } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

const validationError = (message: string) => ({ status: 400, message });
const unauthorizedError = () => ({ status: 401, message: "Authentication required" });

const itemSchema = Joi.object({
  garmentId: Joi.string().required(),
  slot: Joi.string()
    .valid(...Object.values(FITTING_SLOT))
    .optional(),
  layerLevel: Joi.string()
    .valid(...Object.values(LAYER_LEVEL))
    .optional(),
});

const outfitSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  items: Joi.array().items(itemSchema).default([]),
  isPublic: Joi.boolean().optional().default(false),
  designType: Joi.string()
    .valid(...Object.values(DESIGN_TYPE))
    .optional(),
  fileId: Joi.string().optional(),
  file: Joi.object().optional(), // Manual file metadata
});

// PATCH variant: every field optional, no defaults. `items` is only touched
// when the caller explicitly sends it — otherwise the repo leaves the
// composition alone. Sending `items: []` is still treated as "clear".
const outfitUpdateSchema = Joi.object({
  name: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  items: Joi.array().items(itemSchema).optional(),
  isPublic: Joi.boolean().optional(),
  designType: Joi.string()
    .valid(...Object.values(DESIGN_TYPE))
    .optional(),
  fileId: Joi.string().optional(),
  file: Joi.object().optional(),
});

// Shared "AI passthrough" fields the caller can pre-fill on the AI flows.
// Whatever's supplied here is honored verbatim by `pickProvided`.
const aiProvidedFields = {
  name: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  designType: Joi.string()
    .valid(...Object.values(DESIGN_TYPE))
    .optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  dominantColor: Joi.string().optional(),
  generate: Joi.array()
    .items(Joi.string().valid(...GENERABLE_FIELDS))
    .optional(),
  prompt: Joi.string().max(500).optional().allow(""),
  imageUrl: Joi.string().uri().optional(),
  kioskId: Joi.string().optional().allow(null, ""),
};

const evaluateSchema = Joi.object({
  ...aiProvidedFields,
  items: Joi.array().items(itemSchema).default([]),
});

const evaluateHybridSchema = Joi.object({
  ...aiProvidedFields,
});

export default class OutfitController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const result = await OutfitService.getUserOutfits(
        userId,
        req.query as unknown as Record<string, string | undefined>
      );
      responseSuccess(res, 200, pageFromRepo(result));
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /outfits/needs-image
   * Outfits whose display image is still the EXTERNAL placeholder borrowed
   * from a garment. These are the rows a dev/admin needs to PATCH with a
   * real upload.
   */
  static async indexNeedingImage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const result = await OutfitService.getOutfitsNeedingImage(
        userId,
        req.query as unknown as Record<string, string | undefined>
      );
      responseSuccess(res, 200, pageFromRepo(result));
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /outfits/complete
   * Outfits with a real uploaded display image (non-EXTERNAL provider).
   * Safe to surface to end users.
   */
  static async indexComplete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const result = await OutfitService.getOutfitsWithUploadedImage(
        userId,
        req.query as unknown as Record<string, string | undefined>
      );
      responseSuccess(res, 200, pageFromRepo(result));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const data = await OutfitService.getOutfitById(req.params.id, userId);
      responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Cleans and parses form-data into correct types.
   *
   * Split into two buckets:
   *   - `strictJsonFields` — arrays/objects that have no raw-string form.
   *     A parse failure here is always a client mistake, so we throw a 400
   *     directly rather than letting Joi report a misleading "X must be an
   *     array" downstream.
   *   - `lenientJsonFields` — enum/boolean values that may arrive raw via
   *     multipart form encoding. Try JSON, fall back to raw, let Joi coerce.
   */
  private static prepareBody(body: Record<string, unknown>) {
    const cleaned = { ...body } as Record<string, unknown>;

    const strictJsonFields = ["items", "file", "tags", "generate"];
    for (const field of strictJsonFields) {
      if (typeof cleaned[field] === "string") {
        try {
          cleaned[field] = JSON.parse(cleaned[field]);
        } catch (e) {
          throw {
            status: 400,
            message: `Field "${field}" is not valid JSON: ${(e as Error).message}`,
          };
        }
      }
    }

    const lenientJsonFields = ["isPublic", "designType"];
    for (const field of lenientJsonFields) {
      if (typeof cleaned[field] === "string") {
        try {
          cleaned[field] = JSON.parse(cleaned[field]);
        } catch {
          // Intentional: leave raw string for Joi to validate/coerce.
        }
      }
    }

    return cleaned;
  }

  /**
   * Extract the descriptive fields the caller may pre-fill on the AI flows.
   * Whatever the caller provides here passes through verbatim — the AI is
   * not asked to regenerate it.
   */
  private static pickProvided(cleaned: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    if (typeof cleaned.name === "string" && cleaned.name.trim()) out.name = cleaned.name.trim();
    if (typeof cleaned.description === "string" && cleaned.description.trim())
      out.description = cleaned.description.trim();
    if (typeof cleaned.designType === "string" && cleaned.designType.trim())
      out.designType = cleaned.designType.trim();
    if (Array.isArray(cleaned.tags)) {
      const tags = (cleaned.tags as unknown[]).filter((t) => typeof t === "string");
      if (tags.length) out.tags = tags;
    }
    if (typeof cleaned.dominantColor === "string" && cleaned.dominantColor.trim())
      out.dominantColor = cleaned.dominantColor.trim();
    return out;
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const cleanedBody = OutfitController.prepareBody(req.body);
      const { error, value } = outfitSchema.validate(cleanedBody);
      if (error) return next(validationError(error.message));

      const finalValue = value;
      const userId = (req as Request & { user?: { id: string } }).user?.id;

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
        logger.info(`Outfit reused (same composition): ${existing.id}`);
        return responseSuccess(res, 200, existing);
      }

      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
      }

      const data = await OutfitService.createOutfit(userId, finalValue);
      logger.info(`Outfit created: ${data.id}`);
      responseSuccess(res, 201, data);
    } catch (err) {
      next(err);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const cleanedBody = OutfitController.prepareBody(req.body);
      const { error, value } = outfitUpdateSchema.validate(cleanedBody);
      if (error) return next(validationError(error.message));

      const finalValue = { ...value };
      const userId = (req as Request & { user?: { id: string } }).user?.id;

      // Match `create`'s guards: ambiguous input + non-image upload would
      // otherwise reach Sharp and surface as a 500.
      if (req.file && finalValue.fileId) {
        return next(validationError("Provide either an uploaded file or a fileId, not both"));
      }
      if (req.file && !req.file.mimetype?.startsWith("image/")) {
        return next(validationError("Uploaded file must be an image"));
      }

      // Validate garment ids BEFORE uploading anything to S3. Only when the
      // caller is actually replacing the composition — undefined means "leave
      // items alone" under the PATCH schema.
      if (finalValue.items) {
        await validateGarmentIds(finalValue.items);
      }

      if (req.file) {
        const manualFileSpecs = finalValue.file || {};
        const fileRecord = await FileService.uploadFile(req.file, manualFileSpecs.metaData);
        finalValue.fileId = fileRecord.id;
      }

      const data = await OutfitService.updateOutfit(req.params.id, userId, finalValue);
      responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const data = await OutfitService.deleteOutfit(req.params.id, userId);
      responseSuccess(res, 200, data);
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
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) return next(unauthorizedError());

      const cleaned = OutfitController.prepareBody(req.body);
      const { error, value } = evaluateSchema.validate(cleaned);
      if (error) return next(validationError(error.message));

      const { imageUrl, kioskId, prompt, items } = value;
      const provided = OutfitController.pickProvided(value);
      const generate: GenerableField[] = Array.isArray(value.generate) ? value.generate : [];
      // Default authenticated callers to UserDesign unless they supplied a
      // designType or asked the AI to generate one.
      if (!provided.designType && !generate.includes("designType")) {
        provided.designType = "UserDesign";
      }
      // Explicit caller-supplied fields win over `generate`: strip any keys
      // the caller already pinned so we don't ask the AI to regenerate
      // something it would be silently overridden on anyway.
      const providedKeys = new Set(Object.keys(provided));
      const effectiveGenerate = generate.filter((f) => !providedKeys.has(f));

      if (!req.file && !imageUrl) {
        return next(validationError("Provide either an uploaded `file` or an `imageUrl`"));
      }
      if (req.file && !req.file.mimetype?.startsWith("image/")) {
        return next(validationError("Uploaded file must be an image"));
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
        if (kioskId)
          emitToKiosk(kioskId, "outfit_evaluated", {
            fileId: null,
            outfit: existing,
            reused: true,
          });
        return responseSuccess(res, 200, existing);
      }

      const { file: fileRecord, imageUrl: finalImageUrl } = await OutfitService.uploadOutfitFile(
        req.file as Express.Multer.File,
        imageUrl
      );

      responseSuccess(
        res,
        202,
        {
          fileId: fileRecord?.id || null,
          imageUrl: finalImageUrl,
          kioskId: kioskId || null,
        },
        "Upload received. Outfit evaluation in progress."
      );

      const garmentIds = items.map((i: { garmentId: string }) => i.garmentId).filter(Boolean);

      (async () => {
        try {
          // Load the authoritative garment data so the AI can ground its
          // name/description/tags in what's actually in the outfit, rather
          // than guessing from pixels alone. Done inside the IIFE so a DB
          // hiccup can't blow up after the 202 has already been sent.
          const garmentContext = await OutfitService.loadGarmentsForAI(garmentIds);
          const evaluation = await evaluateOutfitImage({
            imageUrl: finalImageUrl,
            garments: garmentContext,
            userPrompt: prompt,
            provided,
            generate: effectiveGenerate,
          });
          const outfit = await OutfitService.persistEvaluatedOutfit(
            evaluation,
            fileRecord,
            userId,
            items
          );
          logger.info(`[OutfitEvaluate] Completed outfit ${outfit.id} for user ${userId}`);
          if (kioskId) emitToKiosk(kioskId, "outfit_evaluated", { fileId: fileRecord?.id, outfit });
        } catch (err) {
          logger.error(`[OutfitEvaluate] Background failure: ${(err as Error).message}`);
          // Clean up the just-uploaded image so we don't accumulate orphans.
          await OutfitService.discardOrphanedFile(fileRecord as unknown as Record<string, unknown>);
          if (kioskId)
            emitToKiosk(kioskId, "outfit_failed", {
              fileId: fileRecord?.id,
              error: (err as Error).message,
            });
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
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) return next(unauthorizedError());

      const schema = Joi.object({
        prompt: Joi.string().min(2).max(500).required(),
        kioskId: Joi.string().optional().allow(null, ""),
      });
      const { error, value } = schema.validate(req.body);
      if (error) return next(validationError(error.message));

      const { prompt, kioskId } = value;

      responseSuccess(res, 202, { kioskId: kioskId || null }, "Composing outfit from wardrobe.");

      (async () => {
        try {
          const wardrobe = await OutfitService.loadWardrobeForAI(userId);
          const composition = await composeOutfitFromWardrobe(wardrobe, prompt);
          const outfit = await OutfitService.persistComposedOutfit(composition, userId);
          logger.info(`[OutfitCompose] Completed outfit ${outfit.id} for user ${userId}`);
          if (kioskId) emitToKiosk(kioskId, "outfit_composed", { outfit });
        } catch (err) {
          logger.error(`[OutfitCompose] Background failure: ${(err as Error).message}`);
          if (kioskId)
            emitToKiosk(kioskId, "outfit_compose_failed", { error: (err as Error).message });
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
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) return next(unauthorizedError());

      const cleaned = OutfitController.prepareBody(req.body);
      const { error, value } = evaluateHybridSchema.validate(cleaned);
      if (error) return next(validationError(error.message));

      const { imageUrl, kioskId, prompt } = value;
      const provided = OutfitController.pickProvided(value);
      const generate: GenerableField[] = Array.isArray(value.generate) ? value.generate : [];
      if (!provided.designType && !generate.includes("designType")) {
        provided.designType = "UserDesign";
      }
      // Same precedence rule as `evaluate`: pinned values win over `generate`.
      const providedKeys = new Set(Object.keys(provided));
      const effectiveGenerate = generate.filter((f) => !providedKeys.has(f));

      if (!req.file && !imageUrl) {
        return next(validationError("Provide either an uploaded `file` or an `imageUrl`"));
      }
      if (req.file && !req.file.mimetype?.startsWith("image/")) {
        return next(validationError("Uploaded file must be an image"));
      }

      const { file: fileRecord, imageUrl: finalImageUrl } = await OutfitService.uploadOutfitFile(
        req.file as Express.Multer.File,
        imageUrl
      );

      responseSuccess(
        res,
        202,
        {
          fileId: fileRecord?.id || null,
          imageUrl: finalImageUrl,
          kioskId: kioskId || null,
        },
        "Upload received. Hybrid outfit match in progress."
      );

      (async () => {
        try {
          const wardrobe = await OutfitService.loadWardrobeForAI(userId);
          const match = await matchOutfitToWardrobe({
            imageUrl: finalImageUrl,
            wardrobe,
            userPrompt: prompt,
            provided,
            generate: effectiveGenerate,
          });
          const outfit = await OutfitService.persistMatchedOutfit(match, fileRecord, userId);
          logger.info(
            `[OutfitMatch] Completed outfit ${outfit.id} for user ${userId} (unmatched: ${match.unmatchedDescriptions.length})`
          );
          if (kioskId) {
            emitToKiosk(kioskId, "outfit_matched", {
              fileId: fileRecord?.id,
              outfit,
              unmatched: match.unmatchedDescriptions,
            });
          }
        } catch (err) {
          logger.error(`[OutfitMatch] Background failure: ${(err as Error).message}`);
          // Mirror `evaluate`: clean up the orphaned S3 upload so failed
          // hybrid matches don't accumulate File rows + objects.
          await OutfitService.discardOrphanedFile(fileRecord as unknown as Record<string, unknown>);
          if (kioskId)
            emitToKiosk(kioskId, "outfit_match_failed", {
              fileId: fileRecord?.id,
              error: (err as Error).message,
            });
        }
      })();
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /outfits/recommend
   * Rule-based, deterministic-ish outfit composer. No AI. Picks garments
   * from the wardrobe by CATEGORY (and optional GENDER). Always synchronous
   * — there's no model call to wait on. Caller re-hits the endpoint to
   * reshuffle.
   */
  static async recommend(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) return next(unauthorizedError());

      const schema = Joi.object({
        category: Joi.string()
          .valid(...Object.values(CATEGORY))
          .required(),
        gender: Joi.string()
          .valid(...Object.values(GARMENT_GENDER))
          .optional(),
        name: Joi.string().optional().allow(null, ""),
        description: Joi.string().optional().allow(null, ""),
        kioskId: Joi.string().optional().allow(null, ""),
      });
      const { error, value } = schema.validate(req.body);
      if (error) return next(validationError(error.message));

      const outfit = await OutfitService.recommendOutfit({
        category: value.category,
        gender: value.gender,
        name: value.name,
        description: value.description,
        userId,
      });

      if (value.kioskId) emitToKiosk(value.kioskId, "outfit_recommended", { outfit });
      logger.info(`[OutfitRecommend] Created outfit ${outfit.id} from category ${value.category}`);

      responseSuccess(res, 201, outfit);
    } catch (err) {
      next(err);
    }
  }
}
