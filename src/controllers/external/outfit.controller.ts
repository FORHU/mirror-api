import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import OutfitService from "../../services/shared/outfit.service";
import CacheUtil from "../../utils/cache.util";
import { responseSuccess } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";
import { mapGarmentForAI } from "./garment.controller";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapOutfitForAI = (outfit: any) => ({
  id: outfit.id,
  name: outfit.name,
  description: outfit.description,
  isPublic: outfit.isPublic,
  designType: outfit.designType,
  imageUrl: outfit.file?.fileUrl,
  items:
    outfit.items?.map((item: any) => ({
      slot: item.slot,
      layerLevel: item.layerLevel,
      garment: item.garment ? mapGarmentForAI(item.garment) : null,
    })) || [],
});

export default class ExternalOutfitController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.query.userId as string | undefined;
      const queryStr = JSON.stringify(req.query, Object.keys(req.query).sort());
      const cacheKey = `external:outfits:index:${crypto.createHash("md5").update(queryStr).digest("hex")}`;

      const result = await CacheUtil.remember(cacheKey, 3600, async () =>
        OutfitService.getUserOutfits(userId, req.query as unknown as Record<string, string | undefined>)
      );

      const responseData = {
        ...result,
        data: result.data.map(mapOutfitForAI),
      };
      responseSuccess(res, 200, pageFromRepo(responseData));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const cacheKey = `external:outfits:show:${req.params.id}`;
      const data = await CacheUtil.remember(cacheKey, 3600, async () => {
        // 3rd party bypasses userId check
        return OutfitService.getOutfitById(req.params.id);
      });
      responseSuccess(res, 200, mapOutfitForAI(data));
    } catch (err) {
      next(err);
    }
  }
}
