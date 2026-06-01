import { ChatWonderEvent } from "./parse-chatWonder-response.util";
import { mapService } from "../services/shared/map.service";
import { prisma } from "./prisma";
import logger from "./logger";

/**
 * Iterates through ChatWonder events and automatically geocodes any AI-generated locations
 * (e.g., "McDonald's, Cebu") into precise Lat/Lng coordinates.
 */
export async function resolveItineraryLocations(
  userId: string,
  events: ChatWonderEvent[]
): Promise<ChatWonderEvent[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { homeLocationLat: true, homeLocationLng: true },
    });

    // Deep clone to avoid mutating original references just in case
    const enrichedEvents = JSON.parse(JSON.stringify(events)) as ChatWonderEvent[];

    // Promise.all to geocode concurrently for maximum speed
    await Promise.all(
      enrichedEvents.map(async (event) => {
        if (event.route && event.route.destination) {
          try {
            logger.info(
              `[ResolveItineraryLocations] Resolving location globally for: ${event.route.destination}`
            );

            // Use mapService.search which has no hardcoded proximity bias
            const results = await mapService.search(event.route.destination);

            if (results && results.length > 0) {
              const bestMatch = results[0];
              event.route.lat = bestMatch.center[1];
              event.route.lng = bestMatch.center[0];
              event.route.placeId = bestMatch.id;
              event.route.address = bestMatch.place_name;
              logger.info(
                `[ResolveItineraryLocations] Successfully mapped to: ${bestMatch.place_name}`
              );
            } else {
              logger.warn(
                `[ResolveItineraryLocations] No results found for ${event.route.destination}`
              );
              event.route.map_error = `I couldn't find the exact location for ${event.route.destination} on the map. Can you be more specific?`;
            }
          } catch (err) {
            logger.warn(
              `[ResolveItineraryLocations] Failed to geocode ${event.route.destination}: ${(err as Error).message}`
            );
            event.route.map_error = `I had trouble finding ${event.route.destination} on the map. Can you be more specific?`;
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
