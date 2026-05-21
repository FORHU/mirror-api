import { WeatherSource } from "@prisma/client";
import OutlineRepo from "../../repositories/outline.repository";
import WeatherRepo from "../../repositories/weather.repository";
import { throwResponse } from "../../utils/throw-response";
import { buildInsight, sentinelObservation, WeatherObservation } from "../../utils/weather.util";
import logger from "../../utils/logger";

// Raw-snapshot lifecycle. Chat-wonder is the sole writer — it parses the
// user's conversation, produces a WeatherObservation, and calls
// ingestObservation. Cosmetics MUST NOT import this — use
// WeatherInsightService instead.
export default class WeatherSnapshotService {
  // observation === null means chat-wonder couldn't provide weather for this
  // outline (its own upstream failed, or the conversation didn't surface it).
  // We still write a row so the decision pipeline isn't blocked — tagged
  // SENTINEL so cosmetics/monitoring can branch.
  static async ingestObservation(outlineId: string, observation: WeatherObservation | null) {
    const outline = await OutlineRepo.findById(outlineId);
    if (!outline) throwResponse(404, "Outline not found");

    const finalObservation = observation ?? sentinelObservation();
    const source: WeatherSource = observation ? WeatherSource.API : WeatherSource.SENTINEL;

    if (source === WeatherSource.SENTINEL) {
      logger.warn(`[WeatherSnapshotService] SENTINEL write outline=${outlineId}`);
    }

    const insight = buildInsight(finalObservation);
    return WeatherRepo.replaceForOutline(outlineId, {
      observation: finalObservation,
      source,
      insight,
    });
  }
}
