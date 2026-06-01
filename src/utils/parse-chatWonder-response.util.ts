import logger from "./logger";
import type { WeatherContext } from "./cosmetics.util";

export interface OutfitPlan {
  suggestion: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface CosmeticPlan {
  suggestion: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface RoutePlan {
  suggestion: string;
  origin?: string;
  destination?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  address?: string;
  map_error?: string;
  [key: string]: unknown;
}

export interface ChatWonderEvent {
  type: string;
  timeBlock: string;
  context: WeatherContext;
  fashion: OutfitPlan;
  cosmetics: CosmeticPlan;
  route: RoutePlan;
}

export type AIIntent = "FASHION" | "COSMETIC" | "MAP" | "MENU" | "RESTART" | "NONE";

export interface ChatWonderResponse {
  intent: AIIntent;
  message: string;
  outfit_suggestion: string | null;
  mood: string | null;
  cosmetics_suggestion: string | null;
  route_suggestion: string | null;
  images: { url: string; caption?: string }[];
  events: ChatWonderEvent[];
  raw: string;
}

/**
 * Parse ChatWonder response (handles both JSON and markdown formats)
 */
export function parseChatWonderResponse(rawResponse: string): ChatWonderResponse {
  try {
    const trimmed = rawResponse.trim();

    // 1. Try to find and parse JSON
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.message) {
          // Support both new { data: { outfit, cosmetics, route } } and old flat fields
          const data = parsed.data ?? {};
          const outfitSuggestion =
            data.outfit ?? parsed.outfit_suggestion ?? parsed.outfitSuggestion ?? null;
          const cosmeticsSuggestion =
            data.cosmetics ?? parsed.cosmetics_suggestion ?? parsed.cosmeticsSuggestion ?? null;
          const routeSuggestion =
            data.route ?? parsed.route_suggestion ?? parsed.routeSuggestion ?? null;

          // Derive strict intent enum
          let intent: AIIntent = "NONE";
          if (parsed.intent) {
            const upper = String(parsed.intent).toUpperCase();
            if (["FASHION", "COSMETIC", "MAP", "MENU", "RESTART", "NONE"].includes(upper)) {
              intent = upper as AIIntent;
            }
          } else if (outfitSuggestion) {
            intent = "FASHION";
          } else if (cosmeticsSuggestion) {
            intent = "COSMETIC";
          } else if (routeSuggestion) {
            intent = "MAP";
          }

          return {
            intent,
            message: parsed.message.replace(/[*_~`#]/g, "").trim(),
            outfit_suggestion: outfitSuggestion,
            mood: parsed.mood ?? null,
            cosmetics_suggestion: cosmeticsSuggestion,
            route_suggestion: routeSuggestion,
            images: Array.isArray(parsed.images) ? parsed.images : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
            raw: rawResponse,
          };
        }
      } catch (err) {
        logger.warn("[Parser] JSON parse failed, falling back to markdown");
      }
    }

    // 2. Fallback to raw text if JSON fails
    let fallbackText = trimmed.replace(/\[Sources\][\s\S]*$/, "");
    // Strip any raw JSON blocks that might have leaked and failed parsing
    fallbackText = fallbackText.replace(/\{[\s\S]*\}/g, "");
    // Strip common markdown characters that Polly would read out loud
    fallbackText = fallbackText.replace(/[*_~`#]/g, "").trim();

    return {
      intent: "NONE" as AIIntent,
      message: fallbackText || "I'm here to help you.",
      outfit_suggestion: null,
      mood: null,
      cosmetics_suggestion: null,
      route_suggestion: null,
      images: [],
      events: [],
      raw: rawResponse,
    };
  } catch (error) {
    logger.error(`[Parser] Failed to parse response: ${(error as Error).message}`);
    return {
      intent: "NONE" as AIIntent,
      message: "I'm here to help you.",
      outfit_suggestion: null,
      mood: null,
      cosmetics_suggestion: null,
      route_suggestion: null,
      images: [],
      events: [],
      raw: rawResponse,
    };
  }
}
