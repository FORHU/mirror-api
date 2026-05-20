import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { mapService } from "../../services/shared/map.service";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { MAPBOX_SECRET_TOKEN, ORS_API_KEY } from "../../config";

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
  geojson: any;
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

const ORS_EXCLUSIONS: Record<string, any> = {
  motorcycle: { avoid_features: ["highways", "tollways"] },
  bicycle: {}, 
  walking: {},
};

async function getMapboxDirections(origin: [number, number], destination: [number, number]): Promise<DirectionsResponse> {
  const baseUrl = `https://api.mapbox.com/directions/v5/mapbox`;
  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const params = `?access_token=${MAPBOX_SECRET_TOKEN}&geometries=geojson&steps=true&overview=full&annotations=duration,distance`;

  try {
    const response = await axios.get(`${baseUrl}/driving-traffic/${coords}${params}`);
    return normalizeMapboxResponse(response.data);
  } catch (err: any) {
    // If driving-traffic is forbidden (403), fallback to standard driving
    if (err.response?.status === 403) {
      console.warn("Mapbox driving-traffic forbidden, falling back to standard driving");
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

function normalizeMapboxResponse(data: any): DirectionsResponse {
  const route = data.routes[0];
  const steps = route.legs[0].steps.map((step: any) => ({
    instruction: step.maneuver.instruction,
    maneuver: {
      type: step.maneuver.type,
      modifier: step.maneuver.modifier ?? "straight",
    },
    distance: step.distance,
    duration: step.duration,
    name: step.name ?? "",
  }));
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

function normalizeORSResponse(data: any, profile: string): DirectionsResponse {
  const feature = data.features[0];
  const segments = feature.properties.segments[0];

  const steps = segments.steps.map((step: any) => {
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
    const maneuver = modifierMap[step.type] ?? { type: "continue", modifier: "straight" };

    return {
      instruction: step.instruction,
      maneuver,
      distance: step.distance,
      duration: step.duration,
      name: step.name ?? "",
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
    return getORSDirections(origin, destination, profile as any);
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
      const directions = await mapService.getDirections(value.origin, value.destination, value.profile);
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
        value.lng ?? 120.5960,
        value.lat ?? 16.3971
      );
      res.status(200).json({ results });
    } catch (err: any) {
      if (err.message === "Geocoding service unavailable") {
        return res.status(502).json({ error: "Geocoding service unavailable" });
      }
      next(err);
    }
  }

  /**
   * POST /mirror/map/directions  — auth optional, rate limited
   */
  static async directions(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id || "anonymous";

    if (isRateLimited(userId)) {
      return res.status(429).json({ error: "Too many requests. Wait 5 seconds." });
    }

    const coordSchema = Joi.array()
      .items(Joi.number().required())
      .length(2)
      .required();

    const schema = Joi.object({
      origin: coordSchema,
      destination: coordSchema,
      profile: Joi.string().valid("car", "motorcycle", "bicycle", "walking").required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message || "Invalid profile. Must be car, motorcycle, bicycle, or walking" });

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
    } catch (err: any) {
      const details = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      console.error("Routing error details:", details);
      
      if (err.message === "NO_ROUTE") {
        return res.status(404).json({ error: "No route found for this profile between these points" });
      }
      if (err.message === "ORS_KEY_MISSING") {
        return res.status(502).json({ error: "OpenRouteService key not set in .env. Get a free key at openrouteservice.org" });
      }
      if (err.message === "ORS_ERROR" || err.response?.status === 401) {
        return res.status(502).json({ error: `Routing service auth/availability error: ${details}` });
      }
      res.status(502).json({ error: `Directions service unavailable: ${details}` });
    }
  }

  /**
   * GET /mirror/map/home-location
   *
   * TODO: requires `homeLocationLat` / `homeLocationLng` on `User` model.
   * Disabled until schema fields land + migration runs.
   */
  static async getHomeLocation(_req: Request, res: Response, _next: NextFunction) {
    return res.status(501).json({
      status: "error",
      statusCode: 501,
      message: "Home location not implemented — User schema missing homeLocationLat/Lng",
    });
  }

  /**
   * PATCH /mirror/map/home-location
   *
   * TODO: requires `homeLocationLat` / `homeLocationLng` on `User` model.
   * Disabled until schema fields land + migration runs.
   */
  static async updateHomeLocation(_req: Request, res: Response, _next: NextFunction) {
    return res.status(501).json({
      status: "error",
      statusCode: 501,
      message: "Home location not implemented — User schema missing homeLocationLat/Lng",
    });
  }
}
