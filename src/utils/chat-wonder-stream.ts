import WebSocket from "ws";
import { CHAT_WONDER_API_URL } from "../config";
import logger from "./logger";
import { PromptBuilder } from "../ai/prompt/prompt.builder";

interface StreamMessage {
  type?: string;
  data?: string;
  name?: string;
  message?: string;
  [key: string]: unknown;
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export async function streamChat(
  userInput: string,
  sessionId: string,
  persona: string | undefined,
  callbacks: StreamCallbacks,
  documentContext: string = "",
  userHistorySelect: string = "",
  weather: Record<string, unknown> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!CHAT_WONDER_API_URL) {
      const error = new Error("CHAT_WONDER_API_URL is not defined in config");
      callbacks.onError(error);
      return reject(error);
    }

    let completed = false;
    const safeComplete = () => {
      if (completed) return;
      completed = true;
      try {
        callbacks.onComplete();
      } catch (e) {
        // Ignore if already completed
      }
    };

    const wsUrl = CHAT_WONDER_API_URL.replace("http://", "ws://").replace("https://", "wss://");
    const wsEndpoint = `${wsUrl}/chat-stream`;

    logger.info(`[CHAT-WONDER-STREAM] Connecting to ${wsEndpoint}`);

    const ws = new WebSocket(wsEndpoint);

    ws.on("open", () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket connected");

      const builtPrompt = PromptBuilder.build({
        input: userInput,
        persona,
        context: {
          weather,
          document_context: documentContext,
        },
        history: userHistorySelect,
      });

      const payload = {
        session_id: sessionId,
        system: builtPrompt.system,
        user_input: builtPrompt.user,
        context: builtPrompt.context,
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
          callbacks.onError(error);
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
          callbacks.onError(new Error(msg.message));
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
      callbacks.onError(error);
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
