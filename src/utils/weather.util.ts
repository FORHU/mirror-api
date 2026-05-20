import { WeatherType, WeatherIntensity } from "@prisma/client";

export type WeatherObservation = {
  temperature: number;
  humidity: number;
  uvIndex: number;
  precipitationProb: number;
  windSpeed: number;
};

export type WeatherRisks = {
  oilRisk: number;
  drynessRisk: number;
  uvRisk: number;
  smudgeRisk: number;
  sweatRisk: number;
};

export type InsightShape = WeatherRisks & {
  conditionType: WeatherType;
  intensity: WeatherIntensity;
  tags: string[];
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function classifyWeather(o: WeatherObservation): WeatherType {
  if (o.precipitationProb >= 50 && o.temperature <= 20) return WeatherType.COLD_WET;
  if (o.precipitationProb >= 50) return WeatherType.RAINY;
  if (o.temperature >= 30 && o.humidity >= 70) return WeatherType.HOT_HUMID;
  if (o.temperature >= 30 && o.humidity < 50) return WeatherType.HOT_DRY;
  if (o.temperature <= 20 && o.humidity <= 40) return WeatherType.COLD_DRY;
  return WeatherType.MILD;
}

export function computeRisks(o: WeatherObservation): WeatherRisks {
  return {
    oilRisk: clamp(o.humidity * 0.7 + o.temperature * 1.2),
    drynessRisk: clamp(100 - o.humidity + (20 - o.temperature)),
    uvRisk: clamp(o.uvIndex * 10),
    smudgeRisk: clamp((o.humidity + o.precipitationProb) / 2),
    sweatRisk: clamp(o.temperature * 2 + o.humidity * 0.5),
  };
}

export function intensityFor(risks: WeatherRisks): WeatherIntensity {
  const max = Math.max(
    risks.oilRisk,
    risks.drynessRisk,
    risks.uvRisk,
    risks.smudgeRisk,
    risks.sweatRisk,
  );
  if (max >= 80) return WeatherIntensity.HIGH;
  if (max >= 50) return WeatherIntensity.MEDIUM;
  return WeatherIntensity.LOW;
}

export function buildTags(o: WeatherObservation): string[] {
  const tags: string[] = [];
  if (o.temperature >= 30) tags.push("HOT");
  if (o.temperature <= 10) tags.push("COLD");
  if (o.humidity >= 70) tags.push("HUMID");
  if (o.humidity <= 30) tags.push("DRY");
  if (o.uvIndex >= 6) tags.push("HIGH_UV");
  if (o.precipitationProb >= 50) tags.push("WET");
  if (o.windSpeed >= 30) tags.push("WINDY");
  if (o.temperature >= 28 && o.humidity >= 70) tags.push("TROPICAL");
  return tags;
}

export function buildInsight(o: WeatherObservation): InsightShape {
  const risks = computeRisks(o);
  return {
    conditionType: classifyWeather(o),
    intensity: intensityFor(risks),
    tags: buildTags(o),
    ...risks,
  };
}

// Canonical "we don't know" reading. Paired with source=SENTINEL so callers
// can keep working through an upstream outage without producing a row that
// looks like real data.
export function sentinelObservation(): WeatherObservation {
  return {
    temperature: 22,
    humidity: 50,
    uvIndex: 3,
    precipitationProb: 0,
    windSpeed: 5,
  };
}
