// import axios from "axios";
// import { GOOGLE_PLACES_API_KEY } from "../../config";
// import CacheUtil from "../../utils/cache.util";

// const BASE_URL = "https://places.googleapis.com/v1";
// const EXPLORE_TYPES = [...];
// const CATEGORY_TO_TYPES: Record<string, string[]> = { ... };
// const VALID_PLACE_TYPES = new Set([...]);
// const PLACES_FIELD_MASK = "...";
// function mapGPlace(p, originLat, originLng) { ... }
// function parseCategory(raw) { ... }
// function haversineDistance(lat1, lng1, lat2, lng2) { ... }

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

export const googlePlacesService = {
  nearbyPOIs: async (
    _lat: number,
    _lng: number,
    _radiusM?: number,
    _category?: string
  ): Promise<PlacePOI[]> => {
    throw new Error("Google Places service disabled");
  },

  venuePhotos: async (_placeId: string): Promise<string[]> => {
    throw new Error("Google Places service disabled");
  },
};
