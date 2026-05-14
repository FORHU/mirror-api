import axios from "axios";

export interface WeatherData {
  temperature: number;
  condition: string;
  icon: string;
  windspeed: number;
  humidity: number;
  unit: string;
}

const weatherCodeMap: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Clear sky", icon: "Sun" },
  1: { condition: "Mainly clear", icon: "CloudSun" },
  2: { condition: "Partly cloudy", icon: "CloudSun" },
  3: { condition: "Overcast", icon: "Cloud" },
  45: { condition: "Fog", icon: "CloudFog" },
  48: { condition: "Depositing rime fog", icon: "CloudFog" },
  51: { condition: "Light drizzle", icon: "CloudDrizzle" },
  53: { condition: "Moderate drizzle", icon: "CloudDrizzle" },
  55: { condition: "Dense drizzle", icon: "CloudDrizzle" },
  61: { condition: "Slight rain", icon: "CloudRain" },
  63: { condition: "Moderate rain", icon: "CloudRain" },
  65: { condition: "Heavy rain", icon: "CloudRain" },
  71: { condition: "Slight snow fall", icon: "CloudSnow" },
  73: { condition: "Moderate snow fall", icon: "CloudSnow" },
  75: { condition: "Heavy snow fall", icon: "CloudSnow" },
  95: { condition: "Thunderstorm", icon: "CloudLightning" },
};

export const weatherService = {
  getWeather: async (lat: number, lng: number): Promise<WeatherData> => {
    try {
      const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: {
          latitude: lat,
          longitude: lng,
          current_weather: true,
          hourly: "relativehumidity_2m",
        },
      });

      const current = response.data.current_weather;
      const humidity = response.data.hourly.relativehumidity_2m[0];
      const code = current.weathercode;
      const mapped = weatherCodeMap[code] || { condition: "Unknown", icon: "Cloud" };

      return {
        temperature: current.temperature,
        condition: mapped.condition,
        icon: mapped.icon,
        windspeed: current.windspeed,
        humidity: humidity,
        unit: "celsius",
      };
    } catch (error) {
      console.error("Open-Meteo Error:", error);
      throw new Error("Weather service unavailable");
    }
  },
};
