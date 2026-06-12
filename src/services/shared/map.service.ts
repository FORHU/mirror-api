// import axios from "axios";
// import { MAPBOX_SECRET_TOKEN } from "../../config";
// import logger from "../../utils/logger";

// export interface GeocodingFeature { ... }
// export interface GeocodingResponse { ... }
// export interface GeocodeResult { ... }
// export interface DirectionsStep { ... }
// export interface DirectionsFormatted { ... }
// export interface DirectionsResponse { ... }

// export const mapService = {
//   reverseGeocode: async (lat, lng) => { ... },
//   search: async (query, proximity) => { ... },
//   getDirections: async (origin, destination, profile) => { ... },
//   geocodeAddress: async (query, proximityLng, proximityLat) => { ... },
//   getDirectionsFormatted: async (origin, destination, profile) => { ... },
// };

interface GeocodingFeature {
  center: [number, number];
  place_name: string;
  [key: string]: unknown;
}

export const mapService = {
  reverseGeocode: async (_lat: number, _lng: number): Promise<string> => {
    throw new Error("Map service disabled");
  },
  search: async (_query: string): Promise<GeocodingFeature[]> => {
    throw new Error("Map service disabled");
  },
  getDirections: async (_origin: string, _destination: string): Promise<never> => {
    throw new Error("Map service disabled");
  },
  geocodeAddress: async (_query: string): Promise<GeocodingFeature[]> => {
    throw new Error("Map service disabled");
  },
  getDirectionsFormatted: async (): Promise<never> => {
    throw new Error("Map service disabled");
  },
};
