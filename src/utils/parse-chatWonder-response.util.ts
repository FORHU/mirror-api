import logger from "./logger";
import type { WeatherContext } from "./cosmetics.util";

export interface OutfitPlan {
  suggestion: string;
  tags?: string[];
  [key: string]: any;
}

export interface CosmeticPlan {
  suggestion: string;
  tags?: string[];
  [key: string]: any;
}

export interface RoutePlan {
  suggestion: string;
  origin?: string;
  destination?: string;
  [key: string]: any;
}

export interface ChatWonderEvent {
  type: "jog" | "meeting" | "date";
  timeBlock: string;
  context: WeatherContext;
  fashion: OutfitPlan;
  cosmetics: CosmeticPlan;
  route: RoutePlan;
}

export interface ChatWonderResponse {
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
          return {
            message: parsed.message,
            outfit_suggestion: parsed.outfit_suggestion ?? parsed.outfitSuggestion ?? null,
            mood: parsed.mood ?? null,
            cosmetics_suggestion: parsed.cosmetics_suggestion ?? parsed.cosmeticsSuggestion ?? null,
            route_suggestion: parsed.route_suggestion ?? parsed.routeSuggestion ?? null,
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
    return {
      message: trimmed.replace(/\[Sources\][\s\S]*$/, "").trim() || "Here's something for you.",
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
