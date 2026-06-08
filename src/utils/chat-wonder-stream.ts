import WebSocket from "ws";
import { CHAT_WONDER_API_URL } from "../config";
import logger from "./logger";
// import { PromptBuilder } from "../ai/prompt/prompt.builder";

interface StreamMessage {
  type?: string;
  data?: string;
  name?: string;
  message?: string;
  [key: string]: unknown;
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: () => void | Promise<void>;
  onError: (error: Error) => void | Promise<void>;
}

export interface StreamChatOptions {
  userInput: string;
  sessionId: string;
  callbacks: StreamCallbacks;
  userId?: string;
  outlineId?: string;
  weather?: Record<string, unknown>;
  location?: Record<string, unknown>;
  skinAnalysis?: Record<string, unknown>;
  gender?: string;
  /** App routes ChatWonder may navigate to (for `[nav]` requests). */
  sitemapContext?: string[];
  /** Compact product/document context injected into ChatWonder for grounded recommendations. */
  documentContext?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

function normalizeGender(value?: string): "MALE" | "FEMALE" | "UNISEX" | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "MALE" || normalized === "FEMALE" || normalized === "UNISEX") {
    return normalized;
  }
  return null;
}

function isGarmentRequest(input: string): boolean {
  return /\[(?:garment|stylist)\]|\b(?:fashion|outfit|outfits|garment|garments|clothes|clothing|wear|dress me|style me)\b/i.test(
    input
  );
}

function buildGenderScopedInput(input: string, gender?: string): string {
  const normalizedGender = normalizeGender(gender);
  if (!normalizedGender || !isGarmentRequest(input)) return input;

  const allowed =
    normalizedGender === "UNISEX"
      ? "UNISEX garments and clearly gender-neutral styling"
      : `${normalizedGender} or UNISEX garments`;
  const avoid =
    normalizedGender === "MALE"
      ? "Avoid feminine-coded garments such as dresses, skirts, heels, and women's silhouettes unless the user explicitly asks for them."
      : normalizedGender === "FEMALE"
        ? "Avoid masculine-coded garments such as men's suits, men's dress shirts, and men's silhouettes unless the user explicitly asks for them."
        : "Avoid strongly gendered styling unless the user explicitly asks for it.";

  return [
    `[SYSTEM] Fashion gender guard: the current user's stored gender is ${normalizedGender}.`,
    `For garment and outfit recommendations, only choose ${allowed}.`,
    avoid,
    "If catalog items include a gender field, treat that field as a hard filter before building outfits.",
    "[END SYSTEM]",
    input,
  ].join("\n");
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const {
    userInput,
    sessionId,
    callbacks,
    userId,
    outlineId,
    weather = {},
    location,
    skinAnalysis,
    gender,
    sitemapContext,
    documentContext,
    history,
  } = options;

  return new Promise((resolve, reject) => {
    if (!CHAT_WONDER_API_URL) {
      const error = new Error("CHAT_WONDER_API_URL is not defined in config");
      Promise.resolve(callbacks.onError(error)).catch((callbackError) => {
        logger.warn(
          `[CHAT-WONDER-STREAM] onError callback failed: ${(callbackError as Error).message}`
        );
      });
      return reject(error);
    }

    let completed = false;
    const safeComplete = () => {
      if (completed) return;
      completed = true;
      Promise.resolve(callbacks.onComplete()).catch((callbackError) => {
        logger.warn(
          `[CHAT-WONDER-STREAM] onComplete callback failed: ${(callbackError as Error).message}`
        );
      });
    };

    const wsUrl = CHAT_WONDER_API_URL.replace("http://", "ws://").replace("https://", "wss://");
    const wsEndpoint = `${wsUrl}/chat-stream`;

    logger.info(`[CHAT-WONDER-STREAM] Connecting to ${wsEndpoint}`);

    const ws = new WebSocket(wsEndpoint);

    ws.on("open", () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket connected");

      //   const builtPrompt = PromptBuilder.build({
      //     input: userInput,
      //     context: {
      //       weather,
      //       document_context: documentContext,
      //     },
      //     history: userHistorySelect,
      //   });

      const payload = {
        session_id: sessionId,
        // Only assert a gender when we actually know it. When it's unset we send
        // the input as-is so the (external) persona can ask, rather than faking one.
        user_input: buildGenderScopedInput(userInput, gender),
        ...(userId ? { user_id: userId } : {}),
        ...(outlineId ? { outline_id: outlineId } : {}),
        weather,
        ...(location ? { location } : {}),
        ...(skinAnalysis ? { skin_analysis: skinAnalysis } : {}),
        ...(gender ? { gender } : {}),
        ...(sitemapContext && sitemapContext.length ? { sitemap_context: sitemapContext } : {}),
        ...(documentContext ? { document_context: documentContext } : {}),
        ...(history && history.length ? { history } : {}),
      };
      logger.info(
        `[CHAT-WONDER-STREAM] user payload: ${JSON.stringify({ ...payload, user_input: payload.user_input.slice(0, 120) + "..." })}`
      );
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (data: WebSocket.Data) => {
      const raw = data.toString();

      let msg: StreamMessage | null = null;
      try {
        msg = JSON.parse(raw);
      } catch {
        // Fallback for backward compatibility with old backend formats
        if (raw === "__END__") {
          logger.info("[CHAT-WONDER-STREAM] Stream complete (legacy)");
          safeComplete();
          ws.close();
          resolve();
          return;
        }

        if (raw.startsWith("[Error]")) {
          logger.error(`[CHAT-WONDER-STREAM] Error: ${raw}`);
          const error = new Error(raw);
          Promise.resolve(callbacks.onError(error)).catch((callbackError) => {
            logger.warn(
              `[CHAT-WONDER-STREAM] onError callback failed: ${(callbackError as Error).message}`
            );
          });
          ws.close();
          reject(error);
          return;
        }

        if (raw.startsWith("[Tool]")) {
          logger.info(`[CHAT-WONDER-STREAM] Tool execution: ${raw}`);
          return;
        }

        logger.info(`[CHAT-WONDER-STREAM] Received chunk (${raw.length} chars) (legacy)`);
        callbacks.onChunk(raw);
        return;
      }

      if (!msg || typeof msg !== "object") {
        logger.warn(`[CHAT-WONDER-STREAM] Received non-object JSON message: ${raw}`);
        return;
      }

      // JSON Protocol Parsing
      switch (msg.type) {
        case "chunk":
          callbacks.onChunk(msg.data ?? raw);
          break;

        case "tool":
          logger.info(`[CHAT-WONDER-STREAM] Tool: ${msg.name}`);
          break;

        case "end":
          logger.info("[CHAT-WONDER-STREAM] Stream complete");
          safeComplete();
          ws.close();
          resolve();
          break;

        case "error":
          logger.error(`[CHAT-WONDER-STREAM] Error: ${msg.message}`);
          Promise.resolve(callbacks.onError(new Error(msg.message))).catch((callbackError) => {
            logger.warn(
              `[CHAT-WONDER-STREAM] onError callback failed: ${(callbackError as Error).message}`
            );
          });
          ws.close();
          reject(new Error(msg.message));
          break;

        default:
          // External API sends JSON in an unrecognized format — treat the raw message as a chunk
          logger.info(
            `[CHAT-WONDER-STREAM] Unrecognized JSON type "${msg.type ?? "none"}", treating as raw chunk`
          );
          callbacks.onChunk(raw);
          break;
      }
    });

    ws.on("error", (error) => {
      logger.error(`[CHAT-WONDER-STREAM] WebSocket error: ${error.message}`);
      Promise.resolve(callbacks.onError(error)).catch((callbackError) => {
        logger.warn(
          `[CHAT-WONDER-STREAM] onError callback failed: ${(callbackError as Error).message}`
        );
      });
      reject(error);
    });

    ws.on("close", () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket closed");
      // Fallback: If the server closes the connection abruptly without sending __END__
      safeComplete();
      resolve();
    });
  });
}
