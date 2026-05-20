import WeatherRepo from "../../repositories/weather.repository";
import type { CosmeticsInput } from "../../types/cosmetics-input";

// The read path for downstream consumers (cosmetics, future fashion).
// Projects the insight columns out of the consolidated WeatherSnapshot —
// downstream gets only what it needs, not the raw observation.
export default class WeatherInsightService {
  static async getForOutline(outlineId: string): Promise<CosmeticsInput | null> {
    const snap = await WeatherRepo.findByOutlineId(outlineId);
    if (!snap) return null;
    return {
      conditionType: snap.conditionType,
      intensity: snap.intensity,
      source: snap.source,
      oilRisk: snap.oilRisk,
      drynessRisk: snap.drynessRisk,
      uvRisk: snap.uvRisk,
      smudgeRisk: snap.smudgeRisk,
      sweatRisk: snap.sweatRisk,
      tags: snap.tags,
    };
  }
}
