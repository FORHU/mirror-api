import axios from "axios";
import { CHAT_WONDER_API_URL } from "../../config";
import logger from "../../utils/logger";

export default class ChatWonderService {
  /**
   * Sends a query to the Chat Wonder API
   */
  static async ask(query: string, userId?: string) {
    try {
      logger.info(`Sending query to Chat Wonder: ${query}`);
      
      const response = await axios.post(`${CHAT_WONDER_API_URL}/chat`, {
        query,
        userId: userId || "anonymous",
      });

      return response.data;
    } catch (error: any) {
      logger.error("Chat Wonder Error:", error.response?.data || error.message);
      throw { status: error.response?.status || 500, message: "Chat Wonder request failed" };
    }
  }

  /**
   * Health check for the Chat Wonder endpoint
   */
  static async checkStatus() {
    try {
      await axios.get(`${CHAT_WONDER_API_URL}/health`);
      return true;
    } catch (error) {
      return false;
    }
  }
}
