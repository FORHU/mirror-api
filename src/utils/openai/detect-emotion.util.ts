import { defaultOpenAIRequest } from "./ai-request.util";
import logger from "../logger";

export async function detectEmotion(text: string): Promise<{
  emotion: string;
  confidence: number;
  explanation?: string;
}> {
  const prompt = `
    Analyze the emotional tone of the following text and return a JSON object with:
    - "emotion": One word representing the primary emotion (e.g., happy, sad, angry, anxious, neutral, excited, curious).
    - "confidence": A float between 0 and 1.
    - "explanation": A brief one-sentence reason for this choice.

    Text: "${text}"
    
    JSON:
  `;

  try {
    const response = await defaultOpenAIRequest(prompt, {
      temperature: 0,
      maxTokens: 150,
      model: "gpt-4o-mini",
    });

    if (!response) throw new Error("No response from OpenAI");

    // Clean response if it contains markdown code blocks
    const cleaned = response.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (error) {
    logger.error(`[OpenAI-Emotion] Error: ${(error as Error).message}`);
    return { emotion: "neutral", confidence: 0 };
  }
}
