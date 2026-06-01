import logger from "./logger";
import type { WeatherContext } from "./cosmetics.util";

export interface OutfitPlan {
  suggestion: string;
  resolved_products?: string[];
  resolvedProducts?: ResolvedProduct[];
  tags?: string[];
  [key: string]: unknown;
}

export interface ResolvedProduct {
  id: string;
  name?: string;
  brand?: string | null;
  details?: string | null;
  type?: string | null;
  spf?: number | null;
  finish?: string | null;
  hexColor?: string | null;
  imageUrl?: string | null;
  score?: number;
  rank?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface CosmeticPlan {
  suggestion: string;
  resolved_products?: string[];
  resolvedProducts?: ResolvedProduct[];
  reason?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface RoutePlan {
  suggestion: string;
  origin?: string;
  destination?: string;
  origin_lng?: string | number;
  destination_lat?: string | number;
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
  map: RoutePlan;
}

export type AIIntent = "FASHION" | "COSMETIC" | "MAP" | "MENU" | "RESTART" | "NONE";

export interface ChatWonderParsedResponse {
  intent: AIIntent;
  message: string;
  outfit_suggestion: string | null;
  mood: string | null;
  cosmetics_suggestion: string | null;
  route_suggestion: string | null;
  images: { url: string; caption?: string }[];
  events: ChatWonderEvent[];
  sets?: Record<string, unknown>[];
  raw: string;
  isFallback?: boolean;
}

/**
 * Parse ChatWonder response (handles both JSON and markdown formats)
 */
export function parseChatWonderResponse(rawResponse: string): ChatWonderParsedResponse {
  try {
    const trimmed = rawResponse.trim();

    // 1. Try to find and parse JSON
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.message || parsed.sets || parsed.success) {
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

          let finalMessage = parsed.message ? parsed.message.replace(/[*_~`#]/g, "").trim() : "";

          // Join the specialized suggestions into the main message block for the UI
          if (outfitSuggestion && !finalMessage.includes(outfitSuggestion)) {
            finalMessage += `\n\n[ garments ] ${outfitSuggestion}`;
          }
          if (cosmeticsSuggestion && !finalMessage.includes(cosmeticsSuggestion)) {
            finalMessage += `\n\n[ cosmetics ] ${cosmeticsSuggestion}`;
          }
          if (routeSuggestion && !finalMessage.includes(routeSuggestion)) {
            finalMessage += `\n\n[ map ] ${routeSuggestion}`;
          }

          return {
            intent,
            message: finalMessage.trim(),
            outfit_suggestion: outfitSuggestion,
            mood: parsed.mood ?? null,
            cosmetics_suggestion: cosmeticsSuggestion,
            route_suggestion: routeSuggestion,
            images: Array.isArray(parsed.images) ? parsed.images : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
            sets: Array.isArray(parsed.sets) ? parsed.sets : [],
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
