import type { WeatherType, WeatherIntensity, WeatherSource } from "@prisma/client";

// The type wall between weather and cosmetics: cosmetics functions accept
// CosmeticsInput, not WeatherInsight, and never WeatherCondition. Compile
// blocks `cosmeticsFn(snapshot.weather)` and `cosmeticsFn(snapshot.insight)`
// — only `WeatherInsightService.getForOutline()` produces this shape.
//
// Phase 1: weather-only situation signal. Future event-context (eventType,
// formality, timeOfDay) will be added as sibling fields here, not by
// widening this type to expose more of WeatherInsight.
export type CosmeticsInput = {
  conditionType: WeatherType;
  intensity: WeatherIntensity;
  source: WeatherSource;
  oilRisk: number;
  drynessRisk: number;
  uvRisk: number;
  smudgeRisk: number;
  sweatRisk: number;
  tags: string[];
};
