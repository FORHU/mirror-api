import { Request, Response, NextFunction } from "express";
import { weatherService, WeatherData } from "../../services/shared/weather.service";

interface CacheEntry {
  data: WeatherData;
  expiry: number;
}

const weatherCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default class WeatherController {
  static async getWeather(req: Request, res: Response, next: NextFunction) {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat or lng parameters" });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: "Invalid lat or lng" });
    }

    const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const now = Date.now();
    const cached = weatherCache.get(cacheKey);

    if (cached && cached.expiry > now) {
      return res.status(200).json(cached.data);
    }

    try {
      const data = await weatherService.getWeather(latitude, longitude);
      weatherCache.set(cacheKey, {
        data,
        expiry: now + CACHE_TTL_MS,
      });
      res.status(200).json(data);
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Weather service unavailable" });
    }
  }
}
