/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from "express";
// import Joi from "joi";
// import { mapService } from "../../services/shared/map.service";
// import { googlePlacesService } from "../../services/shared/google-places.service";
// import { PrismaClient } from "@prisma/client";
// import axios from "axios";
// import { MAPBOX_SECRET_TOKEN, ORS_API_KEY, GOOGLE_PLACES_API_KEY } from "../../config";
// import logger from "../../utils/logger";

// const prisma = new PrismaClient();

// ─── In-memory rate limiter for directions: 1 req per 5s per userId ───────────
// const directionsRateLimit = new Map<string, number>();
// const DIRECTIONS_RATE_MS = 5000;

// function isRateLimited(userId: string): boolean {
//   if (process.env.NODE_ENV === "development") return false;
//   const last = directionsRateLimit.get(userId);
//   const now = Date.now();
//   if (last && now - last < DIRECTIONS_RATE_MS) return true;
//   directionsRateLimit.set(userId, now);
//   return false;
// }

// interface DirectionsResponse {
//   geojson: Record<string, unknown>;
//   steps: {
//     instruction: string;
//     maneuver: { type: string; modifier: string };
//     distance: number;
//     duration: number;
//     name: string;
//   }[];
//   distance: number;
//   duration: number;
//   profile: string;
// }

// const ORS_PROFILES: Record<string, string> = {
//   motorcycle: "driving-car",
//   bicycle: "cycling-regular",
//   walking: "foot-walking",
// };

// const ORS_EXCLUSIONS: Record<string, Record<string, unknown>> = {
//   motorcycle: { avoid_features: ["highways", "tollways"] },
//   bicycle: {},
//   walking: {},
// };

// async function getMapboxDirections(origin, destination) { ... }
// async function getORSDirections(origin, destination, profile) { ... }
// function normalizeMapboxResponse(data) { ... }
// function normalizeORSResponse(data, profile) { ... }
// async function getDirections(origin, destination, profile) { ... }

export default class MapController {
  static async search(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async getDirections(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async geocode(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async directions(_req: Request, res: Response) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async nearbyPOIs(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async venuePhotos(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async photoProxy(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async getHomeLocation(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }

  static async updateHomeLocation(_req: Request, res: Response, _next: NextFunction) {
    return res.status(503).json({ error: "Map service disabled" });
  }
}
