import { Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import { streamChat } from "../../utils/chat-wonder-stream";
import { stripSourcesPrefix } from "../../utils/source-metadata.util";
import { parseChatWonderResponse } from "../../utils/parse-chatWonder-response.util";
import { resolveItineraryEvents } from "../../utils/chat-wonder-events.util";
import { resolveItineraryLocations } from "../../utils/chat-wonder-maps.util";
import { emitToKiosk } from "../../utils/socket.util";
import { prisma } from "../../utils/prisma";
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
      personas: Joi.object({
        system: Joi.string().optional().allow(null, ""),
        fashion: Joi.string().optional().allow(null, ""),
        cosmetics: Joi.string().optional().allow(null, ""),
        maps: Joi.string().optional().allow(null, ""),
      }).optional(),
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
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { gender: true },
      });
      const gender = user?.gender ?? "FEMALE";
      const personaPrompt = ChatWonderService.getPersonaPrompt(input, gender);

      // 6. Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let fullResponse = "";

      // 7. Stream from external ChatWonder API
      await streamChat(
        input,
        sessionId as string,
        personaPrompt,
        {
          onChunk: (chunk: string) => {
            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
            if ((res as Response & { flush?: () => void }).flush)
              (res as Response & { flush?: () => void }).flush?.();
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

              // Check if user input contains finalization keywords to save/finalize the plan draft
              const isFinalization =
                /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(
                  input
                );
              if (isFinalization) {
                await prisma.userOutline.update({
                  where: { conversationId },
                  data: { status: "FINALIZED" },
                });
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
              logger.debug(
                `parsed data -- - - - -- - -\n` +
                  `data: ${JSON.stringify({
                    type: "complete",
                    message: parsed.message,
                    outfit_suggestion: parsed.outfit_suggestion,
                    mood: parsed.mood,
                    cosmetics_suggestion: parsed.cosmetics_suggestion,
                    route_suggestion: parsed.route_suggestion,
                    images: parsed.images,
                    events: enrichedEvents,
                    sets: parsed.sets,
                    metadata: {
                      conversationId,
                      userMessageId: userMessage.id,
                      aiMessageId: aiMessage.id,
                    },
                  })}\n\n`
              );
              res.write(
                `data: ${JSON.stringify({
                  type: "complete",
                  message: parsed.message,
                  outfit_suggestion: parsed.outfit_suggestion,
                  mood: parsed.mood,
                  cosmetics_suggestion: parsed.cosmetics_suggestion,
                  route_suggestion: parsed.route_suggestion,
                  images: parsed.images,
                  events: enrichedEvents,
                  sets: parsed.sets,
                  metadata: {
                    conversationId,
                    userMessageId: userMessage.id,
                    aiMessageId: aiMessage.id,
                  },
                })}\n\n`
              );
              res.end();
            } catch (err) {
              logger.error(
                `[ChatWonderController] Error saving response: ${(err as Error).message}`
              );
              res.write(
                `data: ${JSON.stringify({ type: "error", message: "Failed to save response" })}\n\n`
              );
              res.end();
            }
          },
          onError: async (err: Error) => {
            logger.error(`[ChatWonderController] Stream error: ${err.message}`);
            if (err.message.includes("Unknown session")) {
              // Stale session — clear cache immediately and pre-warm a fresh one in the background.
              // This ensures the NEXT request uses a valid session without any extra overhead.
              // We do NOT retry inline here — that would double the response time.
              await CacheUtil.del(`chat:sessionId:${userId}`);
              logger.info(
                `[ChatWonderController] Stale session cleared for user ${userId}. Pre-warming fresh session...`
              );

              // Fire-and-forget: fetch fresh session into cache so next call is instant
              ChatWonderService.generateChatSessionId(userId, true)
                .then((id) => logger.info(`[ChatWonderController] Fresh session pre-warmed: ${id}`))
                .catch((e) => logger.warn(`[ChatWonderController] Pre-warm failed: ${e.message}`));

              // Return a clean session_expired event so frontend can immediately retry
              res.write(
                `data: ${JSON.stringify({ type: "error", code: "session_expired", message: "Session expired. Please resend your message." })}\n\n`
              );
              res.end();
              return;
            }
            if (!res.headersSent) {
              return responseError(res, 500, err.message);
            } else {
              res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
              res.end();
            }
          },
        },
        "",
        "",
        frontendWeather
      );
    } catch (err) {
      logger.error(`[ChatWonderController] Controller error: ${(err as Error).message}`);
      if (!res.headersSent) {
        responseError(res, 500, (err as Error).message || "Internal server error");
      }
    }
  }
}
