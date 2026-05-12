import { defaultOpenAIRequest } from "./ai-request.util";

export async function detectLanguage(text: string): Promise<string | null> {
  const prompt = `
    Identify the language of the following text. Return ONLY the name of the language (e.g., English, Spanish, Korean, Tagalog).
    If you're not sure or it's too short, return "Unknown".

    Text: "${text}"
  `;

  try {
    const response = await defaultOpenAIRequest(prompt, {
      temperature: 0,
      maxTokens: 10,
    });

    if (!response || response.toLowerCase() === "unknown") return null;
    return response.trim();
  } catch (error: any) {
    console.error("[OpenAI-Language] Error:", error.message);
    return null;
  }
}
