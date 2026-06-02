import { Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import { streamChat, type StreamCallbacks } from "../../utils/chat-wonder-stream";
import { stripSourcesPrefix } from "../../utils/source-metadata.util";
import { parseChatWonderResponse } from "../../utils/parse-chatWonder-response.util";
import { resolveItineraryEvents } from "../../utils/chat-wonder-events.util";
import { resolveItineraryLocations } from "../../utils/chat-wonder-maps.util";
import { resolveSetProducts } from "../../utils/resolve-set-garments.util";
import { emitToKiosk } from "../../utils/socket.util";
import logger from "../../utils/logger";
import { responseError } from "../../helpers/response.helper";
import CacheUtil from "../../utils/cache.util";

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
   * Raw passthrough — sends the user input to ChatWonder with NO persona, NO
   * document context, and NO history, then returns ChatWonder's response EXACTLY
   * as received. No parsing, no `resolveSetProducts`, no events, no persistence.
   * Use this to inspect the unmodified ChatWonder output.
   *
   * POST body: { input | user_input, session_id?, weather? }
   * Returns:   { status, data: { raw, parsed }, message }
   *   - raw:    the untouched response text from ChatWonder
   *   - parsed: the same payload as JSON (null if it isn't valid JSON)
   */
  static async streamRaw(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    const schema = Joi.object({
      input: Joi.string().min(1).max(5000).optional(),
      user_input: Joi.string().min(1).max(5000).optional(),
      session_id: Joi.string().optional(),
      weather: Joi.object().optional(),
    }).or("input", "user_input");

    const { error, value } = schema.validate(req.body, { allowUnknown: true });
    if (error) {
      return responseError(res, 400, error.message);
    }

    const input = value.input || value.user_input;
    const weather = value.weather ?? {};

    try {
      const sessionId = value.session_id || (await ChatWonderService.generateChatSessionId(userId));

      let raw = "";
      await streamChat({
        userInput: input,
        sessionId: sessionId as string,
        persona: undefined, // no persona — exact passthrough, nothing appended to the input
        callbacks: {
          onChunk: (chunk) => {
            raw += chunk;
          },
          onComplete: () => {
            /* buffered — we respond once the stream completes */
          },
          onError: (err) => {
            logger.error(`[ChatWonderController.streamRaw] Stream error: ${err.message}`);
          },
        },
        documentContext: "", // no document context
        userHistorySelect: "", // no history
        weather,
      });

      // Return EXACTLY what ChatWonder sent. `raw` is untouched; `parsed` is the
      // same payload as JSON for convenience (null if it isn't valid JSON).
      let parsed: unknown = null;
      try {
        const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {
        /* leave parsed null — raw still carries the exact text */
      }

      return res.json({ status: "success", data: { raw, parsed }, message: "OK" });
    } catch (err) {
      logger.error(`[ChatWonderController.streamRaw] ${(err as Error).message}`);
      return responseError(res, 500, (err as Error).message || "Internal server error");
    }
  }

  /**
   * Handles streaming chat requests using Server-Sent Events (SSE).
   */
  static async streamChat(req: Request, res: Response) {
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    const schema = Joi.object({
      input: Joi.string().min(1).max(5000).optional(),
      user_input: Joi.string().min(1).max(5000).optional(),
      conversationId: Joi.string().optional(),
      session_id: Joi.string().optional(),
      type: Joi.string().optional(),
      weather: Joi.object().optional(),
      skin_analysis: Joi.object().optional(),
      kioskId: Joi.string().optional(),
    }).or("input", "user_input"); // Require at least one of these

    const { error, value } = schema.validate(req.body, { allowUnknown: true });
    if (error) {
      return responseError(res, 400, error.message);
    }

    const input = value.input || value.user_input;
    const inputConversationId = value.conversationId; // Note: session_id is a different Forhu AI concept, we keep conversationId logic
    const kioskId = value.kioskId;
    const frontendWeather = value.weather;

    try {
      // 1. Ensure conversation exists
      const conversationId = await ChatWonderService.ensureConversation(
        userId,
        input.substring(0, 50),
        inputConversationId
      );

      // 2. Generate/Retrieve session ID
      const sessionId = await ChatWonderService.generateChatSessionId(userId);

      // 3. Save user message
      const userMessage = await ChatWonderService.saveUserMessage(userId, conversationId, input);

      // 4. (Removed buildUserContext since AI has direct access)

      // 5. Generate strict JSON enforcement prompt to act as the "persona"
      const gender = await ChatWonderService.getUserGender(userId);
      const personaPrompt = ChatWonderService.getPersonaPrompt(input, gender);

      // 6. Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let fullResponse = "";
      const responseWithFlush = res as Response & { flush?: () => void };
      const writeSseEvent = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        responseWithFlush.flush?.();
      };

      const callbacks: StreamCallbacks = {
        onChunk: (chunk: string) => {
          fullResponse += chunk;
          writeSseEvent({ type: "chunk", content: chunk });
        },
        onComplete: async () => {
          try {
            // Clean up the response
            const { cleaned } = stripSourcesPrefix(fullResponse);
            const parsed = parseChatWonderResponse(cleaned);

            // Enrich the itinerary events with resolved physical database products
            let enrichedEvents = await resolveItineraryEvents(
              userId,
              parsed.events,
              conversationId
            );

            // Enrich the itinerary events with resolved physical map coordinates
            enrichedEvents = await resolveItineraryLocations(enrichedEvents);

            // Resolve `sets` placeholder ids/imageUrls to real DB records
            // (garments + cosmetics) by attribute match — no catalog injected
            // into the prompt, so our data never leaves the system.
            const resolvedSets = await resolveSetProducts(parsed.sets, gender);

            // Check if user input contains finalization keywords to save/finalize the plan draft
            const isFinalization =
              /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(
                input
              );
            if (isFinalization) {
              await ChatWonderService.finalizeOutlineByConversationId(conversationId);
              logger.info(
                `[ChatWonderController] Finalized UserOutline status for conversation: ${conversationId}`
              );

              if (kioskId) {
                emitToKiosk(kioskId, "itinerary_locked", { conversationId });
                logger.info(
                  `[ChatWonderController] Emitted itinerary_locked to kiosk: ${kioskId}`
                );
              }
            }

            // Save AI response to history
            const aiMessage = await ChatWonderService.saveAIMessage(
              userId,
              conversationId,
              parsed.message
            );

            writeSseEvent({
              type: "complete",
              message: parsed.message,
              outfit_suggestion: parsed.outfit_suggestion,
              mood: parsed.mood,
              cosmetics_suggestion: parsed.cosmetics_suggestion,
              route_suggestion: parsed.route_suggestion,
              images: parsed.images,
              events: enrichedEvents,
              sets: resolvedSets,
              metadata: {
                conversationId,
                userMessageId: userMessage.id,
                aiMessageId: aiMessage.id,
              },
            });
            res.end();
          } catch (err) {
            logger.error(
              `[ChatWonderController] Error saving response: ${(err as Error).message}`
            );
            writeSseEvent({ type: "error", message: "Failed to save response" });
            res.end();
          }
        },
        onError: async (err: Error) => {
          logger.error(`[ChatWonderController] Stream error: ${err.message}`);
          if (err.message.includes("Unknown session")) {
            await CacheUtil.del(`chat:sessionId:${userId}`);
            logger.info(
              `[ChatWonderController] Stale session cleared for user ${userId}. Pre-warming fresh session...`
            );

            ChatWonderService.generateChatSessionId(userId, true)
              .then((id) => logger.info(`[ChatWonderController] Fresh session pre-warmed: ${id}`))
              .catch((e) => logger.warn(`[ChatWonderController] Pre-warm failed: ${e.message}`));

            writeSseEvent({
              type: "error",
              code: "session_expired",
              message: "Session expired. Please resend your message.",
            });
            res.end();
            return;
          }
          if (!res.headersSent) {
            responseError(res, 500, err.message);
            return;
          }

          writeSseEvent({ type: "error", message: err.message });
          res.end();
        },
      };

      // 7. Stream from external ChatWonder API
      await streamChat({
        userInput: input,
        sessionId: sessionId as string,
        persona: personaPrompt,
        callbacks,
        documentContext: "",
        userHistorySelect: "",
        weather: frontendWeather,
      });
    } catch (err) {
      logger.error(`[ChatWonderController] Controller error: ${(err as Error).message}`);
      if (!res.headersSent) {
        responseError(res, 500, (err as Error).message || "Internal server error");
      }
    }
  }
}
