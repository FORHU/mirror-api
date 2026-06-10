import axios from "axios";
import { GOOGLE_PLACES_API_KEY } from "../../config";
import CacheUtil from "../../utils/cache.util";

const BASE_URL = "https://places.googleapis.com/v1";
const POI_CACHE_TTL = 600; // 10 min — POI data is stable within a short window

const EXPLORE_TYPES = [
  "restaurant",
  "cafe",
  "bar",
  "park",
  "tourist_attraction",
  "museum",
  "shopping_mall",
];

const CATEGORY_TO_TYPES: Record<string, string[]> = {
  restaurant: ["restaurant"],
  cafe: ["cafe"],
  bar: ["bar"],
  park: ["park"],
  attraction: ["tourist_attraction", "amusement_park"],
  museum: ["museum"],
  shop: ["shopping_mall", "department_store"],
  mall: ["shopping_mall"],
  medical: ["hospital", "pharmacy"],
  transit: ["transit_station", "bus_station", "subway_station"],
  // common synonyms
  "coffee shop": ["cafe"],
  diner: ["restaurant"],
  dining: ["restaurant"],
  food: ["restaurant", "cafe"],
  hospital: ["hospital"],
  pharmacy: ["pharmacy"],
  hotel: ["lodging"],
  lodging: ["lodging"],
  accommodation: ["lodging"],
  church: ["church"],
  school: ["school"],
  university: ["university"],
  gym: ["gym"],
  supermarket: ["supermarket"],
  grocery: ["grocery_store"],
  "convenience store": ["convenience_store"],
  convenience: ["convenience_store"],
  gas: ["gas_station"],
  "gas station": ["gas_station"],
  atm: ["atm"],
  bank: ["bank"],
  clinic: ["doctor", "hospital"],
  dentist: ["dentist"],
  spa: ["spa"],
};

// Parses a natural-language category string (including plurals and "X and Y" compounds)
// into a flat list of valid Google Places includedTypes.
function parseCategory(raw: string): string[] {
  const lower = raw.toLowerCase().trim();

  // Exact match first
  if (CATEGORY_TO_TYPES[lower]) return CATEGORY_TO_TYPES[lower];

  // Split compound queries: "restaurants and cafes", "coffee shops or bars"
  const terms = lower.split(/\s+(?:and|or)\s+|\s*,\s*/);
  const types: string[] = [];

  for (const term of terms) {
    const t = term.trim();
    if (!t) continue;

    if (CATEGORY_TO_TYPES[t]) {
      types.push(...CATEGORY_TO_TYPES[t]);
      continue;
    }

    // Singularize: "restaurants" → "restaurant", "cafes" → "cafe", "pharmacies" → "pharmacy"
    const singular = t
      .replace(/ies$/, "y") // pharmacies → pharmacy
      .replace(/(?:shes|ches|ses|xes|zes)$/, (m) => m.slice(0, -2)) // churches → church
      .replace(/s$/, ""); // restaurants → restaurant

    if (CATEGORY_TO_TYPES[singular]) {
      types.push(...CATEGORY_TO_TYPES[singular]);
      continue;
    }

    // Last resort: use the term as-is (may be a valid Google type)
    types.push(t);
  }

  return types.length ? [...new Set(types)] : [raw];
}

const GOOGLE_TYPE_TO_CATEGORY: Record<string, string> = {
  restaurant: "restaurant",
  cafe: "cafe",
  coffee_shop: "cafe",
  bar: "bar",
  park: "park",
  national_park: "park",
  tourist_attraction: "attraction",
  amusement_park: "attraction",
  museum: "museum",
  shopping_mall: "mall",
  department_store: "shop",
  store: "store",
  grocery_store: "grocery",
  convenience_store: "convenience",
  hospital: "hospital",
  pharmacy: "pharmacy",
  transit_station: "transit",
  bus_station: "bus",
  subway_station: "train",
  hotel: "hotel",
  lodging: "lodging",
};

export interface PlacePOI {
  placeId: string;
  name: string;
  category: string;
  categoryIcon: string;
  lat: number;
  lng: number;
  address: string;
  distance: number;
  photo: string | null;
  rating?: number;
  openNow?: boolean;
  weekdayDescriptions?: string[];
  phone?: string;
  website?: string;
}

interface GPlace {
  id: string;
  displayName?: { text: string };
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  location?: { latitude: number; longitude: number };
  formattedAddress?: string;
  photos?: Array<{ name: string }>;
  rating?: number;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  internationalPhoneNumber?: string;
  websiteUri?: string;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}


export const googlePlacesService = {
  nearbyPOIs: async (
    lat: number,
    lng: number,
    radiusM = 1000,
    category?: string
  ): Promise<PlacePOI[]> => {
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_KEY_MISSING");
    }

    const cacheKey = `poi:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusM}:${category ?? "all"}`;

    return CacheUtil.remember<PlacePOI[]>(cacheKey, POI_CACHE_TTL, async () => {
      const includedTypes = category ? parseCategory(category) : EXPLORE_TYPES;

      const response = await axios.post(
        `${BASE_URL}/places:searchNearby`,
        {
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radiusM,
            },
          },
          includedTypes,
          maxResultCount: 15,
        },
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.primaryType,places.primaryTypeDisplayName,places.location,places.formattedAddress,places.photos,places.rating,places.regularOpeningHours,places.internationalPhoneNumber,places.websiteUri",
          },
        }
      );

      const places: GPlace[] = response.data?.places ?? [];

      return places.map((p) => {
        const placeLat = p.location?.latitude ?? lat;
        const placeLng = p.location?.longitude ?? lng;
        const photoName = p.photos?.[0]?.name;

        return {
          placeId: p.id,
          name: p.displayName?.text ?? "Place",
          category:
            GOOGLE_TYPE_TO_CATEGORY[p.primaryType ?? ""] ?? p.primaryTypeDisplayName?.text ?? "Place",
          categoryIcon: "",
          lat: placeLat,
          lng: placeLng,
          address: p.formattedAddress ?? "",
          distance: haversineDistance(lat, lng, placeLat, placeLng),
          photo: photoName ?? null,
          rating: p.rating,
          openNow: p.regularOpeningHours?.openNow,
          weekdayDescriptions: p.regularOpeningHours?.weekdayDescriptions,
          phone: p.internationalPhoneNumber,
          website: p.websiteUri,
        };
      });
    });
  },

  venuePhotos: async (placeId: string): Promise<string[]> => {
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_KEY_MISSING");
    }

    const response = await axios.get(`${BASE_URL}/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "photos",
      },
    });

    const photos: Array<{ name: string }> = response.data?.photos ?? [];
    return photos.slice(0, 6).map((p) => p.name);
  },
};
