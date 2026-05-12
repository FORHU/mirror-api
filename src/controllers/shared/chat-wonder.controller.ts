import { NextFunction, Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import { streamChat } from "../../utils/chat-wonder-stream";
import { stripSourcesPrefix } from "../../utils/source-metadata.util";
import { parseChatWonderResponse } from "../../utils/parse-response.util";
import logger from "../../utils/logger";

export default class ChatWonderController {
  /**
   * Handles streaming chat requests using Server-Sent Events (SSE).
   */
  static async streamChat(req: Request, res: Response, next: NextFunction) {
    const { input, conversationId: inputConversationId, persona } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const schema = Joi.object({
      input: Joi.string().min(1).max(500).required(),
      conversationId: Joi.string().optional(),
      persona: Joi.string().optional().allow(null, ""),
    });

    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.message });
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

      let fullResponse = "";

      // 6. Stream from external ChatWonder API
      await streamChat(wrappedInput, sessionId, persona, {
        onChunk: (chunk: string) => {
          fullResponse += chunk;
          res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
          if ((res as any).flush) (res as any).flush();
        },
        onComplete: async () => {
          try {
            // Clean up the response
            const { cleaned } = stripSourcesPrefix(fullResponse);
            const parsed = parseChatWonderResponse(cleaned);

            // Save AI response to history
            const aiMessage = await ChatWonderService.saveAIMessage(userId, conversationId, parsed.message);

            res.write(
              `data: ${JSON.stringify({
                type: "complete",
                message: parsed.message,
                emotion_data: parsed.emotion_data,
                metadata: {
                  conversationId,
                  userMessageId: userMessage.id,
                  aiMessageId: aiMessage.id,
                },
              })}\n\n`
            );
            res.end();
          } catch (err: any) {
            logger.error(`[ChatWonderController] Error saving response: ${err.message}`);
            res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to save response" })}\n\n`);
            res.end();
          }
        },
        onError: (err: Error) => {
          logger.error(`[ChatWonderController] Stream error: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({ error: "Stream failed" });
          } else {
            res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
            res.end();
          }
        },
      });
    } catch (err: any) {
      logger.error(`[ChatWonderController] Controller error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  }
}
