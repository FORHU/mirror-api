import { Request, Response } from "express";
import Joi from "joi";
import ChatWonderService from "../../services/shared/chat-wonder.service";
import OutlineRepo from "../../repositories/outline.repository";
import UserService from "../../services/shared/user.service";
import { streamChat, type StreamCallbacks } from "../../utils/chat-wonder-stream";
import { stripSourcesPrefix } from "../../utils/source-metadata.util";
import { resolveItineraryLocations } from "../../utils/chat-wonder-maps.util";
import {
  parseChatWonderResponse,
  extractChatWonderDataBlock,
  stripMarkdownFormatting,
} from "../../utils/parse-chatWonder-response.util";
import { voiceService } from "../../services/shared/voice.service";
import logger from "../../utils/logger";
import { responseError } from "../../helpers/response.helper";
import {
  chatWonderBaseSchema,
  checkAndFinalizeOutline,
  cleanDisplayPrefix,
  clearStaleSession,
} from "../../helpers/chat-wonder.helper";
import { weatherService } from "../../services/shared/weather.service";

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

      if ((err as Error).message.includes("Unknown session")) {
        await clearStaleSession(userId);
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

    const { error, value } = chatWonderBaseSchema.validate(req.body, { allowUnknown: true });
    if (error) {
      return responseError(res, 400, error.message);
    }

    let input = value.input || value.user_input;
    const inputConversationId = value.conversationId; // Note: session_id is a different Forhu AI concept, we keep conversationId logic
    const kioskId = value.kioskId;
    const frontendWeather = value.weather;
    const frontendLocation = value.location;
    const sitemapContext = value.sitemap_context;
    const history = (value.history ?? []).slice(-10);
    const skinAnalysis = value.skin_analysis;

    if (input.startsWith("[stylist]")) {
      if (skinAnalysis) {
        input = input.replace("[stylist]", "[cosmetics]");
      } else if (frontendWeather || frontendLocation) {
        input = input.replace("[stylist]", "[garment]");
      } else {
        input = input.replace("[stylist]", "[maps]");
      }
    }

    try {
      const [conversationId, sessionId, gender] = await Promise.all([
        ChatWonderService.ensureConversation(userId, input.substring(0, 50), inputConversationId),
        ChatWonderService.generateChatSessionId(userId),
        ChatWonderService.getUserGender(userId),
      ]);

      const [userMessage, outline] = await Promise.all([
        ChatWonderService.saveUserMessage(userId, conversationId, input),
        OutlineRepo.findByConversationId(conversationId),
      ]);

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let fullResponse = "";
      let navEarlyEmitted = false;
      const responseWithFlush = res as Response & { flush?: () => void };
      const writeSseEvent = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        responseWithFlush.flush?.();
      };

      let displayedLen = 0;

      const callbacks: StreamCallbacks = {
        onChunk: (chunk: string) => {
          fullResponse += chunk;
          if (!navEarlyEmitted && fullResponse.includes("[NAV_DATA]")) {
            const navData = extractChatWonderDataBlock(fullResponse, "NAV_DATA");
            if (navData) {
              writeSseEvent({ type: "nav_early", stylist_data: navData });
              navEarlyEmitted = true;
            }
          }
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
            await checkAndFinalizeOutline(input, conversationId, kioskId);

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
            let stylist =
              extractChatWonderDataBlock(fullResponse, "STYLIST") ??
              extractChatWonderDataBlock(fullResponse, "NAV_DATA");

            // --- INTERCEPT: Force pure conversational greeting ---
            // If this was the hidden auto-greeting, absolutely forbid the AI from triggering
            // navigation or popping up data widgets on the landing page.
            if (input.includes("[SYSTEM] The user just walked up to the mirror.")) {
              garment = null;
              cosmetics = null;
              maps = null;
              stylist = null;
              logger.info(
                "[ChatWonderController] Intercepted and stripped data blocks from greeting."
              );
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
            const finalDisplayMessage = stripMarkdownFormatting(
              parsed.message
                .split(/\n\n\[\s*(?:garments|cosmetics|map)\s*\]/)[0]
                .split("[MAPS_DATA]")[0]
                .split("[NAV_DATA]")[0]
                .trim()
            );

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
            await clearStaleSession(userId);
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

      // Stream from external ChatWonder API
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
    }

    const inputConversationId = value.conversationId;
    const kioskId = value.kioskId;
    const pageMode: string | null = value.page_mode ?? null;
    const wantsVoice = value.voice === true;
    const ttsLang = value.lang || "en-US";
    const sitemapContext = value.sitemap_context;
    const history = (value.history ?? []).slice(-10);

    const isGarment  = pageMode === "garment";
    const isCosmetics = pageMode === "cosmetics";
    const isOverview = pageMode === "overview";

    const frontendLocation = value.location;
    const skinAnalysis = value.skin_analysis;

    let frontendWeather: Record<string, unknown> | undefined = undefined;
    if (frontendLocation && (isGarment || isOverview || !pageMode)) {
      try {
        const d = await weatherService.getWeather(frontendLocation.lat, frontendLocation.lng);
        frontendWeather = {
          date: new Date().toISOString().split("T")[0],
          description: String(d.condition ?? "").toLowerCase(),
          estimated: false,
          is_cold: Number(d.temperature) < 20,
          is_hot: Number(d.temperature) >= 30,
          is_rainy: Number(d.precipitationProb) >= 50 || String(d.condition ?? "").toLowerCase().includes("rain"),
          lat: frontendLocation.lat,
          lon: frontendLocation.lng,
          temperature_c: Number(d.temperature),
        };
      } catch {
        /* best effort */
      }
    }

    logger.info(
      `[ChatWonderController.chat] page_mode=${pageMode ?? "none"} | input=${input.slice(0, 80)}...`
    );

    try {
      const [conversationId, sessionId, gender] = await Promise.all([
        ChatWonderService.ensureConversation(userId, input.substring(0, 50), inputConversationId),
        ChatWonderService.generateChatSessionId(userId),
        ChatWonderService.getUserGender(userId),
      ]);
      const userMessage = await ChatWonderService.saveUserMessage(userId, conversationId, input);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let fullResponse = "";
      let navEarlyEmitted = false;
      let sentenceBuffer = "";
      let displayedLen = 0;
      let ttsPromise = Promise.resolve();

      const responseWithFlush = res as Response & { flush?: () => void };
      const writeSseEvent = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        responseWithFlush.flush?.();
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
              logger.warn(
                `[ChatWonderController.chat] TTS failed for chunk: ${(ttsErr as Error).message}`
              );
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
            if (!navEarlyEmitted && fullResponse.includes("[NAV_DATA]")) {
              const navData = extractChatWonderDataBlock(fullResponse, "NAV_DATA");
              if (navData) {
                writeSseEvent({ type: "nav_early", stylist_data: navData });
                navEarlyEmitted = true;
              }
            }
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

              logger.info(
                `[ChatWonderController.chat] Stream completed. FullResponse length: ${fullResponse.length}`
              );
              logger.info(
                `[ChatWonderController.chat] Raw FullResponse:\n------------------\n${fullResponse}\n------------------`
              );

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
              let stylist_data =
                extractChatWonderDataBlock(fullResponse, "STYLIST") ??
                extractChatWonderDataBlock(fullResponse, "NAV_DATA");

              // --- INTERCEPT: Force pure conversational greeting ---
              if (input.includes("[SYSTEM] The user just walked up to the mirror.")) {
                garment_data = null;
                cosmetics_data = null;
                maps_data = null;
                stylist_data = null;
                logger.info(
                  "[ChatWonderController] Intercepted and stripped data blocks from greeting (buffered)."
                );
              }
              const gender_data = extractChatWonderDataBlock(fullResponse, "GENDER_UPDATE") as any;

              if (gender_data && gender_data.gender) {
                const newGender = String(gender_data.gender).toUpperCase();
                if (["MALE", "FEMALE", "UNISEX"].includes(newGender)) {
                  await UserService.updateUser(userId, { gender: newGender as any });
                  logger.info(`[ChatWonderController] Caught GENDER_UPDATE: ${newGender}`);
                }
              }

              const message = stripMarkdownFormatting(
                parsed.message
                  .split(/\n\n\[\s*(?:garments?|cosmetics|maps?)\s*\]/)[0]
                  .split(
                    /\[(?:MAPS_DATA|STYLIST|NAV_DATA|GARMENT_DATA|COSMETICS_DATA|GENDER_UPDATE)\]/
                  )[0]
                  .trim()
              );

              await checkAndFinalizeOutline(input, conversationId, kioskId);

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
              logger.error(
                `[ChatWonderController.chat] onComplete error: ${(err as Error).message}`
              );
              writeSseEvent({ type: "error", message: "Failed to parse final response" });
              res.end();
            }
          },
          onError: async (err: Error) => {
            logger.error(`[ChatWonderController.chat] Stream error: ${err.message}`);
            if (err.message.includes("Unknown session")) {
              await clearStaleSession(userId);
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
