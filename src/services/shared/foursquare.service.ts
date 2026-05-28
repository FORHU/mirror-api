import axios from "axios";
import { FOURSQUARE_API_KEY } from "../../config";

const BASE_URL = "https://api.foursquare.com/v3";

// Food, cafes, bars, parks, attractions, museums, shopping
const EXPLORE_CATEGORIES = "13000,13032,13065,13003,16032,16026,10027,17000";

export interface FoursquarePOI {
  fsqId: string;
  name: string;
  category: string;
  categoryIcon: string;
  lat: number;
  lng: number;
  address: string;
  distance: number;
  photo: string | null;
}

interface FsqPhoto {
  prefix: string;
  suffix: string;
}
interface FsqResult {
  fsq_id: string;
  name: string;
  distance?: number;
  categories?: Array<{ name: string; icon?: { prefix: string; suffix: string } }>;
  geocodes?: { main?: { latitude: number; longitude: number } };
  location?: { address?: string; locality?: string };
  photos?: FsqPhoto[];
}

function buildPhotoUrl(photo: FsqPhoto): string | null {
  if (!photo?.prefix || !photo?.suffix) return null;
  return `${photo.prefix}original${photo.suffix}`;
}

export const foursquareService = {
  nearbyPOIs: async (lat: number, lng: number, radiusM = 1000): Promise<FoursquarePOI[]> => {
    if (!FOURSQUARE_API_KEY || FOURSQUARE_API_KEY === "your_foursquare_api_key_here") {
      throw new Error("FOURSQUARE_KEY_MISSING");
    }

    const response = await axios.get(`${BASE_URL}/places/search`, {
      headers: { Authorization: FOURSQUARE_API_KEY },
      params: {
        ll: `${lat},${lng}`,
        radius: radiusM,
        categories: EXPLORE_CATEGORIES,
        fields: "fsq_id,name,categories,geocodes,location,photos,distance",
        limit: 15,
      },
    });

    const results: FsqResult[] = response.data?.results ?? [];

    return results.map((r) => {
      const cat = r.categories?.[0];
      const icon = cat?.icon ? `${cat.icon.prefix}64${cat.icon.suffix}` : "";
      const photo = r.photos?.[0] ? buildPhotoUrl(r.photos[0]) : null;

      return {
        fsqId: r.fsq_id,
        name: r.name,
        category: cat?.name ?? "Place",
        categoryIcon: icon,
        lat: r.geocodes?.main?.latitude ?? lat,
        lng: r.geocodes?.main?.longitude ?? lng,
        address: [r.location?.address, r.location?.locality].filter(Boolean).join(", "),
        distance: r.distance ?? 0,
        photo,
      };
    });
  },

  venuePhotos: async (fsqId: string): Promise<string[]> => {
    if (!FOURSQUARE_API_KEY || FOURSQUARE_API_KEY === "your_foursquare_api_key_here") {
      throw new Error("FOURSQUARE_KEY_MISSING");
    }

    const response = await axios.get(`${BASE_URL}/places/${fsqId}/photos`, {
      headers: { Authorization: FOURSQUARE_API_KEY },
      params: { limit: 6 },
    });

    const photos: FsqPhoto[] = response.data ?? [];
    return photos.map(buildPhotoUrl).filter(Boolean) as string[];
  },
};
