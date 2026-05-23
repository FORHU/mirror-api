import { prisma } from "./prisma";
import { rankProducts, type AnalysisInput, type WeatherContext } from "./cosmetics.util";
import type { SKIN_TYPE } from "@prisma/client";
import logger from "./logger";

export interface ChatWonderEvent {
  type: "jog" | "meeting" | "date";
  timeBlock: string;
  context: WeatherContext;
  fashion: {
    suggestion: string;
    tags?: string[];
    [key: string]: any;
  };
  cosmetics: {
    suggestion: string;
    tags?: string[];
    resolvedProducts?: any[];
    [key: string]: any;
  };
  route: {
    suggestion: string;
    origin?: string;
    destination?: string;
    [key: string]: any;
  };
}

/**
 * Enriches the Chat Wonder streamed completion itinerary events with actual
 * physical database products from the CosmeticProduct catalog, linking the
 * UserOutline to the active user's SkinAnalysis scan dynamically, and persisting
 * ItineraryEvent and CosmeticRecommendation records under the active draft.
 */
export async function resolveItineraryCosmetics(
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
      select: {
        id: true,
        skinType: true,
        hydrationPct: true,
        oilinessPct: true,
        concerns: true,
      },
    });

    // 3. Link the skin scan to the current session outline
    if (outline && latestScan) {
      await prisma.userOutline.update({
        where: { id: outline.id },
        data: { skinAnalysisId: latestScan.id },
      });
      logger.info(
        `[resolveItineraryCosmetics] Linked SkinAnalysis id=${latestScan.id} to UserOutline id=${outline.id}`
      );
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
      logger.info(
        `[resolveItineraryCosmetics] Wiped previous draft events for UserOutline id=${outline.id}`
      );
    }

    // 5. Query the physical catalog products from the database
    const catalog = await prisma.cosmeticProduct.findMany({
      select: {
        id: true,
        name: true,
        brand: true,
        details: true,
        type: true,
        tags: true,
        spf: true,
        waterproof: true,
        transferProof: true,
        hydrating: true,
        oilFree: true,
        finish: true,
        hexColor: true,
        fileUrl: {
          select: {
            fileUrl: true,
          },
        },
      },
    });

    if (!catalog || !catalog.length) {
      logger.warn("[resolveItineraryCosmetics] Catalog is empty, skipping product resolution");
      return events;
    }

    // 6. Establish skin profile baseline (fallback to safe defaults if user has no face scans)
    const skinType = latestScan ? latestScan.skinType : ("NORMAL" as SKIN_TYPE);
    const hydrationPct = latestScan ? latestScan.hydrationPct : 50;
    const oilinessPct = latestScan ? latestScan.oilinessPct : 50;
    const concerns = latestScan ? latestScan.concerns : [];

    logger.info(
      `[resolveItineraryCosmetics] Resolved skin baseline: ${skinType} | Hydration: ${hydrationPct}% | Oiliness: ${oilinessPct}%`
    );

    // 7. Score, rank, and persist physical products for each event's simulated weather
    for (const event of events) {
      const weatherContext: WeatherContext = {
        oilRisk: event.context?.oilRisk,
        drynessRisk: event.context?.drynessRisk,
        uvRisk: event.context?.uvRisk,
        smudgeRisk: event.context?.smudgeRisk,
        sweatRisk: event.context?.sweatRisk,
        tags: event.context?.tags || [],
      };

      const engineInput: AnalysisInput = {
        skinType,
        hydrationPct,
        oilinessPct,
        concerns,
        weather: weatherContext,
      };

      const ranked = rankProducts(engineInput, catalog as any);

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
            routeSuggestion: event.route?.suggestion ?? null,
            routeOrigin: event.route?.origin ?? null,
            routeDestination: event.route?.destination ?? null,
          },
          select: { id: true },
        });
        createdEventId = createdEvent.id;

        // B. Persist the CosmeticRecommendation rows atomically under dual-link strategy
        if (ranked.length && createdEventId) {
          await prisma.cosmeticRecommendation.createMany({
            data: ranked.map((r) => ({
              userOutlineId: outline.id, // 🛡️ Legacy master list link
              itineraryEventId: createdEventId, // 🌟 New event card link
              cosmeticProductId: r.productId,
              score: r.score,
              rank: r.rank,
              reason: r.reason.join(", "),
              signals: r.signals || {},
            })),
          });
        }
      }

      // C. Extract top 3 physical products for controller dynamic streaming response
      event.cosmetics.resolvedProducts = ranked.slice(0, 3).map((r) => {
        const p = catalog.find((x) => x.id === r.productId);
        return {
          id: r.productId,
          name: p?.name ?? "",
          brand: p?.brand ?? null,
          details: p?.details ?? null,
          type: p?.type ?? null,
          spf: p?.spf ?? null,
          finish: p?.finish ?? null,
          hexColor: p?.hexColor ?? null,
          imageUrl: p?.fileUrl?.fileUrl ?? null,
          score: r.score,
          rank: r.rank,
          reason: r.reason.join(", "),
        };
      });

      logger.info(
        `[resolveItineraryCosmetics] Event: ${event.type} in ${event.timeBlock} persisted and resolved ${event.cosmetics.resolvedProducts.length} products.`
      );
    }

    return events;
  } catch (error) {
    logger.error(
      `[resolveItineraryCosmetics] Error during resolution: ${(error as Error).message}`
    );
    return events;
  }
}
