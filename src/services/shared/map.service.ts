import axios from "axios";
import { MAPBOX_SECRET_TOKEN } from "../../config";
import logger from "../../utils/logger";

export interface GeocodingFeature {
  id: string;
  place_name: string;
  center: [number, number];
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  context: Array<{ id: string; text: string }>;
}

export interface GeocodingResponse {
  features: GeocodingFeature[];
}

export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

export interface DirectionsStep {
  instruction: string;
  maneuver: { type: string; modifier: string };
  distance: number;
  duration: number;
  name: string;
}

export interface DirectionsFormatted {
  geojson: Record<string, unknown>;
  steps: DirectionsStep[];
  distance: number;
  duration: number;
}

export interface DirectionsResponse {
  routes: Array<{
    geometry: string | Record<string, unknown>;
    duration: number;
    distance: number;
    legs: Array<{
      steps: Array<{
        instruction: string;
        maneuver: {
          type: string;
          instruction: string;
        };
      }>;
    }>;
  }>;
}

export const mapService = {
  reverseGeocode: async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await axios.get<GeocodingResponse>(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`,
        {
          params: {
            access_token: MAPBOX_SECRET_TOKEN,
            types: "place,district,locality,neighborhood,poi",
            limit: 1,
          },
        }
      );
      const feature = response.data.features?.[0];
      return feature?.place_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
      logger.warn(`[MapService] reverseGeocode failed: ${(error as Error).message}`);
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  },

  search: async (query: string, proximity?: string): Promise<GeocodingFeature[]> => {
    if (!query) return [];

    try {
      const params: Record<string, string | number | boolean> = {
        access_token: MAPBOX_SECRET_TOKEN,
        autocomplete: true,
        limit: 5,
      };

      if (proximity) {
        params.proximity = proximity;
      }

      const response = await axios.get<GeocodingResponse>(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
        { params }
      );

      return response.data.features;
    } catch (error) {
      logger.error(`Mapbox Geocoding Error: ${(error as Error).message}`);
      throw new Error("Failed to search locations");
    }
  },

  getDirections: async (
    origin: string,
    destination: string,
    profile: string = "driving"
  ): Promise<DirectionsResponse> => {
    try {
      const response = await axios.get<DirectionsResponse>(
        `https://api.mapbox.com/directions/v5/mapbox/${profile}/${origin};${destination}`,
        {
          params: {
            access_token: MAPBOX_SECRET_TOKEN,
            geometries: "geojson",
            steps: true,
            overview: "full",
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error(`Mapbox Directions Error: ${(error as Error).message}`);
      throw new Error("Failed to calculate route");
    }
  },

  geocodeAddress: async (
    query: string,
    proximityLng?: number,
    proximityLat?: number
  ): Promise<GeocodeResult[]> => {
    try {
      const encoded = encodeURIComponent(query);
      const params: Record<string, string | number> = {
        access_token: MAPBOX_SECRET_TOKEN,
        country: "PH",
        limit: 5,
        types: "address,place,poi",
      };
      if (proximityLng != null && proximityLat != null) {
        params.proximity = `${proximityLng},${proximityLat}`;
      }
      const response = await axios.get<GeocodingResponse>(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json`,
        { params }
      );
      return response.data.features.map((f) => ({
        name: f.place_name.split(",")[0],
        address: f.place_name,
        lat: f.center[1],
        lng: f.center[0],
        placeId: f.id,
      }));
    } catch (error) {
      logger.error(`Mapbox Geocode Error: ${(error as Error).message}`);
      throw new Error("Geocoding service unavailable");
    }
  },

  getDirectionsFormatted: async (
    origin: [number, number],
    destination: [number, number],
    profile: string = "driving"
  ): Promise<DirectionsFormatted> => {
    try {
      const isBaguio =
        origin[1] > 16.39 && origin[1] < 16.43 && origin[0] > 120.58 && origin[0] < 120.62;
      let effectiveProfile = profile;

      // BAGUIO LOCAL OVERRIDE: Use walking profile for cycling in city center
      // This ensures we avoid Session Road and use safe pedestrian-allowed paths
      if (profile === "cycling" && isBaguio) {
        effectiveProfile = "walking";
      }

      const waypointStr = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;

      const response = await axios.get<{
        routes?: Array<{
          geometry: Record<string, unknown>;
          duration: number;
          distance: number;
          legs?: Array<{
            steps?: Array<{
              maneuver?: {
                instruction?: string;
                type?: string;
                modifier?: string;
                bearing_after?: number;
                bearing_before?: number;
              };
              distance?: number;
              duration?: number;
              name?: string;
            }>;
          }>;
        }>;
      }>(`https://api.mapbox.com/directions/v5/mapbox/${effectiveProfile}/${waypointStr}`, {
        params: {
          access_token: MAPBOX_SECRET_TOKEN,
          geometries: "geojson",
          steps: true,
          overview: "full",
          annotations: "duration,distance",
        },
      });

      const route = response.data.routes?.[0];
      if (!route) throw new Error("No route found");

      const steps: DirectionsStep[] = (route.legs?.[0]?.steps ?? []).map((s) => ({
        instruction: s.maneuver?.instruction ?? "",
        maneuver: {
          type: s.maneuver?.type ?? "turn",
          modifier: s.maneuver?.modifier ?? "",
          bearing_after: s.maneuver?.bearing_after,
          bearing_before: s.maneuver?.bearing_before,
        },
        distance: s.distance ?? 0,
        duration: s.duration ?? 0,
        name: s.name ?? "",
      }));

      const finalDuration =
        profile === "cycling" && isBaguio ? Math.round(route.duration / 3.2) : route.duration;

      return {
        geojson: {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: route.geometry, properties: {} }],
        },
        steps,
        distance: route.distance,
        duration: finalDuration,
      };
    } catch (error) {
      if ((error as Error).message === "No route found") throw error;
      const err = error as {
        response?: { status?: number; data?: { message?: string } };
        message: string;
      };
      const status = err.response?.status;
      const data = err.response?.data;
      logger.error(`Mapbox Directions Error [${status}]: ${JSON.stringify(data) || err.message}`);
      throw new Error(`Directions service unavailable: ${data?.message || err.message}`);
    }
  },
};
