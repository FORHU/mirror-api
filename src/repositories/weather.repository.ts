import { prisma } from "../utils/prisma";
import type { WeatherSource, WeatherType, WeatherIntensity } from "@prisma/client";

type ReplaceInput = {
  observation: {
    temperature: number;
    humidity: number;
    uvIndex: number;
    precipitationProb: number;
    windSpeed: number;
  };
  source: WeatherSource;
  insight: {
    conditionType: WeatherType;
    intensity: WeatherIntensity;
    oilRisk: number;
    drynessRisk: number;
    uvRisk: number;
    smudgeRisk: number;
    sweatRisk: number;
    tags: string[];
  };
};

export default class WeatherRepo {
  static async findByOutlineId(outlineId: string) {
    return prisma.weatherSnapshot.findUnique({
      where: { userOutlineId: outlineId },
    });
  }

  // Replacement, not reconciliation. Old row deleted, new one inserted in
  // one transaction — preserves the immutability doctrine in CONTEXT.md.
  // 1:1 with outline enforced at the DB by `userOutlineId @unique`.
  static async replaceForOutline(outlineId: string, data: ReplaceInput) {
    return prisma.$transaction(async (tx) => {
      await tx.weatherSnapshot.deleteMany({ where: { userOutlineId: outlineId } });
      return tx.weatherSnapshot.create({
        data: {
          userOutlineId: outlineId,
          temperature: data.observation.temperature,
          humidity: data.observation.humidity,
          uvIndex: data.observation.uvIndex,
          precipitationProb: data.observation.precipitationProb,
          windSpeed: data.observation.windSpeed,
          source: data.source,
          conditionType: data.insight.conditionType,
          intensity: data.insight.intensity,
          oilRisk: data.insight.oilRisk,
          drynessRisk: data.insight.drynessRisk,
          uvRisk: data.insight.uvRisk,
          smudgeRisk: data.insight.smudgeRisk,
          sweatRisk: data.insight.sweatRisk,
          tags: data.insight.tags,
        },
      });
    });
  }
}
