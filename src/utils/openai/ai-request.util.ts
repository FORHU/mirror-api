import OpenAI from "openai";
import { OPENAI_API_KEY } from "../../config";
import logger from "../logger";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export async function defaultOpenAIRequest(
  prompt: string,
  options: {
    role?: "user" | "system" | "assistant";
    temperature?: number;
    maxTokens?: number;
    model?: string;
  } = {}
) {
  const {
    role = "user",
    temperature = 0.7,
    maxTokens = 800,
    model = "gpt-4o-mini", // Upgraded to gpt-4o-mini
  } = options;

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role, content: prompt }],
      temperature,
      max_tokens: maxTokens,
    });

    return response.choices[0]?.message?.content;
  } catch (error) {
    logger.error(`[OpenAI-Request] Error: ${(error as Error).message}`);
    return null;
  }
}

export default openai;
