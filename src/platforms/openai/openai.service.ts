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
  static async chat(
    prompt: string,
    systemMessage: string = "You are a helpful fashion assistant for a Smart Mirror."
  ) {
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
    } catch (error) {
      const err = error as { response?: { data?: unknown; status?: number }; message: string };
      logger.error("OpenAI Chat Error:", err.response?.data || err.message);
      throw { status: err.response?.status || 500, message: "OpenAI request failed" };
    }
  }

  /**
   * Analyzes a face photo for skin condition. Sends the image to GPT-4o
   * vision and forces a JSON response matching the SkinVisionResult shape
   * so the caller can persist it directly.
   *
   * `imageUrl` must be a publicly reachable URL (we pass S3-hosted file URLs).
   */
  static async analyzeFaceImage(imageUrl: string): Promise<SkinVisionResult> {
    const systemMessage =
      "You are a dermatology-aware skin analyst for a smart mirror. " +
      "Analyze the face in the image and return ONLY valid JSON matching the requested schema. " +
      "Do not include markdown fences, prose, or commentary.";

    const userPrompt =
      "Inspect the face. Return JSON with this exact shape:\n" +
      "{\n" +
      '  "skinType": "COMBINATION" | "OILY" | "DRY" | "NORMAL" | "SENSITIVE",\n' +
      '  "skinTone": string,                    // e.g. "Warm Medium", "Cool Light"\n' +
      '  "hydrationPct": number,                // 0-100 (lower = more dehydrated)\n' +
      '  "oilinessPct": number,                 // 0-100 (higher = oilier T-zone)\n' +
      '  "concerns": string[],                  // short labels, e.g. "Mild dehydration", "Enlarged pores"\n' +
      '  "routineTip": string                   // one sentence, actionable\n' +
      "}\n" +
      "Be conservative — if the image is poor quality, return NORMAL skinType and empty concerns.";

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemMessage },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        },
        { headers: this.headers }
      );

      const raw = response.data.choices[0].message.content as string;
      const parsed = JSON.parse(raw) as SkinVisionResult;

      if (!parsed.skinType || typeof parsed.hydrationPct !== "number") {
        throw { status: 502, message: "Vision response missing required fields" };
      }
      return parsed;
    } catch (error) {
      const err = error as {
        response?: { data?: unknown; status?: number };
        status?: number;
        message: string;
      };
      logger.error("OpenAI Vision Error:", err.response?.data || err.message);

      let finalStatus = err.response?.status || err.status || 500;
      let finalMessage = err.message || "OpenAI vision request failed";

      // If OpenAI returns 401, don't pass it back as a generic 401 because it
      // looks like a client authentication error to the frontend.
      if (finalStatus === 401) {
        finalStatus = 500;
        finalMessage = "Server Configuration Error: Invalid OpenAI API Key (401)";
      }

      throw {
        status: finalStatus,
        message: finalMessage,
      };
    }
  }
}

export type SkinVisionResult = {
  skinType: "COMBINATION" | "OILY" | "DRY" | "NORMAL" | "SENSITIVE";
  skinTone?: string;
  hydrationPct: number;
  oilinessPct: number;
  concerns: string[];
  routineTip: string;
};
