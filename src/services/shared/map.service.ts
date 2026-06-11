import axios from "axios";
import { MAPBOX_SECRET_TOKEN } from "../../config";
import logger from "../../utils/logger";

export interface GeocodingFeature {
  id: string;
  place_name: string;
  place_type: string[];
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
  placeType: string;
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
        types: "address,place,poi,region,district",
      };
      if (proximityLng != null && proximityLat != null) {
        params.proximity = `${proximityLng},${proximityLat}`;
      }
      const response = await axios.get<GeocodingResponse>(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json`,
        { params }
      );
      const raw = response.data.features.map((f) => ({
        name: f.place_name.split(",")[0],
        address: f.place_name,
        lat: f.center[1],
        lng: f.center[0],
        placeId: f.id,
        placeType: f.place_type?.[0] ?? "other",
      }));
      // Venue-type descriptor words — excluded from context matching because they
      // are part of a POI name, not an administrative area (e.g. "mall", "church").
      // They are also used to detect POI queries so we can apply name-match guards.
      // Venue-type words across English, French, Spanish, German, Italian.
      // Both accented and unaccented French forms are included because Whisper
      // (speech-to-text) preserves diacritics but typed queries may not.
      const VENUE_TYPE_WORDS = new Set([
        // English
        "mall",
        "center",
        "centre",
        "plaza",
        "complex",
        "building",
        "tower",
        "restaurant",
        "cafe",
        "cafeteria",
        "eatery",
        "diner",
        "bistro",
        "bar",
        "bakery",
        "grill",
        "kitchen",
        "buffet",
        "food",
        "court",
        "church",
        "chapel",
        "cathedral",
        "basilica",
        "shrine",
        "parish",
        "convent",
        "monastery",
        "grotto",
        "school",
        "university",
        "college",
        "academy",
        "institute",
        "campus",
        "hospital",
        "clinic",
        "pharmacy",
        "hotel",
        "resort",
        "inn",
        "lodge",
        "hostel",
        "park",
        "garden",
        "farm",
        "market",
        "supermarket",
        "museum",
        "library",
        "theater",
        "theatre",
        "cinema",
        "gallery",
        "station",
        "terminal",
        "gym",
        "spa",
        // French (accented + unaccented)
        "musée",
        "musee",
        "école",
        "ecole",
        "lycée",
        "lycee",
        "gare",
        "hôpital",
        "hopital",
        "église",
        "eglise",
        "cathédrale",
        "cathedrale",
        "université",
        "universite",
        "bibliothèque",
        "bibliotheque",
        "théâtre",
        "cinéma",
        "galerie",
        "mairie",
        "pharmacie",
        "palais",
        "stade",
        "marché",
        "marche",
        "arrondissement",
        "quartier",
        // Spanish
        "escuela",
        "universidad",
        "iglesia",
        "mercado",
        "parque",
        "farmacia",
        // German
        "schule",
        "kirche",
        "krankenhaus",
        "bahnhof",
        "markt",
        // Italian
        "scuola",
        "chiesa",
        "ospedale",
        "stazione",
      ]);
      // Filter results by checking whether any key query word appears in the
      // administrative context (everything after the first comma in place_name).
      // This rejects road/street results whose name contains a region word but
      // whose location is outside that region — e.g. "Benguet Road, Antipolo,
      // Rizal" for "bugias benguet" (context "Antipolo, Rizal" has no query
      // word) while keeping "Buguias, Benguet" (context "Benguet, Cordillera"
      // matches "benguet"). Generic place-type words and venue descriptors are
      // stripped first so "good taste center mall" doesn't try to match "mall"
      // against the administrative context of Baguio City.
      const PLACE_TYPE_WORDS = new Set([
        "city",
        "municipality",
        "province",
        "barangay",
        "village",
        "near",
        "nearest",
        "closest",
        "in",
        "at",
        "along",
        "beside",
      ]);
      const ALL_SKIP_WORDS = new Set([...PLACE_TYPE_WORDS, ...VENUE_TYPE_WORDS]);
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1 && !ALL_SKIP_WORDS.has(w));
      const filtered = raw.filter((r) => {
        const contextLower = r.address.split(",").slice(1).join(",").toLowerCase();
        return queryWords.some((w) => contextLower.includes(w));
      });
      // Secondary guard: reject place/region results (municipalities, cities) whose
      // name shares no words with the query. This kills fuzzy mismatches like
      // "Mallig, Isabela" for "good taste center mall" where the query words
      // ("good", "taste") appear nowhere in "Mallig".
      const nameWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !ALL_SKIP_WORDS.has(w));
      // When context filter finds nothing, sort raw by distance to user's location
      // so the nearest result wins (prevents popular far-away POIs like BGC from
      // beating a correct nearby match when the query contains "here in [city]").
      const proximityLocation =
        proximityLng != null && proximityLat != null
          ? { lat: proximityLat, lng: proximityLng }
          : null;
      const proximityFallback =
        filtered.length === 0 && proximityLocation
          ? [...raw].sort((a, b) => {
              const dA =
                (a.lat - proximityLocation.lat) ** 2 + (a.lng - proximityLocation.lng) ** 2;
              const dB =
                (b.lat - proximityLocation.lat) ** 2 + (b.lng - proximityLocation.lng) ** 2;
              return dA - dB;
            })
          : null;
      const base = filtered.length > 0 ? filtered : (proximityFallback ?? raw);
      const nameGuarded = base.filter((r) => {
        if (r.placeType === "poi" || r.placeType === "address" || r.placeType === "neighborhood")
          return true;
        if (nameWords.length === 0) return true;
        const resultWords = r.name.toLowerCase().split(/[\s,-]+/);
        return nameWords.some((qw) => resultWords.some((rw) => rw.includes(qw) || qw.includes(rw)));
      });
      const result = nameGuarded.length > 0 ? nameGuarded : base;
      // For venue-type queries, surface POI results first so the client's
      // placeType preference can reliably pick the right destination over a
      // bare address with the same road name (e.g. "Saint Louis University"
      // poi over "Bonifacio Road, Banaba" address).
      // Treat ALL-CAPS abbreviations (e.g. "SLU", "UB") as venue queries so POI
      // results are surfaced first even when no full venue-type word is present.
      const isVenueQuery =
        query
          .toLowerCase()
          .split(/\s+/)
          .some((w) => VENUE_TYPE_WORDS.has(w)) || /\b[A-Z]{2,6}\b/.test(query);
      if (isVenueQuery) {
        return [...result].sort((a, b) => {
          const rank = (r: typeof a) =>
            r.placeType === "poi" ? 0 : r.placeType === "address" ? 1 : 2;
          return rank(a) - rank(b);
        });
      }
      return result;
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
