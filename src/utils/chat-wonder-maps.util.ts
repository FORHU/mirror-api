// import { ChatWonderEvent } from "./parse-chatWonder-response.util";
// import { mapService } from "../services/shared/map.service";
// import logger from "./logger";
// import { prisma } from "./prisma";

import type { ChatWonderEvent } from "./parse-chatWonder-response.util";

/**
 * Iterates through ChatWonder events and geocodes AI-generated locations.
 * Disabled: map service removed.
 */
export async function resolveItineraryLocations(
  events: ChatWonderEvent[],
): Promise<ChatWonderEvent[]> {
  // Map service disabled — return events unmodified
  return events;
}

/**
 * Persists MAPS_DATA stops as ItineraryEvent rows on the active UserOutline.
 * Disabled: map service removed.
 */
export async function persistOutlineMaps(
  _conversationId: string,
  _mapsData: unknown,
): Promise<void> {
  // Map service disabled — no-op
}
