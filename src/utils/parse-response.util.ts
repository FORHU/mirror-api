import logger from "./logger";

export interface ParsedVideo {
  title: string;
  artist: string | null;
  url: string;
}

export interface ChatWonderResponse {
  message: string;
  emotion_data: {
    emotion: string;
    confidence: number;
    wasMapped: boolean;
  };
  videos: ParsedVideo[];
  artist: { name: string; image: string | null }[];
  images: { url: string; caption?: string }[];
  raw: string;
}

/**
 * Parse ChatWonder response (handles both JSON and markdown formats)
 */
export function parseChatWonderResponse(rawResponse: string): ChatWonderResponse {
  try {
    let trimmed = rawResponse.trim();

    // 1. Try to find and parse JSON
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.message) {
          return {
            message: parsed.message,
            emotion_data: {
              emotion: parsed.emotion || "neutral",
              confidence: parsed.confidence ?? 0.5,
              wasMapped: true,
            },
            videos: Array.isArray(parsed.videos) ? parsed.videos : [],
            artist: Array.isArray(parsed.artist) ? parsed.artist : [],
            images: Array.isArray(parsed.images) ? parsed.images : [],
            raw: rawResponse,
          };
        }
      } catch (err) {
        logger.warn("[Parser] JSON parse failed, falling back to markdown");
      }
    }

    // 2. Fallback to raw text if JSON fails
    return {
      message: trimmed.replace(/\[Sources\][\s\S]*$/, "").trim() || "Here's something for you.",
      emotion_data: {
        emotion: "neutral",
        confidence: 0.5,
        wasMapped: false,
      },
      videos: [],
      artist: [],
      images: [],
      raw: rawResponse,
    };
  } catch (error: any) {
    logger.error(`[Parser] Failed to parse response: ${error.message}`);
    return {
      message: "I'm here to help you.",
      emotion_data: { emotion: "neutral", confidence: 0.5, wasMapped: false },
      videos: [],
      artist: [],
      images: [],
      raw: rawResponse,
    };
  }
}
