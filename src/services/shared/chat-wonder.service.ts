import { CHAT_WONDER_API_URL } from "../../config";
import logger from "../../utils/logger";
import CacheUtil from "../../utils/cache.util";
import axios from "axios";
import ChatRepository from "../../repositories/chat.repository";
import GarmentRepo from "../../repositories/garment.repository";
import OutfitRepo from "../../repositories/outfit.repository";
import { prisma } from "../../utils/prisma";

export default class ChatWonderService {
  /**
   * Generates or retrieves a chat session ID from the external ChatWonder API.
   */
  static async generateChatSessionId(userId: string) {
    try {
      const cachedKey = `chat:sessionId:${userId}`;
      let sessionId = await CacheUtil.get(cachedKey);

      if (!sessionId) {
        if (!CHAT_WONDER_API_URL) {
          logger.warn("[ChatWonderService] CHAT_WONDER_API_URL not defined");
          return "";
        }

        const response = await axios.get(`${CHAT_WONDER_API_URL}/session-id`);
        sessionId = response.data?.session_id || "";

        if (sessionId) {
          await CacheUtil.set(cachedKey, sessionId, 24 * 60 * 60); // 24 hours
        }
      }
      return sessionId;
    } catch (error) {
      logger.error(`[ChatWonderService] generateChatSessionId Error: ${(error as Error).message}`);
      return "";
    }
  }

  /**
   * Ensures a conversation exists for the user.
   */
  static async ensureConversation(userId: string, title?: string, conversationId?: string) {
    if (conversationId) {
      const existing = await ChatRepository.getConversationById(conversationId);
      if (existing && existing.userId === userId) return conversationId;
    }

    const conversation = await ChatRepository.createConversation({
      userId,
      title: title || "New Chat",
    });
    return conversation.id;
  }

  /**
   * Saves a user message to the history.
   */
  static async saveUserMessage(userId: string, conversationId: string, message: string) {
    return ChatRepository.createMessage({
      conversationId,
      message,
      role: "USER",
    });
  }

  /**
   * Saves an AI message to the history.
   */
  static async saveAIMessage(userId: string, conversationId: string, message: string) {
    return ChatRepository.createMessage({
      conversationId,
      message,
      role: "AI",
    });
  }

  /**
   * Fetches and formats the user's real wardrobe, outfits, weather, and
   * cosmetic recommendations as a structured context block for the AI prompt.
   */
  static async buildUserContext(
    userId: string,
    conversationId?: string
  ): Promise<{
    garments: string;
    outfits: string;
    weather: string;
    cosmetics: string;
  }> {
    // --- Garments ---
    let garmentsBlock = "No garments found in wardrobe.";
    try {
      const { data: garments } = await GarmentRepo.findAll({ userId }, 1, 20);
      if (garments.length) {
        garmentsBlock = garments
          .map((g) => {
            const types = g.garmentType.join(", ") || "Unknown";
            const cats = g.category.join(", ") || "Uncategorized";
            const tagNames = g.tags.map((t: { name: string }) => t.name).join(", ");
            return `- ${g.name} [${types}] | Category: ${cats} | Silhouette: ${g.silhouette}${tagNames ? ` | Tags: ${tagNames}` : ""}`;
          })
          .join("\n");
      }
    } catch (e) {
      logger.warn(`[ChatWonderService] buildUserContext garments error: ${(e as Error).message}`);
    }

    // --- Outfits ---
    let outfitsBlock = "No saved outfits.";
    try {
      const { data: outfits } = await OutfitRepo.findByUserId(userId, 1, 5);
      if (outfits.length) {
        outfitsBlock = outfits
          .map((o) => {
            const pieces = o.items
              .map((item: { garment: { name: string } }) => item.garment.name)
              .join(" + ");
            return `- "${o.name}"${pieces ? `: ${pieces}` : ""}`;
          })
          .join("\n");
      }
    } catch (e) {
      logger.warn(`[ChatWonderService] buildUserContext outfits error: ${(e as Error).message}`);
    }

    // --- Weather from linked UserOutline ---
    let weatherBlock = "No weather data available.";
    try {
      if (conversationId) {
        const outline = await prisma.userOutline.findUnique({
          where: { conversationId },
          include: { weather: true },
        });
        const w = outline?.weather;
        if (w) {
          weatherBlock =
            `Temperature: ${w.temperature}°C | Humidity: ${w.humidity}% | ` +
            `UV Index: ${w.uvIndex} | Wind: ${w.windSpeed} km/h | ` +
            `Condition: ${w.conditionType} (${w.intensity})\n` +
            `Risks → UV: ${w.uvRisk}/100 | Sweat: ${w.sweatRisk}/100 | ` +
            `Oil: ${w.oilRisk}/100 | Dryness: ${w.drynessRisk}/100 | Smudge: ${w.smudgeRisk}/100\n` +
            `Weather Tags: ${w.tags.join(", ")}`;
        }
      }
    } catch (e) {
      logger.warn(`[ChatWonderService] buildUserContext weather error: ${(e as Error).message}`);
    }

    // --- Cosmetic Recommendations from linked outline ---
    let cosmeticsBlock = "No cosmetics recommendations on file.";
    try {
      if (conversationId) {
        const outline = await prisma.userOutline.findUnique({
          where: { conversationId },
          include: {
            cosmeticRecommendations: {
              include: { cosmeticProduct: true },
              orderBy: { rank: "asc" },
              take: 10,
            },
          },
        });
        const recs = outline?.cosmeticRecommendations ?? [];
        if (recs.length) {
          cosmeticsBlock = recs
            .map((r) => {
              const p = r.cosmeticProduct;
              const attrs = [
                p.type,
                p.finish ? `${p.finish} finish` : null,
                p.spf ? `SPF ${p.spf}` : null,
                p.waterproof ? "waterproof" : null,
                p.hydrating ? "hydrating" : null,
                p.oilFree ? "oil-free" : null,
              ]
                .filter(Boolean)
                .join(", ");
              return `- ${p.name}${p.brand ? ` by ${p.brand}` : ""} [${attrs}]${r.reason ? ` — ${r.reason}` : ""}`;
            })
            .join("\n");
        }
      }
    } catch (e) {
      logger.warn(`[ChatWonderService] buildUserContext cosmetics error: ${(e as Error).message}`);
    }

    return {
      garments: garmentsBlock,
      outfits: outfitsBlock,
      weather: weatherBlock,
      cosmetics: cosmeticsBlock,
    };
  }

  /**
   * Formats the additional prompt for the ChatWonder API.
   * Supports a modular 4-persona system:
   *   - system:    General assistant voice and tone for the top-level message field.
   *   - fashion:   Personality for outfit_suggestion and event fashion blocks.
   *   - cosmetics: Personality for cosmetics_suggestion and event cosmetics blocks.
   *   - maps:      Personality for route_suggestion and event route blocks.
   */
  static async getAdditionalPrompt(
    userMessage: string,
    personas?: {
      system?: string | null;
      fashion?: string | null;
      cosmetics?: string | null;
      maps?: string | null;
    },
    context?: {
      garments: string;
      outfits: string;
      weather: string;
      cosmetics: string;
    }
  ) {
    console.log("+++++++++getAdditionalPrompt", userMessage, personas, context);
    const systemPersona =
      personas?.system?.trim() ||
      "A polite and efficient Smart Mirror Lifestyle Assistant who manages daily planning, styling, skincare, and navigation.";
    const fashionPersona =
      personas?.fashion?.trim() ||
      "A knowledgeable fashion stylist who gives practical yet stylish outfit advice.";
    const cosmeticsPersona =
      personas?.cosmetics?.trim() ||
      "A professional makeup artist and skincare expert who gives science-backed cosmetic advice.";
    const mapsPersona =
      personas?.maps?.trim() ||
      "A helpful local guide who gives clear, efficient travel and routing recommendations.";

    const contextBlock = context
      ? `
[USER WARDROBE & CONTEXT]
IMPORTANT: Base fashion suggestions on the garments and outfits listed below. Reference items by their exact name when possible.

Garments in wardrobe:
${context.garments}

Saved outfits:
${context.outfits}

Recommended cosmetics for this user:
${context.cosmetics}

[CURRENT WEATHER]
${context.weather}
`
      : "";

    return `You are an advanced Smart Mirror Lifestyle Assistant.

[SYSTEM PERSONA] Your overall voice and tone: ${systemPersona}

When generating the JSON response, apply these specialized personas strictly to their respective fields:
- "message" & top-level replies → [SYSTEM PERSONA] above
- "outfit_suggestion" & all "events[].fashion" blocks → Fashion Expert: ${fashionPersona}
- "cosmetics_suggestion" & all "events[].cosmetics" blocks → Cosmetics Expert: ${cosmeticsPersona}
- "route_suggestion" & all "events[].route" blocks → Navigation Expert: ${mapsPersona}
${contextBlock}
Respond with ONLY VALID JSON, no markdown, no extra text.
{
  "message": "Your helpful daily planning and lifestyle response here",
  "outfit_suggestion": "Describe a recommended outfit if applicable",
  "mood": "happy/chill/etc",
  "cosmetics_suggestion": "Describe recommended cosmetics or skincare products if applicable",
  "route_suggestion": "Describe recommended travel routes or locations if applicable",
  "events": [
    {
      "type": "jog | meeting | date",
      "timeBlock": "e.g. morning | afternoon | noon",
      "context": {
        "oilRisk": 0,
        "drynessRisk": 0,
        "uvRisk": 0,
        "smudgeRisk": 0,
        "sweatRisk": 0,
        "tags": ["sunny", "rainy", "hot", "cold"]
      },
      "fashion": {
        "suggestion": "outfit suggestion text",
        "tags": ["streetwear", "casual", "formal"]
      },
      "cosmetics": {
        "suggestion": "makeup/skincare advice",
        "tags": ["waterproof", "matte", "hydrating"]
      },
      "route": {
        "suggestion": "travel or location routing advice",
        "origin": "starting place",
        "destination": "target place"
      }
    }
  ]
}

USER: ${userMessage}`;
  }
}
