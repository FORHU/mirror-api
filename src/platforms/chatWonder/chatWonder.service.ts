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
        user_input: query,
        user_history_select: "",
        session_id: userId || "anonymous",
        document_context: "",
      });

      return response.data;
    } catch {
      const err = error as { response?: { data?: unknown; status?: number }; message: string };
      logger.error("Chat Wonder Error:", err.response?.data || err.message);
      throw { status: err.response?.status || 500, message: "Chat Wonder request failed" };
    }
  }

  /**
   * Health check for the Chat Wonder endpoint
   */
  static async checkStatus() {
    try {
      await axios.get(`${CHAT_WONDER_API_URL}/health`);
      return true;
    } catch {
      return false;
    }
  }
}
