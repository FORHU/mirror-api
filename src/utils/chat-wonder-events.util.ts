import { prisma } from "./prisma";
import type { WeatherContext } from "./cosmetics.util";
import type { SKIN_TYPE } from "@prisma/client";
import { ChatWonderEvent } from "./parse-chatWonder-response.util";
export type { ChatWonderEvent };
import logger from "./logger";

/**
 * Enriches the Chat Wonder streamed completion itinerary events with actual
 * physical database products from the CosmeticProduct catalog, linking the
 * UserOutline to the active user's SkinAnalysis scan dynamically, and persisting
 * ItineraryEvent and CosmeticRecommendation records under the active draft.
 */
export async function resolveItineraryEvents(
  userId: string,
  events: ChatWonderEvent[],
  conversationId: string
): Promise<ChatWonderEvent[]> {
  try {
    if (!events || !events.length) return events;

    // 1. Find the UserOutline matching this conversation session
    const outline = await prisma.userOutline.findUnique({
      where: { conversationId },
      select: { id: true },
    });

    // 2. Fetch the user's latest physical face scan (linked via any outline)
    const latestScan = await prisma.skinAnalysis.findFirst({
      where: { outlines: { some: { userId } } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    // 3. Link the skin scan to the current session outline
    if (outline && latestScan) {
      await prisma.userOutline.update({
        where: { id: outline.id },
        data: { skinAnalysisId: latestScan.id },
      });
    }

    // 4. Wipe previous draft itinerary events and master recommendations to maintain clean slate
    if (outline) {
      await prisma.$transaction([
        prisma.itineraryEvent.deleteMany({
          where: { userOutlineId: outline.id },
        }),
        prisma.cosmeticRecommendation.deleteMany({
          where: { userOutlineId: outline.id },
        }),
      ]);
    }

    // 5. Persist the events and the ChatWonder-provided cosmetics directly
    for (const event of events) {
      // A. Create the ItineraryEvent card row in database (if outline exists)
      let createdEventId: string | null = null;
      if (outline) {
        const createdEvent = await prisma.itineraryEvent.create({
          data: {
            userOutlineId: outline.id,
            type: event.type,
            timeBlock: event.timeBlock,
            oilRisk: event.context?.oilRisk ?? null,
            drynessRisk: event.context?.drynessRisk ?? null,
            uvRisk: event.context?.uvRisk ?? null,
            smudgeRisk: event.context?.smudgeRisk ?? null,
            sweatRisk: event.context?.sweatRisk ?? null,
            weatherTags: event.context?.tags || [],
            fashionSuggestion: event.fashion?.suggestion ?? null,
            cosmeticsSuggestion: event.cosmetics?.suggestion ?? null,
            routeSuggestion: event.map?.suggestion ?? null,
            routeOrigin: event.map?.origin ?? null,
            routeDestination: event.map?.destination ?? null,
          },
          select: { id: true },
        });
        createdEventId = createdEvent.id;

        // B. Persist the CosmeticRecommendation rows directly from ChatWonder's resolvedProducts
        if (event.cosmetics?.resolvedProducts && event.cosmetics.resolvedProducts.length && createdEventId) {
          await prisma.cosmeticRecommendation.createMany({
            data: event.cosmetics.resolvedProducts.map((r) => ({
              userOutlineId: outline.id, // 🛡️ Legacy master list link
              itineraryEventId: createdEventId, // 🌟 New event card link
              cosmeticProductId: r.id, // ChatWonder already provides the DB ID
              score: r.score || 0,
              rank: r.rank || 0,
              reason: r.reason || "",
              signals: {}, // Let ChatWonder provide signals in future if needed
            })),
          });
        }
      }

      logger.info(
        `[resolveItineraryEvents] Event: ${event.type} in ${event.timeBlock} persisted with ${event.cosmetics?.resolvedProducts?.length || 0} cosmetics and ${event.fashion?.resolvedProducts?.length || 0} garments.`
      );
    }

    // Return the events completely untouched, as ChatWonder already resolved everything!
    return events;
  } catch (error) {
    logger.error(
      `[resolveItineraryEvents] Error during resolution: ${(error as Error).message}`
    );
    return events;
  }
}
