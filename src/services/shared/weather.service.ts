import axios from "axios";

export interface WeatherData {
  temperature: number;
  condition: string;
  icon: string;
  windspeed: number;
  humidity: number;
  uvIndex: number;
  precipitationProb: number;
  unit: string;
}

const weatherCodeMap: Record<number, { condition: string; icon: string }> = {
  0:  { condition: "Clear sky",                    icon: "Sun"            },
  1:  { condition: "Mainly clear",                 icon: "CloudSun"       },
  2:  { condition: "Partly cloudy",                icon: "CloudSun"       },
  3:  { condition: "Overcast",                     icon: "Cloud"          },
  45: { condition: "Fog",                          icon: "CloudFog"       },
  48: { condition: "Depositing rime fog",          icon: "CloudFog"       },
  51: { condition: "Light drizzle",                icon: "CloudDrizzle"   },
  53: { condition: "Moderate drizzle",             icon: "CloudDrizzle"   },
  55: { condition: "Dense drizzle",                icon: "CloudDrizzle"   },
  56: { condition: "Light freezing drizzle",       icon: "CloudDrizzle"   },
  57: { condition: "Dense freezing drizzle",       icon: "CloudDrizzle"   },
  61: { condition: "Slight rain",                  icon: "CloudRain"      },
  63: { condition: "Moderate rain",                icon: "CloudRain"      },
  65: { condition: "Heavy rain",                   icon: "CloudRain"      },
  66: { condition: "Light freezing rain",          icon: "CloudRain"      },
  67: { condition: "Heavy freezing rain",          icon: "CloudRain"      },
  71: { condition: "Slight snow fall",             icon: "CloudSnow"      },
  73: { condition: "Moderate snow fall",           icon: "CloudSnow"      },
  75: { condition: "Heavy snow fall",              icon: "CloudSnow"      },
  77: { condition: "Snow grains",                  icon: "CloudSnow"      },
  80: { condition: "Slight rain showers",          icon: "CloudRain"      },
  81: { condition: "Moderate rain showers",        icon: "CloudRain"      },
  82: { condition: "Violent rain showers",         icon: "CloudRain"      },
  85: { condition: "Slight snow showers",          icon: "CloudSnow"      },
  86: { condition: "Heavy snow showers",           icon: "CloudSnow"      },
  95: { condition: "Thunderstorm",                 icon: "CloudLightning" },
  96: { condition: "Thunderstorm with slight hail", icon: "CloudLightning" },
  99: { condition: "Thunderstorm with heavy hail",  icon: "CloudLightning" },
};

export const weatherService = {
  getWeather: async (lat: number, lng: number): Promise<WeatherData> => {
    try {
      const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
        params: {
          latitude: lat,
          longitude: lng,
          current_weather: true,
          hourly: "relativehumidity_2m,uv_index,precipitation_probability",
        },
      });

      const current = response.data.current_weather;
      const hourly  = response.data.hourly;
      const humidity         = hourly.relativehumidity_2m[0] ?? 0;
      const uvIndex          = hourly.uv_index[0] ?? 0;
      const precipitationProb = hourly.precipitation_probability[0] ?? 0;
      const code   = current.weathercode;
      const mapped = weatherCodeMap[code] || { condition: "Unknown", icon: "Cloud" };

      return {
        temperature: current.temperature,
        condition: mapped.condition,
        icon: mapped.icon,
        windspeed: current.windspeed,
        humidity,
        uvIndex,
        precipitationProb,
        unit: "celsius",
      };
    } catch (error) {
      console.error("Open-Meteo Error:", error);
      throw new Error("Weather service unavailable");
    }
  },
};
