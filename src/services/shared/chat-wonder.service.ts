import { CHAT_WONDER_API_URL } from "../../config";
import logger from "../../utils/logger";
import CacheUtil from "../../utils/cache.util";
import axios from "axios";
import ChatRepository from "../../repositories/chat.repository";

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
   * Formats the additional prompt for the ChatWonder API.
   * Tailored for the Smart Mirror context.
   */
  static async getAdditionalPrompt(userMessage: string) {
    return `You are a Smart Mirror fashion assistant. Respond with ONLY VALID JSON.
{
  "message": "Your helpful fashion advice here",
  "outfit_suggestion": "Describe a recommended outfit if applicable",
  "mood": "happy/chill/etc"
}

USER: ${userMessage}`;
  }
}
