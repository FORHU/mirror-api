import axios from "axios";
import { OPENAI_API_KEY } from "../../config";
import logger from "../../utils/logger";

export default class OpenAIService {
  private static headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
  };

  /**
   * Generates a chat completion using GPT-4o or GPT-3.5
   */
  static async chat(prompt: string, systemMessage: string = "You are a helpful fashion assistant for a Smart Mirror.") {
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
        },
        { headers: this.headers }
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      logger.error("OpenAI Chat Error:", error.response?.data || error.message);
      throw { status: error.response?.status || 500, message: "OpenAI request failed" };
    }
  }
}
