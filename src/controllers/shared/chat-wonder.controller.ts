import { Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import UserService from "../../services/shared/user.service";
import { streamChat, type StreamCallbacks } from "../../utils/chat-wonder-stream";
import { stripSourcesPrefix } from "../../utils/source-metadata.util";
import { resolveItineraryLocations } from "../../utils/chat-wonder-maps.util";
import {
  parseChatWonderResponse,
  extractChatWonderDataBlock,
  cutToMessage,
} from "../../utils/parse-chatWonder-response.util";
import { emitToKiosk } from "../../utils/socket.util";
import { voiceService } from "../../services/shared/voice.service";
import logger from "../../utils/logger";
import { responseError } from "../../helpers/response.helper";
import CacheUtil from "../../utils/cache.util";
import { chatWonderBaseSchema, checkAndFinalizeOutline } from "../../helpers/chat-wonder.helper";
import OutlineRepo from "../../repositories/outline.repository";

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
   * RESTART — full reset for the next person at the mirror:
   *   1. Null the user's stored gender (app will re-ask).
   *   2. Force a brand-new ChatWonder session (clears conversation history).
   * Does NOT touch the itinerary — that's the refresh/reset-outline flow.
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

      // Auto-clear the stale session from Redis so the next request gets a fresh one
      if ((err as Error).message.includes("Unknown session")) {
        await CacheUtil.del(`chat:sessionId:${userId}`);
        logger.info(`[ChatWonderController.streamRaw] Stale session cleared for user ${userId}.`);
      }

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

    const gender = await ChatWonderService.getUserGender(userId);

    const schema = Joi.object({
      input: Joi.string().min(1).max(5000).optional(),
      user_input: Joi.string().min(1).max(5000).optional(),
      conversationId: Joi.string().allow(null, "").optional(),
      session_id: Joi.string().allow(null, "").optional(),
      type: Joi.string().allow(null, "").optional(),
      weather: Joi.object().allow(null).optional(),
      location: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lng: Joi.number().min(-180).max(180).required(),
      }).allow(null).optional(),
      skin_analysis: Joi.object().allow(null).optional(),
      kioskId: Joi.string().allow(null, "").optional(),
      sitemap_context: Joi.array().items(Joi.string()).optional(),
      history: Joi.array()
        .items(
          Joi.object({
            role: Joi.string().valid("user", "assistant").required(),
            content: Joi.string().required(),
          })
        )
        .max(10)
        .optional(),
    }).or("input", "user_input"); // Require at least one of these

    const { error, value } = schema.validate(req.body, { allowUnknown: true });
    if (error) {
      return responseError(res, 400, error.message);
    }

    const input = value.input || value.user_input;
    const inputConversationId = value.conversationId; // Note: session_id is a different Forhu AI concept, we keep conversationId logic
    const kioskId = value.kioskId;
    const frontendWeather = value.weather;
    const frontendLocation = value.location;
    const sitemapContext = value.sitemap_context;
    const history = (value.history ?? []).slice(-10);
    const skinAnalysis = value.skin_analysis;

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
      // 5. Persona Prompt and Outfit Catalog Injection have been removed.

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

      // Tracks how much clean prose we've already streamed to the display channel.
      // ChatWonder appends `[GARMENT_DATA]{…}` / `[COSMETICS_DATA]{…}` / `[DONE]`
      // blocks and a per-set `## Set …` breakdown AFTER the conversational intro,
      // streamed token-by-token. `cutToMessage` removes both; we run it on the
      // cumulative buffer and emit only the new portion, so the display matches
      // the authoritative `parsed.message`.
      let displayedLen = 0;
      const cleanDisplayPrefix = (full: string): string => {
        let display = cutToMessage(full);
        // Hold back a possibly-incomplete trailing data marker (unclosed `[…`)
        // so a half-arrived `[GARMENT_DATA]` never flickers in.
        const lastOpen = display.lastIndexOf("[");
        if (lastOpen !== -1 && !display.slice(lastOpen).includes("]")) {
          display = display.slice(0, lastOpen);
        }
        // Hold back an in-progress heading line: until its text is complete we
        // can't tell a `## Set` (cut) from a kept heading like `### Outfit …`.
        const lastNL = display.lastIndexOf("\n");
        const lastLine = display.slice(lastNL + 1).trimStart();
        if (/^#{1,6}(\s|$)/.test(lastLine)) {
          display = lastNL === -1 ? "" : display.slice(0, lastNL);
        }
        return display;
      };

      const callbacks: StreamCallbacks = {
        onChunk: (chunk: string) => {
          fullResponse += chunk;
          // Mirror EVERY chunk verbatim on a separate event so a raw consumer can
          // concatenate all `raw_chunk` events to reconstruct the exact byte stream.
          writeSseEvent({ type: "raw_chunk", content: chunk });
          // Display stream: forward only the clean prose, never the trailing
          // metadata blocks.
          const display = cleanDisplayPrefix(fullResponse);
          if (display.length > displayedLen) {
            writeSseEvent({ type: "chunk", content: display.slice(displayedLen) });
            displayedLen = display.length;
          }
        },
        onComplete: async () => {
          try {
            // Clean up the response
            const { cleaned } = stripSourcesPrefix(fullResponse);
            const parsed = parseChatWonderResponse(cleaned);
            if (parsed.events.length > 0) {
              parsed.events = await resolveItineraryLocations(parsed.events);
            }
            logger.debug(`[ChatWonderController] Cleaned response: ${cleaned}`);
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
                logger.info(`[ChatWonderController] Emitted itinerary_locked to kiosk: ${kioskId}`);
              }
            }

            // Save AI response to history
            const aiMessage = await ChatWonderService.saveAIMessage(
              userId,
              conversationId,
              parsed.message
            );

            // Surface the trailing structured blocks as parsed JSON for the client.
            let garment = extractChatWonderDataBlock(fullResponse, "GARMENT_DATA");
            let cosmetics = extractChatWonderDataBlock(fullResponse, "COSMETICS_DATA");
            let maps = extractChatWonderDataBlock(fullResponse, "MAPS_DATA");
            let stylist = extractChatWonderDataBlock(fullResponse, "STYLIST")
              ?? extractChatWonderDataBlock(fullResponse, "NAV_DATA");

            // --- INTERCEPT: Force pure conversational greeting ---
            // If this was the hidden auto-greeting, absolutely forbid the AI from triggering
            // navigation or popping up data widgets on the landing page.
            if (input.includes("[SYSTEM] The user just walked up to the mirror.")) {
              garment = null;
              cosmetics = null;
              maps = null;
              stylist = null;
              logger.info("[ChatWonderController] Intercepted and stripped data blocks from greeting.");
            }
            const genderUpdate = extractChatWonderDataBlock(fullResponse, "GENDER_UPDATE") as any;

            if (genderUpdate && genderUpdate.gender) {
              const newGender = String(genderUpdate.gender).toUpperCase();
              if (["MALE", "FEMALE", "UNISEX"].includes(newGender)) {
                await UserService.updateUser(userId, { gender: newGender as any });
                logger.info(`[ChatWonderController] Caught GENDER_UPDATE: ${newGender}`);
              }
            }

            // Strip out the inline UI markers that buildFromParsed appends
            const finalDisplayMessage = parsed.message
              .split(/\n\n\[\s*(?:garments|cosmetics|map)\s*\]/)[0]
              .split("[MAPS_DATA]")[0]
              .split("[NAV_DATA]")[0]
              .trim();

            writeSseEvent({
              type: "complete",
              // Authoritative clean prose (marker blocks stripped). Use this as the
              // display message; the streamed `chunk` events build the same text.
              message: finalDisplayMessage,
              intent: parsed.intent,
              // Parsed structured payloads (null when ChatWonder didn't send them).
              garment_data: garment,
              cosmetics_data: cosmetics,
              maps_data: maps,
              stylist_data: stylist,
              gender_update: genderUpdate,
              // Duplicate fields for backward compatibility with older clients
              garment,
              cosmetics,
              maps,
              stylist,
              events: parsed.events,
              sets: parsed.sets,
              // Literal, untouched bytes as received from ChatWonder.
              raw: fullResponse,
              // NOTE: despite the name, this is `cleaned` (post stripSourcesPrefix),
              // kept for backward compatibility with existing clients.
              raw_chatwonder_response: cleaned,
              metadata: {
                conversationId,
                userMessageId: userMessage.id,
                aiMessageId: aiMessage.id,
              },
            });
            res.end();
          } catch (err) {
            logger.error(`[ChatWonderController] Error saving response: ${(err as Error).message}`);
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

      const gender = await ChatWonderService.getUserGender(userId);

      // Fetch outlineId if it exists
      const outline = await ChatWonderService.ensureConversation(userId, input.substring(0, 50), inputConversationId).then(cid => OutlineRepo.findByConversationId(cid));
      
      // 7. Stream from external ChatWonder API
      await streamChat({
        userInput: input,
        sessionId: sessionId as string,
        callbacks,
        userId,
        outlineId: outline?.id,
        weather: frontendWeather,
        location: frontendLocation,
        skinAnalysis,
        gender: gender || undefined,
        sitemapContext,
        history,
      });
    } catch (err) {
      logger.error(`[ChatWonderController] Controller error: ${(err as Error).message}`);
      if (!res.headersSent) {
        responseError(res, 500, (err as Error).message || "Internal server error");
      }
    }
  }

  /**
   * Buffered, non-streaming twin of `streamChat`. Behaves identically
   * (conversation persistence, finalization keywords, kiosk emits,
   * session-expired recovery, gender + weather context) but buffers the whole
   * ChatWonder response and answers with a single `application/json` payload
   * instead of SSE.
   *
   * Because nothing is written until the response completes, every error path
   * returns a real HTTP status (e.g. `session_expired` → 409) rather than an
   * in-band SSE `error` event.
   *
   * The body is `{ message, intent, garment_data, cosmetics_data, metadata }`:
   * `message` is the plain display text and `garment_data`/`cosmetics_data` are
   * the parsed `[GARMENT_DATA]`/`[COSMETICS_DATA]` blocks (null when absent) — a
   * deliberately richer contract than `/stream`'s `complete` event.
   */
  static async chat(req: Request, res: Response) {
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
      location: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lng: Joi.number().min(-180).max(180).required(),
      }).optional(),
      skin_analysis: Joi.object().optional(),
      kioskId: Joi.string().optional(),
      voice: Joi.boolean().optional(), // opt-in: synthesize TTS audio for the reply
      lang: Joi.string().optional(), // TTS language (e.g. "en-US", "fr-FR", "ko-KR")
      sitemap_context: Joi.array().items(Joi.string()).optional(),
      history: Joi.array()
        .items(
          Joi.object({
            role: Joi.string().valid("user", "assistant").required(),
            content: Joi.string().required(),
          })
        )
        .max(10)
        .optional(),
    }).or("input", "user_input"); // Require at least one of these

    const { error, value } = schema.validate(req.body, { allowUnknown: true });
    if (error) {
      return responseError(res, 400, error.message);
    }

    const input = value.input || value.user_input;
    const inputConversationId = value.conversationId;
    const kioskId = value.kioskId;
    const frontendWeather = value.weather;
    const frontendLocation = value.location;
    const skinAnalysis = value.skin_analysis;
    const wantsVoice = value.voice === true;
    const ttsLang = value.lang || "en-US";
    const sitemapContext = value.sitemap_context;
    const history = (value.history ?? []).slice(-10);

    try {
      const gender = await ChatWonderService.getUserGender(userId);

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

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let fullResponse = "";
      let sentenceBuffer = "";
      let displayedLen = 0;
      let ttsPromise = Promise.resolve();

      const responseWithFlush = res as Response & { flush?: () => void };
      const writeSseEvent = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        responseWithFlush.flush?.();
      };

      const cleanDisplayPrefix = (full: string): string => {
        let display = cutToMessage(full);
        const lastOpen = display.lastIndexOf("[");
        if (lastOpen !== -1 && !display.slice(lastOpen).includes("]")) {
          display = display.slice(0, lastOpen);
        }
        const lastNL = display.lastIndexOf("\n");
        const lastLine = display.slice(lastNL + 1).trimStart();
        if (/^#{1,6}(\s|$)/.test(lastLine)) {
          display = lastNL === -1 ? "" : display.slice(0, lastNL);
        }
        return display;
      };

      const processSentence = (text: string) => {
        if (!text.trim()) return;

        // Chain the TTS generation and SSE emission in order
        ttsPromise = ttsPromise.then(async () => {
          // If the connection was closed by the client, stop generating audio to save quota
          if (res.writableEnded || res.destroyed) {
            return;
          }

          let audioBase64: string | null = null;
          if (wantsVoice) {
            try {
              const audio = await voiceService.tts(text, ttsLang);
              audioBase64 = audio.toString("base64");
            } catch (ttsErr) {
              logger.warn(`[ChatWonderController.chat] TTS failed for chunk: ${(ttsErr as Error).message}`);
            }
          }
          writeSseEvent({ type: "audio_chunk", text, audioBase64 });
        });
      };

      // 4. Stream from external ChatWonder API
      await streamChat({
        userInput: input,
        sessionId: sessionId as string,
        callbacks: {
          onChunk: (chunk: string) => {
            fullResponse += chunk;
            const display = cleanDisplayPrefix(fullResponse);
            if (display.length > displayedLen) {
              const newText = display.slice(displayedLen);
              displayedLen = display.length;
              
              // Emit chunk for the UI to stream text character-by-character
              writeSseEvent({ type: "chunk", content: newText });

              sentenceBuffer += newText;

              let match;
              // Extract completed sentences
              while ((match = sentenceBuffer.match(/^([\s\S]*?[.!?]+[\s\n]+)([\s\S]*)$/))) {
                processSentence(match[1]);
                sentenceBuffer = match[2];
              }
            }
          },
          onComplete: async () => {
            try {
              // Process any remaining text in buffer
              if (sentenceBuffer.trim()) {
                processSentence(sentenceBuffer);
                sentenceBuffer = "";
              }

              // Wait for all queued TTS requests to finish
              await ttsPromise;

              // Clean + parse the buffered response.
              const { cleaned } = stripSourcesPrefix(fullResponse);
              const parsed = parseChatWonderResponse(cleaned);
              if (parsed.events.length > 0) {
                parsed.events = await resolveItineraryLocations(parsed.events);
              }

              // Extract structured payloads
              let garment_data = extractChatWonderDataBlock(fullResponse, "GARMENT_DATA");
              let cosmetics_data = extractChatWonderDataBlock(fullResponse, "COSMETICS_DATA");
              let maps_data = extractChatWonderDataBlock(fullResponse, "MAPS_DATA");
              let stylist_data = extractChatWonderDataBlock(fullResponse, "STYLIST")
                ?? extractChatWonderDataBlock(fullResponse, "NAV_DATA");

              // --- INTERCEPT: Force pure conversational greeting ---
              if (input.includes("[SYSTEM] The user just walked up to the mirror.")) {
                garment_data = null;
                cosmetics_data = null;
                maps_data = null;
                stylist_data = null;
                logger.info("[ChatWonderController] Intercepted and stripped data blocks from greeting (buffered).");
              }
              const gender_data = extractChatWonderDataBlock(fullResponse, "GENDER_UPDATE") as any;

              if (gender_data && gender_data.gender) {
                const newGender = String(gender_data.gender).toUpperCase();
                if (["MALE", "FEMALE", "UNISEX"].includes(newGender)) {
                  await UserService.updateUser(userId, { gender: newGender as any });
                  logger.info(`[ChatWonderController] Caught GENDER_UPDATE: ${newGender}`);
                }
              }

              const message = parsed.message
                .split(/\n\n\[\s*(?:garments?|cosmetics|maps?)\s*\]/)[0]
                .split(
                  /\[(?:MAPS_DATA|STYLIST|NAV_DATA|GARMENT_DATA|COSMETICS_DATA|GENDER_UPDATE)\]/,
                )[0]
                .trim();

              const isFinalization =
                /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(
                  input
                );

              if (isFinalization) {
                await ChatWonderService.finalizeOutlineByConversationId(conversationId);
                if (kioskId) {
                  emitToKiosk(kioskId, "itinerary_locked", { conversationId });
                }
              }

              const aiMessage = await ChatWonderService.saveAIMessage(
                userId,
                conversationId,
                parsed.message
              );

              writeSseEvent({
                type: "complete",
                message,
                intent: parsed.intent,
                garment_data,
                cosmetics_data,
                maps_data,
                stylist_data,
                gender_update: gender_data,
                events: parsed.events,
                sets: parsed.sets,
                metadata: {
                  conversationId,
                  userMessageId: userMessage.id,
                  aiMessageId: aiMessage.id,
                },
              });
              res.end();
            } catch (err) {
              logger.error(`[ChatWonderController.chat] onComplete error: ${(err as Error).message}`);
              writeSseEvent({ type: "error", message: "Failed to parse final response" });
              res.end();
            }
          },
          onError: async (err: Error) => {
            logger.error(`[ChatWonderController.chat] Stream error: ${err.message}`);
            if (err.message.includes("Unknown session")) {
              await CacheUtil.del(`chat:sessionId:${userId}`);
              ChatWonderService.generateChatSessionId(userId, true).catch(() => {});
              
              if (!res.headersSent) {
                  responseError(res, 409, "Session expired. Please resend your message.", { code: "session_expired" });
              } else {
                  writeSseEvent({ type: "error", code: "session_expired", message: "Session expired. Please resend your message." });
                  res.end();
              }
              return;
            }

            if (!res.headersSent) {
              responseError(res, 500, err.message);
              return;
            }

            writeSseEvent({ type: "error", message: err.message });
            res.end();
          },
        },
        userId,
        weather: frontendWeather,
        location: frontendLocation,
        skinAnalysis,
        gender: gender || undefined,
        sitemapContext,
        history,
      });
    } catch (err) {
      const message = (err as Error).message || "Internal server error";
      logger.error(`[ChatWonderController.chat] ${message}`);

      if (message.includes("Unknown session")) {
        await CacheUtil.del(`chat:sessionId:${userId}`);
        ChatWonderService.generateChatSessionId(userId, true).catch(() => {});

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
