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

// ── Persistent WebSocket pool ────────────────────────────────────────────────
// Keeps one open connection per ChatWonder session so subsequent voice
// commands skip the TCP + WS handshake (~100–400 ms saved per request).
interface PoolEntry {
  ws: WebSocket;
  busy: boolean;
  pingTimer?: NodeJS.Timeout | null;
}
const wsPool = new Map<string, PoolEntry>();

function acquireWS(sessionId: string, wsEndpoint: string): WebSocket {
  const entry = wsPool.get(sessionId);
  if (entry && entry.ws.readyState === WebSocket.OPEN && !entry.busy) {
    entry.busy = true;
    logger.info(`[CHAT-WONDER-STREAM] Reusing connection for session ${sessionId}`);
    return entry.ws;
  }
  // Close stale connection if it exists
  if (entry) {
    try {
      entry.ws.terminate();
    } catch (_) {}
    wsPool.delete(sessionId);
  }
  const ws = new WebSocket(wsEndpoint);
  wsPool.set(sessionId, { ws, busy: true, pingTimer: null });
  return ws;
}

function releaseWS(sessionId: string) {
  const entry = wsPool.get(sessionId);
  if (entry) entry.busy = false;
}

function evictWS(sessionId: string) {
  const entry = wsPool.get(sessionId);
  if (entry) {
    if (entry.pingTimer) clearInterval(entry.pingTimer);
    try {
      entry.ws.terminate();
    } catch (_) {}
  }
  wsPool.delete(sessionId);
}

/**
 * Pre-warm a WebSocket connection for a session and enable keep-alive pings.
 * Safe to call repeatedly; noop if an open connection already exists.
 */
export function prewarmSession(sessionId: string): void {
  if (!CHAT_WONDER_API_URL) return;
  const wsUrl = CHAT_WONDER_API_URL.replace("http://", "ws://").replace("https://", "wss://");
  const wsEndpoint = `${wsUrl}/chat-stream`;
  const entry = wsPool.get(sessionId);
  if (entry && entry.ws.readyState === WebSocket.OPEN) {
    logger.info(`[CHAT-WONDER-STREAM] Session ${sessionId} already warmed`);
    return;
  }

  const ws = acquireWS(sessionId, wsEndpoint);

  ws.on("open", () => {
    logger.info(`[CHAT-WONDER-STREAM] Prewarmed WebSocket for session ${sessionId}`);
    // Install a keep-alive ping every 25s to reduce idle disconnects
    const poolEntry = wsPool.get(sessionId);
    if (poolEntry) {
      if (poolEntry.pingTimer) clearInterval(poolEntry.pingTimer);
      poolEntry.pingTimer = setInterval(() => {
        try {
          if (poolEntry.ws.readyState === WebSocket.OPEN) poolEntry.ws.ping();
        } catch (e) {
          logger.warn(`[CHAT-WONDER-STREAM] ping failed for ${sessionId}: ${(e as Error).message}`);
        }
      }, 25000);
    }
  });

  ws.on("close", () => {
    logger.info(`[CHAT-WONDER-STREAM] Prewarmed WebSocket closed for session ${sessionId}`);
    evictWS(sessionId);
  });
  ws.on("error", (err: Error) => {
    logger.error(`[CHAT-WONDER-STREAM] Prewarm error for ${sessionId}: ${err.message}`);
    evictWS(sessionId);
  });
}
// ────────────────────────────────────────────────────────────────────────────

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
      releaseWS(sessionId);
      Promise.resolve(callbacks.onComplete()).catch((callbackError) => {
        logger.warn(
          `[CHAT-WONDER-STREAM] onComplete callback failed: ${(callbackError as Error).message}`
        );
      });
    };

    const wsUrl = CHAT_WONDER_API_URL.replace("http://", "ws://").replace("https://", "wss://");
    const wsEndpoint = `${wsUrl}/chat-stream`;

    logger.info(`[CHAT-WONDER-STREAM] Connecting to ${wsEndpoint}`);

    const ws = acquireWS(sessionId, wsEndpoint);

    // Clear stale per-request listeners from a previous use of this connection.
    ws.removeAllListeners("message");
    ws.removeAllListeners("error");
    ws.removeAllListeners("close");
    ws.removeAllListeners("open");

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
      user_input: userInput,
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

    const sendPayload = () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket connected");
      logger.info(
        `[CHAT-WONDER-STREAM] Sending payload: ${JSON.stringify({ ...payload, user_input: payload.user_input.slice(0, 120) + "..." })}`
      );
      ws.send(JSON.stringify(payload));
    };

    if (ws.readyState === WebSocket.OPEN) {
      sendPayload();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.once("open", sendPayload);
    } else {
      wsPool.delete(sessionId);
      return reject(new Error("ChatWonder WebSocket is not open"));
    }

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
          resolve();
          return;
        }

        if (raw.startsWith("[Error]")) {
          logger.error(`[CHAT-WONDER-STREAM] Error: ${raw}`);
          const error = new Error(raw);
          evictWS(sessionId);
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
          resolve();
          break;

        case "error":
          logger.error(`[CHAT-WONDER-STREAM] Error: ${msg.message}`);
          evictWS(sessionId);
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

    ws.on("error", (error: Error) => {
      logger.error(`[CHAT-WONDER-STREAM] WebSocket error: ${error.message}`);
      evictWS(sessionId);
      Promise.resolve(callbacks.onError(error)).catch((callbackError) => {
        logger.warn(
          `[CHAT-WONDER-STREAM] onError callback failed: ${(callbackError as Error).message}`
        );
      });
      reject(error);
    });

    ws.on("close", () => {
      logger.info("[CHAT-WONDER-STREAM] WebSocket closed");
      evictWS(sessionId);
      // Fallback: If the server closes the connection abruptly without sending __END__
      safeComplete();
      resolve();
    });
  });
}
