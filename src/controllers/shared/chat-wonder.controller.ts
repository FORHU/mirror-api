import { Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import { streamChat } from "../../utils/chat-wonder-stream";
import { createChatWonderSseCallbacks } from "../../utils/chat-wonder-sse-callbacks.util";
import { buildCatalogContext } from "../../utils/chat-wonder-cosmetics.util";
import logger from "../../utils/logger";
import { responseError } from "../../helpers/response.helper";
import {
  chatWonderBaseSchema,
  clearStaleSession,
  isCosmeticsLikely,
} from "../../helpers/chat-wonder.helper";
import { weatherService, type WeatherData } from "../../services/shared/weather.service";

export default class ChatWonderController {
  /**
   * Retrieves or generates a ChatWonder session ID for the user.
   */
  static async getSessionId(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    try {
      // Always force a new session when the landing page requests it to clear history
      const sessionId = await ChatWonderService.generateChatSessionId(userId, true);
      return res.json({ status: "success", data: { sessionId } });
    } catch (err) {
      logger.error(`[ChatWonderController] getSessionId error: ${(err as Error).message}`);
      return responseError(res, 500, (err as Error).message || "Internal server error");
    }
  }

  /**
   * Read-only twin of getSessionId: returns the user's current ChatWonder
   * session ID (creating one only if none exists). Never clears history —
   * safe for display/debug UI.
   */
  static async getCurrentSessionId(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    try {
      const sessionId = await ChatWonderService.generateChatSessionId(userId, false);
      return res.json({ status: "success", data: { sessionId } });
    } catch (err) {
      logger.error(`[ChatWonderController] getCurrentSessionId error: ${(err as Error).message}`);
      return responseError(res, 500, (err as Error).message || "Internal server error");
    }
  }

  /**
   * RESTART — gender + ChatWonder session only:
   *   1. Null the user's stored gender (app will re-ask).
   *   2. Force a brand-new ChatWonder session (clears conversation history).
   *
   * Does NOT wipe the Outline. The Outline wipe lives in `/outlines/reset`
   * (no-scope = `softDeleteAllByUserId`), which the client fires alongside this
   * on a true "next person" Restart (see ADR 0001). Keeping the wipe out of here
   * is deliberate: `restart` is also the 409 stale-session recovery path
   * (useChatWonderStream / overview retry), and that must NOT delete the
   * in-progress Outline.
   */
  static async restart(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    try {
      await ChatWonderService.clearUserGender(userId);
      const sessionId = await ChatWonderService.generateChatSessionId(userId, true);
      return res.json({
        status: "success",
        data: { sessionId, gender: null },
        message: "Restarted",
      });
    } catch (err) {
      logger.error(`[ChatWonderController] restart error: ${(err as Error).message}`);
      return responseError(res, 500, (err as Error).message || "Internal server error");
    }
  }

  /**
   * Primary chat endpoint (`POST /message`). Streams SSE events identical to
   * `streamChat` (`chunk`, `complete`, `error`) plus interleaved `audio_chunk`
   * events carrying base64-encoded TTS audio when `voice: true` is sent in the
   * body. Session-expired errors arrive as an in-band `error` SSE event (the
   * client retries by calling `restart` then resending).
   *
   * Extra body fields vs `streamChat`: `voice` (boolean) and `lang` (BCP-47
   * string, e.g. `"en-US"`) for TTS language selection.
   */
  static async chat(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    const chatSchema = chatWonderBaseSchema.keys({
      voice: Joi.boolean().optional(),
      lang: Joi.string().optional(),
    });
    const { error, value } = chatSchema.validate(req.body, { allowUnknown: true });
    if (error) {
      return responseError(res, 400, error.message);
    }

    let input = value.input || value.user_input || "";
    if (!input.startsWith("[")) {
      input = `[stylist] ${input}`;
    } else if (/^\[(?:cosmetics|maps?|garment)\]/i.test(input)) {
      input = input.replace(/^\[[^\]]+\]/, "[stylist]");
    }

    const inputConversationId = value.conversationId;
    const kioskId = value.kioskId;
    const pageMode: string | null = value.page_mode ?? null;
    const wantsVoice = value.voice === true;
    const ttsLang = value.lang || "en-US";
    const sitemapContext = value.sitemap_context;
    const history = (value.history ?? []).slice(-6);

    const isGarment = pageMode === "garment";
    const isOverview = pageMode === "overview";
    const isCosmetics = pageMode === "cosmetics";

    const frontendLocation = value.location;
    const skinAnalysis = value.skin_analysis;
    const category: string | undefined = value.category || undefined;
    const set: number | undefined = value.set ?? undefined;

    logger.info(
      `[ChatWonderController.chat] page_mode=${pageMode ?? "none"} | input=${input.slice(0, 80)}...`
    );

    const location =
      frontendLocation &&
      typeof frontendLocation.lat === "number" &&
      typeof frontendLocation.lng === "number"
        ? { lat: frontendLocation.lat, lng: frontendLocation.lng }
        : null;

    // Helper to build a weather object from the weatherService response
    const buildWeatherObj = (d: WeatherData, loc: { lat: number; lng: number }) => ({
      date: new Date().toISOString().split("T")[0],
      description: String(d.condition ?? "").toLowerCase(),
      estimated: false,
      is_cold: Number(d.temperature) < 20,
      is_hot: Number(d.temperature) >= 30,
      is_rainy:
        Number(d.precipitationProb) >= 50 ||
        String(d.condition ?? "")
          .toLowerCase()
          .includes("rain"),
      lat: loc.lat,
      lon: loc.lng,
      temperature_c: Number(d.temperature),
    });

    const needsWeather = !!(location && (isGarment || isOverview || isCosmetics || !pageMode));

    try {
      // Fix 2: Run weather fetch IN PARALLEL with DB setup instead of sequentially before it
      const [conversationId, sessionId, dbGender, frontendWeather] = await Promise.all([
        ChatWonderService.ensureConversation(userId, input.substring(0, 50), inputConversationId),
        ChatWonderService.generateChatSessionId(userId),
        ChatWonderService.getUserGender(userId),
        needsWeather
          ? weatherService
              .getWeather(location.lat, location.lng)
              .then((d) => buildWeatherObj(d, location))
              .catch(() => undefined as Record<string, unknown> | undefined)
          : Promise.resolve(undefined as Record<string, unknown> | undefined),
      ]);

      const gender = value.gender || dbGender;

      // Fix 3: Fire saveUserMessage without blocking SSE headers — awaited in onComplete
      const userMessagePromise = ChatWonderService.saveUserMessage(userId, conversationId, input);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const documentContext = isCosmeticsLikely(input)
        ? await buildCatalogContext(skinAnalysis)
        : undefined;

      const callbacks = createChatWonderSseCallbacks({
        res,
        userId,
        conversationId,
        input,
        kioskId,
        skinAnalysis,
        wantsVoice,
        ttsLang,
        userMessagePromise,
      });

      await streamChat({
        userInput: input,
        sessionId: sessionId as string,
        callbacks,
        userId,
        weather: frontendWeather,
        location: frontendLocation,
        skinAnalysis,
        gender: gender || undefined,
        sitemapContext,
        documentContext,
        history,
        category,
        set,
      });
    } catch (err) {
      const message = (err as Error).message || "Internal server error";
      logger.error(`[ChatWonderController.chat] ${message}`);

      if (message.includes("Unknown session")) {
        await clearStaleSession(userId);
        if (!res.headersSent) {
          return responseError(res, 409, "Session expired. Please resend your message.", {
            code: "session_expired",
          });
        }
      }

      if (!res.headersSent) {
        return responseError(res, 500, message);
      }
    }
  }
}
