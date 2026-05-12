import axios from "axios";
import { MAPBOX_SECRET_TOKEN } from "../../config";

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

export interface DirectionsResponse {
  routes: Array<{
    geometry: string | any;
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
  search: async (query: string, proximity?: string): Promise<GeocodingFeature[]> => {
    if (!query) return [];
    
    try {
      const params: any = {
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
      console.error("Mapbox Geocoding Error:", error);
      throw new Error("Failed to search locations");
    }
  },

  getDirections: async (origin: string, destination: string, profile: string = "driving"): Promise<DirectionsResponse> => {
    try {
      const response = await axios.get<DirectionsResponse>(
        `https://api.mapbox.com/directions/v5/mapbox/${profile}/${origin};${destination}`,
        {
          params: {
            access_token: MAPBOX_SECRET_TOKEN,
            geometries: "geojson",
            steps: true,
            overview: "full",
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error("Mapbox Directions Error:", error);
      throw new Error("Failed to calculate route");
    }
  }
};
