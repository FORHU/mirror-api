import { Request, Response, NextFunction } from "express";
import GarmentService from "../../services/shared/garment.service";
import { responseSuccess } from "../../helpers/response.helper";
import { pageFromRepo } from "../../helpers/pagination.helper";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const mapGarmentForAI = (garment: any) => ({
  id: garment.id,
  name: garment.name,
  description: garment.description,
  imageUrl: garment.imageUrl,
  garmentType: garment.garmentType,
  fittingSlot: garment.fittingSlot,
  category: garment.category,
  gender: garment.gender,
  layerLevel: garment.layerLevel,
  silhouette: garment.silhouette,
  tags: garment.tags?.map((t: any) => t.name) || [],
});

export default class ExternalGarmentController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await GarmentService.getGarments(
        req.query as unknown as Record<string, string | string[] | undefined>
      );
      const responseData = {
        ...result,
        data: result.data.map(mapGarmentForAI),
      };
      responseSuccess(res, 200, pageFromRepo(responseData));
    } catch (err) {
      next(err);
    }
  }

  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await GarmentService.getGarmentById(req.params.id);
      responseSuccess(res, 200, mapGarmentForAI(data));
    } catch (err) {
      next(err);
    }
  }
}
