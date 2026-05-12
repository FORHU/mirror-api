import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { mapService } from "../../services/shared/map.service";

export default class MapController {
  /**
   * Search for locations using Mapbox Geocoding
   */
  static async search(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      q: Joi.string().required(),
      proximity: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.message });

    try {
      const results = await mapService.search(value.q, value.proximity);
      res.status(200).json({
        success: true,
        data: results,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get directions between two coordinates
   */
  static async getDirections(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      origin: Joi.string().required(), // Format: "lng,lat"
      destination: Joi.string().required(), // Format: "lng,lat"
      profile: Joi.string().valid("driving", "walking", "cycling").default("driving"),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.message });

    try {
      const directions = await mapService.getDirections(value.origin, value.destination, value.profile);
      res.status(200).json({
        success: true,
        data: directions,
      });
    } catch (err) {
      next(err);
    }
  }
}
