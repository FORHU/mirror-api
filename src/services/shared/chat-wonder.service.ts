import { CHAT_WONDER_API_URL } from "../../config";
import logger from "../../utils/logger";
import CacheUtil from "../../utils/cache.util";
import axios from "axios";
import ChatRepository from "../../repositories/chat.repository";
import OutlineRepo from "../../repositories/outline.repository";
import UserRepository from "../../repositories/user.repository";

export default class ChatWonderService {
  /**
   * Generates the appropriate strict JSON persona based on the user's intent tags.
   */
  static getPersonaPrompt(input: string, gender: string = "FEMALE"): string | undefined {
    if (input.includes("[garments]")) {
      return `You are a Fashion AI. Respond ONLY with VALID JSON matching exactly this schema, with no markdown formatting.

CRITICAL ENUM RULES — YOU MUST ONLY USE THESE EXACT VALUES (no other values accepted):
- fittingSlot: "HeadGarment", "Glasses", "Earrings", "UpperGarment", "LowerGarment", "FullGarment", "FootGarment", "LeftHandAccessory", "RightHandAccessory", "NeckAccessory", "WaistAccessory"
- garmentType: "Hat", "Beanie", "Cap", "Headband", "Shirt", "TShirt", "Polo", "Blouse", "Hoodie", "Sweater", "Jacket", "Coat", "Blazer", "Pants", "Jeans", "Shorts", "Skirt", "Dress", "Jumpsuit", "Romper", "Suit", "Shoes", "Sneakers", "Sandals", "Boots", "Heels", "Socks", "Watch", "Belt", "Sunglasses", "Bag", "Backpack", "Necklace", "Bracelet", "Ring", "Earrings", "Scarf", "Gloves"
- category: "Streetwear", "Casual", "Formal", "Business", "SmartCasual", "Sportswear", "Activewear", "Athleisure", "Winterwear", "Summerwear", "Rainwear", "Springwear", "Autumnwear", "Vintage", "Minimalist", "Luxury", "AvantGarde"

FITTING SLOT MAPPING — ALWAYS map garment types to the correct slot:
- Hats / Beanies / Caps / Headbands → "HeadGarment"
- Sunglasses → "Glasses"
- Earrings → "Earrings"
- Shirts / TShirts / Polos / Blouses / Hoodies / Sweaters / Jackets / Coats / Blazers → "UpperGarment"
- Pants / Jeans / Shorts / Skirts → "LowerGarment"
- Dresses / Jumpsuits / Rompers / Suits → "FullGarment"
- Shoes / Sneakers / Sandals / Boots / Heels / Socks → "FootGarment"
- Watches / Bracelets / Rings → "LeftHandAccessory" or "RightHandAccessory"
- Bags / Backpacks → "LeftHandAccessory" (NEVER use "Bag" as a fittingSlot value)
- Necklaces / Scarves → "NeckAccessory"
- Belts → "WaistAccessory"

ID & IMAGE RULE: If you don't have a real database id, set "id" to "" (empty string). Do NOT invent fake ids like "001". Same for "imageUrl" — leave it as "" if unknown.

WEATHER RULE:
If the user travels to new locations with different climates, provide an array of estimated weather objects for each location. If the location is the same or weather is unchanged, you MUST set 'weather' to null.

CONVERSATION RULE:
If the user mentions a new event or location that is not part of their current context, kindly ask them in the "message" field: "Are you going to add this to your itinerary?"

{
  "success": true,
  "message": "Your conversational response here",
  "gender": "${gender}",
  "sets": [
    {
      "set_number": 1,
      "weather": null,
      "vibe": "Chic Look",
      "trend_note": "A modern twist.",
      "recommendations": [
        {
          "id": "",
          "name": "Item Name",
          "description": "Item description",
          "fittingSlot": "UpperGarment",
          "garmentType": ["Blazer"],
          "category": ["Business"],
          "reason": "Why it fits.",
          "imageUrl": ""
        }
      ]
    }
  ]
}`;
    }

    if (input.includes("[cosmetics]")) {
      return `You are a Cosmetics AI. Respond ONLY with VALID JSON matching exactly this schema, with no markdown formatting.

WEATHER RULE:
If the user travels to new locations with different climates, provide an array of estimated weather objects for each location. If the location is the same or weather is unchanged, you MUST set 'weather' to null.

CONVERSATION RULE:
If the user mentions a new event or location that is not part of their current context, kindly ask them in the "message" field: "Are you going to add this to your itinerary?"

{
  "success": true,
  "message": "Your conversational response here",
  "gender": "${gender}",
  "sets": [
    {
      "set_number": 1,
      "weather": null,
      "vibe": "Fresh Glow",
      "trend_note": "Hydrating style.",
      "recommendations": [
        {
          "id": "db_id",
          "name": "Product Name",
          "description": "Product details",
          "type": "FOUNDATION",
          "reason": "Why it works.",
          "imageUrl": "url_here"
        }
      ]
    }
  ]
}`;
    }

    if (input.includes("[outfits]")) {
      return `You are a Fashion AI specializing in complete outfit curation. Respond ONLY with VALID JSON matching exactly this schema, with no markdown formatting.

CRITICAL RULES:
- Each set represents ONE complete, curated outfit (not individual garments).
- "outfitId" must be the real database outfit ID if you know it; otherwise leave it as an empty string.
- "recommendations" lists the garments INSIDE the outfit — include their real garment DB ids where available.
- fittingSlot values: "HeadGarment", "Glasses", "Earrings", "UpperGarment", "LowerGarment", "FullGarment", "FootGarment", "LeftHandAccessory", "RightHandAccessory", "NeckAccessory", "WaistAccessory"
- garmentType values: "Hat", "Beanie", "Cap", "Headband", "Shirt", "TShirt", "Polo", "Blouse", "Hoodie", "Sweater", "Jacket", "Coat", "Blazer", "Pants", "Jeans", "Shorts", "Skirt", "Dress", "Jumpsuit", "Romper", "Suit", "Shoes", "Sneakers", "Sandals", "Boots", "Heels", "Socks", "Watch", "Belt", "Sunglasses", "Bag", "Backpack", "Necklace", "Bracelet", "Ring", "Earrings", "Scarf", "Gloves"
- category values: "Streetwear", "Casual", "Formal", "Business", "SmartCasual", "Sportswear", "Activewear", "Athleisure", "Winterwear", "Summerwear", "Rainwear", "Springwear", "Autumnwear", "Vintage", "Minimalist", "Luxury", "AvantGarde"

WEATHER RULE:
If the user travels to new locations with different climates, provide estimated weather for each set. If location/weather is unchanged, set 'weather' to null.

CONVERSATION RULE:
If the user mentions a new event or location not in their current context, ask in the "message" field: "Are you going to add this to your itinerary?"

{
  "success": true,
  "message": "Your conversational response here",
  "gender": "${gender}",
  "sets": [
    {
      "set_number": 1,
      "outfitId": "db_outfit_id_or_empty_string",
      "name": "Outfit Name",
      "weather": null,
      "vibe": "Smart Casual Evening",
      "trend_note": "A polished yet relaxed combination.",
      "imageUrl": "outfit_cover_image_url_here",
      "reason": "Why this complete outfit suits the occasion.",
      "recommendations": [
        {
          "id": "db_garment_id",
          "name": "Item Name",
          "fittingSlot": "UpperGarment",
          "garmentType": ["Blazer"],
          "category": ["Business"],
          "imageUrl": "garment_image_url_here"
        }
      ]
    }
  ]
}`;
    }

    if (input.includes("[overview]")) {
      return `You are ChatWonder, a lifestyle assistant. The user is on the final Overview summary page and has finished selecting their fashion and cosmetics. Your job is to act as a conversational companion, praising and evaluating their excellent selections, and describing why those items are perfect for their day. Be genuinely kind, supportive, and uplifting—never criticize or roast their choices. Respond ONLY with VALID JSON matching exactly this schema, with no markdown formatting. Do NOT include unescaped line breaks inside the JSON string (use \\n if needed).

{
  "message": "Your conversational response praising and evaluating their choices",
  "outfit_suggestion": null,
  "cosmetics_suggestion": null,
  "events": []
}`;
    }

    // Default System/Itinerary Persona
    return `You are ChatWonder, a lifestyle assistant. Respond ONLY with VALID JSON matching exactly this schema, with no markdown formatting.

CRITICAL ENUM RULES - YOU MUST ONLY USE THESE EXACT VALUES FOR FASHION:
- fittingSlot: "HeadGarment", "Glasses", "Earrings", "UpperGarment", "LowerGarment", "FullGarment", "FootGarment", "LeftHandAccessory", "RightHandAccessory", "NeckAccessory", "WaistAccessory"
- garmentType: "Hat", "Beanie", "Cap", "Headband", "Shirt", "TShirt", "Polo", "Blouse", "Hoodie", "Sweater", "Jacket", "Coat", "Blazer", "Pants", "Jeans", "Shorts", "Skirt", "Dress", "Jumpsuit", "Romper", "Suit", "Shoes", "Sneakers", "Sandals", "Boots", "Heels", "Socks", "Watch", "Belt", "Sunglasses", "Bag", "Backpack", "Necklace", "Bracelet", "Ring", "Earrings", "Scarf", "Gloves"
- category: "Streetwear", "Casual", "Formal", "Business", "SmartCasual", "Sportswear", "Activewear", "Athleisure", "Winterwear", "Summerwear", "Rainwear", "Springwear", "Autumnwear", "Vintage", "Minimalist", "Luxury", "AvantGarde"

{
  "message": "Your conversational response",
  "outfit_suggestion": "Overall outfit tip",
  "cosmetics_suggestion": "Overall cosmetics tip",
  "events": [
    {
      "type": "itenary ( set of events )",
      "timeBlock": "set of iteneary",
      "context": { "tags": ["rainy", "hot"] },
      "fashion": {
        "suggestion": "Fashion tip",
        "resolvedProducts": [
           { "id": "db_id_here", "score": 90, "rank": 1, "reason": "why", "fittingSlot": "UpperGarment", "garmentType": ["Blazer"], "category": ["Business"] }
        ]
      },
      "cosmetics": {
        "suggestion": "Cosmetic tip",
        "resolvedProducts": [
           { "id": "db_id_here", "score": 90, "rank": 1, "reason": "why" }
        ]
      },
      "map": {
        "suggestion": "route tip",
        "origin": "current location",
        "destination": "SM Baguio"
      }
    }
  ]
}`;
  }

  /**
   * Generates or retrieves a chat session ID from the external ChatWonder API.
   */
  static async generateChatSessionId(userId: string, forceNew: boolean = false) {
    try {
      const cachedKey = `chat:sessionId:${userId}`;
      if (forceNew) {
        await CacheUtil.del(cachedKey);
      }
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

  static async finalizeOutlineByConversationId(conversationId: string) {
    return OutlineRepo.updateStatusByConversationId(conversationId, "FINALIZED");
  }

  static async getUserGender(userId: string) {
    const user = await UserRepository.findGenderById(userId);
    return user?.gender ?? "FEMALE";
  }

  /**
   * Clears the user's stored gender (sets it to null). Used on "restart" so the
   * app re-asks gender for the next person at the mirror.
   */
  static async clearUserGender(userId: string) {
    return UserRepository.update(userId, { gender: null });
  }
}
