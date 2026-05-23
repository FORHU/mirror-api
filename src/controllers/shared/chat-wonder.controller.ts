import { Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import { streamChat } from "../../utils/chat-wonder-stream";
import { stripSourcesPrefix } from "../../utils/source-metadata.util";
import { parseChatWonderResponse } from "../../utils/parse-chatWonder-response.util";
import { detectChatRoute } from "../../utils/detect-chat-route.util";
import { resolveItineraryCosmetics } from "../../utils/chat-wonder-cosmetics.util";
import { prisma } from "../../utils/prisma";
import logger from "../../utils/logger";
import { responseError } from "../../helpers/response.helper";

export default class ChatWonderController {
  /**
   * Handles streaming chat requests using Server-Sent Events (SSE).
   */
  static async streamChat(req: Request, res: Response) {
    const { input, conversationId: inputConversationId, persona } = req.body;
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    if (!userId) {
      return responseError(res, 401, "Unauthorized");
    }

    const schema = Joi.object({
      input: Joi.string().min(1).max(500).required(),
      conversationId: Joi.string().optional(),
      persona: Joi.string().optional().allow(null, ""),
    });

    const { error } = schema.validate(req.body);
    if (error) {
      return responseError(res, 400, error.message);
    }

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

      // 4. Prepare prompt for external API
      const wrappedInput = await ChatWonderService.getAdditionalPrompt(input);

      // 5. Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      // 5a. Emit route event immediately — frontend can navigate before AI responds
      const chatRoute = detectChatRoute(input);
      if (chatRoute) {
        res.write(`data: ${JSON.stringify({ type: "route", ...chatRoute })}\n\n`);
        if ((res as Response & { flush?: () => void }).flush)
          (res as Response & { flush?: () => void }).flush?.();
        logger.info(`[ChatWonderController] Route detected: ${chatRoute.route}`);
      }

      let fullResponse = "";

      // 6. Stream from external ChatWonder API
      await streamChat(wrappedInput, sessionId as string, persona as string, {
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
            const enrichedEvents = await resolveItineraryCosmetics(
              userId,
              parsed.events,
              conversationId
            );

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
            }

            // Save AI response to history
            const aiMessage = await ChatWonderService.saveAIMessage(
              userId,
              conversationId,
              parsed.message
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
                metadata: {
                  conversationId,
                  userMessageId: userMessage.id,
                  aiMessageId: aiMessage.id,
                },
              })}\n\n`
            );
            res.end();
          } catch (err) {
            logger.error(`[ChatWonderController] Error saving response: ${(err as Error).message}`);
            res.write(
              `data: ${JSON.stringify({ type: "error", message: "Failed to save response" })}\n\n`
            );
            res.end();
          }
        },
        onError: (err: Error) => {
          logger.error(`[ChatWonderController] Stream error: ${err.message}`);
          if (!res.headersSent) {
            responseError(res, 500, err.message || "Stream failed");
          } else {
            res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
            res.end();
          }
        },
      });
    } catch (err) {
      logger.error(`[ChatWonderController] Controller error: ${(err as Error).message}`);
      if (!res.headersSent) {
        responseError(res, 500, (err as Error).message || "Internal server error");
      }
    }
  }
}
