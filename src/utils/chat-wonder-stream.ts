import WebSocket from "ws";
import { CHAT_WONDER_API_URL } from "../config";
import logger from "./logger";

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
  userHistorySelect: string = ""
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!CHAT_WONDER_API_URL) {
      const error = new Error("CHAT_WONDER_API_URL is not defined in config");
      callbacks.onError(error);
      return reject(error);
    }

    const wsUrl = CHAT_WONDER_API_URL.replace("http://", "ws://").replace("https://", "wss://");
    const wsEndpoint = `${wsUrl}/chat-stream`;

    logger.info(`[CHAT-WONDER-STREAM] Connecting to ${wsEndpoint}`);

    const ws = new WebSocket(wsEndpoint);

    ws.on("open", () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket connected");

      const payload = {
        user_input: userInput,
        user_history_select: userHistorySelect,
        session_id: sessionId,
        document_context: documentContext,
      };
      logger.info(
        `[CHAT-WONDER-STREAM] user payload: ${JSON.stringify({ ...payload, user_input: payload.user_input.slice(0, 120) + "...", document_context: payload.document_context ? `[${payload.document_context.split("\n").length} lines]` : "" })}`
      );
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (data: WebSocket.Data) => {
      const message = data.toString();

      if (message === "__END__") {
        logger.info("[CHAT-WONDER-STREAM] Stream complete");
        ws.close();
        callbacks.onComplete();
        resolve();
        return;
      }

      if (message.startsWith("[Error]")) {
        logger.error(`[CHAT-WONDER-STREAM] Error: ${message}`);
        const error = new Error(message);
        callbacks.onError(error);
        ws.close();
        reject(error);
        return;
      }

      if (message.startsWith("[Tool]")) {
        logger.info(`[CHAT-WONDER-STREAM] Tool execution: ${message}`);
        return;
      }

      // Send chunk to frontend
      logger.info(`[CHAT-WONDER-STREAM] Received chunk (${message.length} chars)`);
      callbacks.onChunk(message);
    });

    ws.on("error", (error) => {
      logger.error(`[CHAT-WONDER-STREAM] WebSocket error: ${error.message}`);
      callbacks.onError(error);
      reject(error);
    });

    ws.on("close", () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket closed");
    });
  });
}
