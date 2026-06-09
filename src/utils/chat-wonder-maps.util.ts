import { ChatWonderEvent } from "./parse-chatWonder-response.util";
import { mapService } from "../services/shared/map.service";

import logger from "./logger";
import { prisma } from "./prisma";

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

/**
 * Persists the map/location data ChatWonder recommends (MAPS_DATA block) as
 * ItineraryEvent rows on the active UserOutline. Each stop in the array becomes
 * one ItineraryEvent. Old map events for this outline are wiped first so the
 * list always reflects the latest ChatWonder turn.
 *
 * MAPS_DATA shape: an array of stop objects, e.g.
 *   [{ destination, origin, suggestion, lat, lng, address, placeId }, ...]
 */
export async function persistOutlineMaps(conversationId: string, mapsData: unknown): Promise<void> {
  try {
    if (!mapsData) return;

    // MAPS_DATA arrives as a top-level JSON array from ChatWonder
    const stops = Array.isArray(mapsData) ? mapsData : [];
    if (stops.length === 0) return;

    const outline = await prisma.userOutline.findUnique({
      where: { conversationId },
      select: { id: true },
    });

    if (!outline) {
      logger.warn(`[persistOutlineMaps] No outline for conversation ${conversationId}`);
      return;
    }

    // Wipe previous map events so we always reflect the latest recommendation
    await prisma.itineraryEvent.deleteMany({
      where: { userOutlineId: outline.id },
    });

    // Create one ItineraryEvent per stop
    for (const rawStop of stops) {
      if (!rawStop || typeof rawStop !== "object") continue;
      const stop = rawStop as Record<string, unknown>;

      const destination = typeof stop.destination === "string" ? stop.destination : null;
      const origin = typeof stop.origin === "string" ? stop.origin : null;
      const suggestion = typeof stop.suggestion === "string" ? stop.suggestion : null;
      const timeBlock = typeof stop.time_block === "string" ? stop.time_block : "anytime";
      const type = typeof stop.type === "string" ? stop.type : "location";

      if (!destination) continue; // Skip stops with no meaningful destination

      // Geocode the destination on-the-fly if lat/lng are missing
      let lat = typeof stop.lat === "number" ? stop.lat : null;
      let lng = typeof stop.lng === "number" ? stop.lng : null;
      let address = typeof stop.address === "string" ? stop.address : null;
      let placeId = typeof stop.placeId === "string" ? stop.placeId : null;

      if ((!lat || !lng) && destination) {
        try {
          const results = await mapService.search(destination);
          if (results && results.length > 0) {
            lat = results[0].center[1];
            lng = results[0].center[0];
            address = results[0].place_name ?? address;
            placeId = results[0].id ?? placeId;
          }
        } catch (geoErr) {
          logger.warn(
            `[persistOutlineMaps] Geocoding failed for "${destination}": ${(geoErr as Error).message}`
          );
        }
      }

      await prisma.itineraryEvent.create({
        data: {
          userOutlineId: outline.id,
          type,
          timeBlock,
          routeSuggestion: suggestion,
          routeOrigin: origin,
          routeDestination: destination,
          weatherTags: [],
        },
      });
    }

    logger.info(
      `[persistOutlineMaps] Persisted ${stops.length} map stops to outline ${outline.id}`
    );
  } catch (error) {
    logger.error(`[persistOutlineMaps] ${(error as Error).message}`);
  }
}
