import { ChatWonderEvent } from "./parse-chatWonder-response.util";
import { mapService } from "../services/shared/map.service";

import logger from "./logger";

/**
 * Iterates through ChatWonder events and automatically geocodes any AI-generated locations
 * (e.g., "McDonald's, Cebu") into precise Lat/Lng coordinates.
 */
export async function resolveItineraryLocations(
  events: ChatWonderEvent[]
): Promise<ChatWonderEvent[]> {
  try {
    // Deep clone to avoid mutating original references just in case
    const enrichedEvents = JSON.parse(JSON.stringify(events)) as ChatWonderEvent[];

    // Promise.all to geocode concurrently for maximum speed
    await Promise.all(
      enrichedEvents.map(async (event) => {
        if (event.map && event.map.destination) {
          try {
            logger.info(
              `[ResolveItineraryLocations] Resolving location globally for: ${event.map.destination}`
            );

            // Use mapService.search which has no hardcoded proximity bias
            const results = await mapService.search(event.map.destination);

            if (results && results.length > 0) {
              const bestMatch = results[0];
              event.map.lat = bestMatch.center[1];
              event.map.lng = bestMatch.center[0];
              // Populate the new schema keys too
              event.map.destination_lat = bestMatch.center[1];
              event.map.origin_lng = bestMatch.center[0];

              event.map.placeId = bestMatch.id;
              event.map.address = bestMatch.place_name;
              logger.info(
                `[ResolveItineraryLocations] Successfully mapped to: ${bestMatch.place_name}`
              );
            } else {
              logger.warn(
                `[ResolveItineraryLocations] No results found for ${event.map.destination}`
              );
              event.map.map_error = `I couldn't find the exact location for ${event.map.destination} on the map. Can you be more specific?`;
            }
          } catch (err) {
            logger.warn(
              `[ResolveItineraryLocations] Failed to geocode ${event.map.destination}: ${(err as Error).message}`
            );
            event.map.map_error = `I had trouble finding ${event.map.destination} on the map. Can you be more specific?`;
          }
        }
      })
    );

    return enrichedEvents;
  } catch (err) {
    logger.error(`[ResolveItineraryLocations] Fatal error: ${(err as Error).message}`);
    return events; // Return original if fatal failure
  }
}
