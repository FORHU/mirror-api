/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { mapService } from "../../services/shared/map.service";
import { foursquareService } from "../../services/shared/foursquare.service";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { MAPBOX_SECRET_TOKEN, ORS_API_KEY } from "../../config";
import logger from "../../utils/logger";

const prisma = new PrismaClient();

// ─── In-memory rate limiter for directions: 1 req per 5s per userId ───────────
const directionsRateLimit = new Map<string, number>();
const DIRECTIONS_RATE_MS = 5000;

function isRateLimited(userId: string): boolean {
  // DEV BYPASS: Disable rate limiting in development
  if (process.env.NODE_ENV === "development") return false;

  const last = directionsRateLimit.get(userId);
  const now = Date.now();
  if (last && now - last < DIRECTIONS_RATE_MS) return true;
  directionsRateLimit.set(userId, now);
  return false;
}

interface DirectionsResponse {
  geojson: Record<string, unknown>;
  steps: {
    instruction: string;
    maneuver: {
      type: string;
      modifier: string;
    };
    distance: number;
    duration: number;
    name: string;
  }[];
  distance: number;
  duration: number;
  profile: string;
}

const ORS_PROFILES: Record<string, string> = {
  motorcycle: "driving-car",
  bicycle: "cycling-regular",
  walking: "foot-walking",
};

const ORS_EXCLUSIONS: Record<string, Record<string, unknown>> = {
  motorcycle: { avoid_features: ["highways", "tollways"] },
  bicycle: {},
  walking: {},
};

async function getMapboxDirections(
  origin: [number, number],
  destination: [number, number]
): Promise<DirectionsResponse> {
  const baseUrl = `https://api.mapbox.com/directions/v5/mapbox`;
  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const params = `?access_token=${MAPBOX_SECRET_TOKEN}&geometries=geojson&steps=true&overview=full&annotations=duration,distance`;

  try {
    const response = await axios.get(`${baseUrl}/driving-traffic/${coords}${params}`);
    return normalizeMapboxResponse(response.data);
  } catch (err) {
    // If driving-traffic is forbidden (403), fallback to standard driving
    if ((err as { response?: { status?: number } }).response?.status === 403) {
      logger.warn("Mapbox driving-traffic forbidden, falling back to standard driving");
      const response = await axios.get(`${baseUrl}/driving/${coords}${params}`);
      return normalizeMapboxResponse(response.data);
    }
    throw err;
  }
}

async function getORSDirections(
  origin: [number, number],
  destination: [number, number],
  profile: "motorcycle" | "bicycle" | "walking"
): Promise<DirectionsResponse> {
  if (!ORS_API_KEY || ORS_API_KEY === "your_openrouteservice_api_key") {
    throw new Error("ORS_KEY_MISSING");
  }

  const orsProfile = ORS_PROFILES[profile];
  const exclusions = ORS_EXCLUSIONS[profile];

  const url = `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`;

  const body = {
    coordinates: [origin, destination],
    instructions: true,
    instructions_format: "text",
    language: "en",
    units: "m",
    options: Object.keys(exclusions).length ? exclusions : undefined,
  };

  const response = await axios.post(url, body, {
    headers: {
      Authorization: ORS_API_KEY,
      "Content-Type": "application/json",
    },
  });

  const data = response.data;

  if (!data.features?.length) throw new Error("NO_ROUTE");

  return normalizeORSResponse(data, profile);
}

function normalizeMapboxResponse(data: Record<string, unknown>): DirectionsResponse {
  const route = (data.routes as any[])[0];
  const steps = (route as { legs: Array<{ steps: Array<any> }> }).legs[0].steps.map(
    (step: any) => ({
      instruction: step.maneuver.instruction as string,
      maneuver: {
        type: step.maneuver.type as string,
        modifier: (step.maneuver.modifier as string) ?? "straight",
      },
      distance: step.distance as number,
      duration: step.duration as number,
      name: (step.name as string) ?? "",
    })
  );
  return {
    geojson: {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: route.geometry, properties: {} }],
    },
    steps,
    distance: route.distance,
    duration: route.duration,
    profile: "car",
  };
}

function normalizeORSResponse(data: Record<string, unknown>, profile: string): DirectionsResponse {
  const feature = (data.features as any[])[0];
  const segments = feature.properties.segments[0];

  const steps = (segments as { steps: Array<any> }).steps.map((step: any) => {
    const modifierMap: Record<number, { type: string; modifier: string }> = {
      0: { type: "turn", modifier: "left" },
      1: { type: "turn", modifier: "right" },
      2: { type: "turn", modifier: "sharp left" },
      3: { type: "turn", modifier: "sharp right" },
      4: { type: "turn", modifier: "slight left" },
      5: { type: "turn", modifier: "slight right" },
      6: { type: "depart", modifier: "straight" },
      7: { type: "arrive", modifier: "straight" },
      8: { type: "continue", modifier: "straight" },
      10: { type: "roundabout", modifier: "right" },
      11: { type: "uturn", modifier: "uturn" },
    };

    return {
      instruction: step.instruction as string,
      maneuver: modifierMap[step.type as number] ?? { type: "continue", modifier: "straight" },
      distance: step.distance as number,
      duration: step.duration as number,
      name: (step.name as string) ?? "",
    };
  });

  return {
    geojson: {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: feature.geometry, properties: {} }],
    },
    steps,
    distance: feature.properties.summary.distance,
    duration: feature.properties.summary.duration,
    profile,
  };
}

async function getDirections(
  origin: [number, number],
  destination: [number, number],
  profile: "car" | "motorcycle" | "bicycle" | "walking"
) {
  if (profile === "car") {
    return getMapboxDirections(origin, destination);
  } else {
    return getORSDirections(origin, destination, profile as "motorcycle" | "bicycle" | "walking");
  }
}

export default class MapController {
  /**
   * Search for locations using Mapbox Geocoding (legacy GET — kept for mirror-app compatibility)
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
      res.status(200).json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Legacy GET directions (kept for mirror-app)
   */
  static async getDirections(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      origin: Joi.string().required(),
      destination: Joi.string().required(),
      profile: Joi.string().valid("driving", "walking", "cycling").default("driving"),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.message });

    try {
      const directions = await mapService.getDirections(
        value.origin,
        value.destination,
        value.profile
      );
      res.status(200).json({ success: true, data: directions });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /mirror/map/geocode  — auth optional
   * Proxies Mapbox geocoding with secret key
   */
  static async geocode(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      query: Joi.string().max(256).required(),
      lat: Joi.number().min(-90).max(90).optional(),
      lng: Joi.number().min(-180).max(180).optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    try {
      const results = await mapService.geocodeAddress(
        value.query,
        value.lng ?? 120.596,
        value.lat ?? 16.3971
      );
      res.status(200).json({ results });
    } catch (err) {
      if ((err as Error).message === "Geocoding service unavailable") {
        return res.status(502).json({ error: "Geocoding service unavailable" });
      }
      next(err);
    }
  }

  /**
   * POST /mirror/map/directions  — auth optional, rate limited
   */
  static async directions(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id || "anonymous";

    if (isRateLimited(userId)) {
      return res.status(429).json({ error: "Too many requests. Wait 5 seconds." });
    }

    const coordSchema = Joi.array().items(Joi.number().required()).length(2).required();

    const schema = Joi.object({
      origin: coordSchema,
      destination: coordSchema,
      profile: Joi.string().valid("car", "motorcycle", "bicycle", "walking").required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error)
      return res.status(400).json({
        error: error.message || "Invalid profile. Must be car, motorcycle, bicycle, or walking",
      });

    const [oLng, oLat] = value.origin;
    const [dLng, dLat] = value.destination;

    if (oLng < -180 || oLng > 180 || oLat < -90 || oLat > 90) {
      return res.status(400).json({ error: "Invalid origin coordinates" });
    }
    if (dLng < -180 || dLng > 180 || dLat < -90 || dLat > 90) {
      return res.status(400).json({ error: "Invalid destination coordinates" });
    }

    try {
      const result = await getDirections(value.origin, value.destination, value.profile);
      res.status(200).json(result);
    } catch (err) {
      const errorObj = err as {
        response?: { data?: { error?: { message?: string }; message?: string }; status?: number };
        message?: string;
      };
      const details =
        errorObj.response?.data?.error?.message ||
        errorObj.response?.data?.message ||
        errorObj.message;
      logger.error("Routing error details:", details);

      if (errorObj.message === "NO_ROUTE") {
        return res
          .status(404)
          .json({ error: "No route found for this profile between these points" });
      }
      if (errorObj.message === "ORS_KEY_MISSING") {
        return res.status(502).json({
          error: "OpenRouteService key not set in .env. Get a free key at openrouteservice.org",
        });
      }
      if (errorObj.message === "ORS_ERROR" || errorObj.response?.status === 401) {
        return res
          .status(502)
          .json({ error: `Routing service auth/availability error: ${details}` });
      }
      res.status(502).json({ error: `Directions service unavailable: ${details}` });
    }
  }

  /**
   * GET /mirror/map/nearby-pois?lat=&lng=&radius=
   * Returns nearby Foursquare places around a destination.
   */
  static async nearbyPOIs(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      radius: Joi.number().min(100).max(5000).default(1000),
      category: Joi.string().optional(),
    });
    const { error, value } = schema.validate(req.query, { allowUnknown: false });
    if (error) return res.status(400).json({ error: error.message });

    try {
      const pois = await foursquareService.nearbyPOIs(value.lat, value.lng, value.radius, value.category);
      return res.json({ pois });
    } catch (err: any) {
      if (err.message === "FOURSQUARE_KEY_MISSING") {
        return res
          .status(502)
          .json({ error: "Foursquare API key not configured. Set FOURSQUARE_API_KEY in .env" });
      }
      // Don't leak Foursquare's raw 4xx/5xx — return 502 so frontend knows it's upstream
      const upstreamStatus = err.response?.status;
      if (upstreamStatus && upstreamStatus >= 400) {
        logger.error(`[MapController] Foursquare nearbyPOIs failed: ${upstreamStatus} ${err.response?.data?.message ?? err.message}`);
        return res.status(502).json({ error: "POI service unavailable", upstream: upstreamStatus });
      }
      next(err);
    }
  }

  /**
   * GET /mirror/map/venue-photos/:fsqId
   * Returns Foursquare photos for a specific venue.
   */
  static async venuePhotos(req: Request, res: Response, next: NextFunction) {
    const { fsqId } = req.params;
    if (!fsqId) return res.status(400).json({ error: "fsqId is required" });

    try {
      const photos = await foursquareService.venuePhotos(fsqId);
      return res.json({ photos });
    } catch (err: any) {
      if (err.message === "FOURSQUARE_KEY_MISSING") {
        return res.status(502).json({ error: "Foursquare API key not configured." });
      }
      next(err);
    }
  }

  static async getHomeLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { homeLocationLat: true, homeLocationLng: true },
      });
      const homeLocation =
        user?.homeLocationLat != null && user?.homeLocationLng != null
          ? { lat: user.homeLocationLat, lng: user.homeLocationLng }
          : null;
      return res.json({ homeLocation });
    } catch (err) {
      next(err);
    }
  }

  static async updateHomeLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const { lat, lng } = req.body as { lat: number; lng: number };
      if (typeof lat !== "number" || typeof lng !== "number") {
        return res.status(400).json({ message: "lat and lng are required numbers" });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { homeLocationLat: lat, homeLocationLng: lng },
      });
      return res.json({ homeLocation: { lat, lng } });
    } catch (err) {
      next(err);
    }
  }
}
