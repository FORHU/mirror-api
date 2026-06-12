import { Response } from "express";
import ChatWonderService from "../services/shared/chat-wonder.service";
import UserService from "../services/shared/user.service";
import { type StreamCallbacks } from "./chat-wonder-stream";
import { stripSourcesPrefix } from "./source-metadata.util";
// import { resolveItineraryLocations, persistOutlineMaps } from "./chat-wonder-maps.util";
import {
  resolveAndPersistOutlineCosmetics,
  resolveOutlineCosmeticsByIds,
} from "./chat-wonder-cosmetics.util";
import { persistOutlineOutfits, resolveOutfitsFromQuery, extractFashionMetaCategory, extractCosmeticsMetaCategory } from "./chat-wonder-outfits.util";
import {
  parseChatWonderResponse,
  extractChatWonderDataBlock,
  stripMarkdownFormatting,
} from "./parse-chatWonder-response.util";
import { voiceService } from "../services/shared/voice.service";
import logger from "./logger";
import { responseError } from "../helpers/response.helper";
import {
  checkAndFinalizeOutline,
  cleanDisplayPrefix,
  clearStaleSession,
  isCosmeticsLikely,
} from "../helpers/chat-wonder.helper";

const MIRROR_GREETING = "[SYSTEM] The user just walked up to the mirror.";
const VALID_GENDERS = ["MALE", "FEMALE", "UNISEX"] as const;

export interface ChatWonderSseCallbacksContext {
  res: Response;
  userId: string;
  conversationId: string;
  input: string;
  kioskId?: string | null;
  skinAnalysis?: Record<string, unknown>;
  wantsVoice: boolean;
  ttsLang: string;
  userMessagePromise: Promise<unknown>;
}

export function createChatWonderSseCallbacks(ctx: ChatWonderSseCallbacksContext): StreamCallbacks {
  const { res, userId, conversationId, input, kioskId, skinAnalysis, wantsVoice, ttsLang } = ctx;

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

    const ttsFetchPromise = wantsVoice
      ? voiceService.tts(text, ttsLang).catch((ttsErr) => {
          logger.warn(
            `[ChatWonderController.chat] TTS failed for chunk: ${(ttsErr as Error).message}`
          );
          return null;
        })
      : Promise.resolve(null);

    ttsPromise = ttsPromise.then(async () => {
      if (res.writableEnded || res.destroyed) {
        return;
      }

      const audio = await ttsFetchPromise;
      const audioBase64 = audio ? audio.toString("base64") : null;
      writeSseEvent({ type: "audio_chunk", text, audioBase64 });
    });
  };

  const onChunk = (chunk: string) => {
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

      writeSseEvent({ type: "chunk", content: newText });

      sentenceBuffer += newText;

      let match: RegExpMatchArray | null = null;
      while (sentenceBuffer.length > 0) {
        match = sentenceBuffer.match(/^([\s\S]*?[.!?]+(?:\s+|$))([\s\S]*)$/);
        if (!match) {
          const softMatch = sentenceBuffer.match(/^([\s\S]*?:)(\s+)([A-Z#*-][\s\S]*)$/);
          if (!softMatch) break;
          processSentence(`${softMatch[1]}${softMatch[2]}`);
          sentenceBuffer = softMatch[3];
          continue;
        }

        processSentence(match[1]);
        sentenceBuffer = match[2];
      }
    }
  };

  const onComplete = async () => {
    try {
      if (sentenceBuffer.trim()) {
        processSentence(sentenceBuffer);
        sentenceBuffer = "";
      }

      await ttsPromise;

      logger.info(
        `[ChatWonderController.chat] Stream completed. FullResponse length: ${fullResponse.length}`
      );
      logger.info(
        `[ChatWonderController.chat] Raw FullResponse:\n------------------\n${fullResponse}\n------------------`
      );

      const { cleaned } = stripSourcesPrefix(fullResponse);
      const parsed = parseChatWonderResponse(cleaned);
      // if (parsed.events.length > 0) {
      //   parsed.events = await resolveItineraryLocations(parsed.events);
      // }

      const allData = await Promise.all([
        extractChatWonderDataBlock(fullResponse, "GARMENT_DATA"),
        extractChatWonderDataBlock(fullResponse, "COSMETICS_DATA"),
        // extractChatWonderDataBlock(fullResponse, "MAPS_DATA"),
        extractChatWonderDataBlock(fullResponse, "STYLIST") ??
          extractChatWonderDataBlock(fullResponse, "NAV_DATA"),
        extractChatWonderDataBlock(fullResponse, "TAILOR_DATA"),
      ]);
      let [garment_data, cosmetics_data, stylist_data] = allData;
      const tailor_data = allData[3];
      let maps_data: unknown = null;

      // ChatWonder classifies FASHION intents correctly but doesn't always emit
      // a [GARMENT_DATA] block with a query. Synthesise one from the input so
      // the resolution block below can fetch matching outfits from the DB.
      if (parsed.intent === "FASHION" && (!garment_data || !(garment_data as Record<string, unknown>).query)) {
        const metaCategory = extractFashionMetaCategory(input);
        if (metaCategory) {
          garment_data = { query: `metaCategory=${metaCategory}&limit=4` };
          logger.info(`[ChatWonderController] Synthesised garment_data query: metaCategory=${metaCategory}`);
        }
      }

      if (garment_data && typeof garment_data === "object" && (garment_data as Record<string, unknown>).query) {
        const queryStr = (garment_data as Record<string, unknown>).query as string;
        const category = new URLSearchParams(queryStr).get("metaCategory") ?? "";
        const resolved = await resolveOutfitsFromQuery(garment_data, userId);
        if (resolved) {
          garment_data = {
            success: true,
            query: queryStr,
            sets: (resolved.outfits as Record<string, unknown>[]).map((o, i) => ({
              set_number: i + 1,
              outfit_id: o.id,
              outfit_name: o.name ?? "",
              outfit_description: o.description ?? "",
              outfit_imageUrl: (o.file as Record<string, unknown> | null)?.fileUrl ?? "",
              vibe: category,
              reason: resolved.reason,
              recommendations: ((o.items as Record<string, unknown>[]) ?? []).map((item) => {
                const g = item.garment as Record<string, unknown> | null;
                return {
                  id: g?.id,
                  name: g?.name ?? "",
                  description: g?.description ?? "",
                  imageUrl: g?.imageUrl ?? "",
                  fittingSlot: g?.fittingSlot ?? [],
                  garmentType: g?.garmentType ?? [],
                  category: g?.category ?? [],
                  layerLevel: g?.layerLevel ?? "",
                  silhouette: g?.silhouette ?? "",
                };
              }),
            })),
          };
        } else {
          garment_data = null;
        }
      }

      if (input.includes(MIRROR_GREETING)) {
        garment_data = null;
        cosmetics_data = null;
        // maps_data = null; // already null
        stylist_data = null;
        logger.info(
          "[ChatWonderController] Intercepted and stripped data blocks from greeting (buffered)."
        );
      }

      const gender_data = extractChatWonderDataBlock(fullResponse, "GENDER_UPDATE") as {
        gender?: string;
      } | null;

      if (gender_data?.gender) {
        const newGender = String(gender_data.gender).toUpperCase();
        if (VALID_GENDERS.includes(newGender as (typeof VALID_GENDERS)[number])) {
          await UserService.updateUser(userId, {
            gender: newGender as "MALE" | "FEMALE" | "UNISEX",
          });
          logger.info(`[ChatWonderController] Caught GENDER_UPDATE: ${newGender}`);
        }
      }

      const isGreeting = input.includes(MIRROR_GREETING);

      // ChatWonder classifies COSMETIC intents correctly but doesn't always emit
      // a [COSMETICS_DATA] block with a query. Synthesise one from the input (or
      // the user's skin profile) so the new query flow runs instead of legacy IDs.
      if (!isGreeting && parsed.intent === "COSMETIC" && (!cosmetics_data || !(cosmetics_data as Record<string, unknown>).query)) {
        const skinCategory = extractCosmeticsMetaCategory(input, skinAnalysis);
        if (skinCategory) {
          cosmetics_data = { query: `metaCategory=${skinCategory}&limit=4` };
          logger.info(`[ChatWonderController] Synthesised cosmetics_data query: metaCategory=${skinCategory}`);
        }
      }

      const cosmeticsQuery =
        cosmetics_data && typeof cosmetics_data === "object"
          ? (cosmetics_data as Record<string, unknown>).query
          : undefined;
      const wantsCosmetics =
        !isGreeting &&
        (cosmetics_data != null || parsed.intent === "COSMETIC" || !!parsed.cosmetics_suggestion || isCosmeticsLikely(input));
      if (wantsCosmetics) {
        if (typeof cosmeticsQuery === "string") {
          // New flow: AI sent a query — frontend fetches products itself.
          cosmetics_data = { query: cosmeticsQuery };
        } else {
          // Legacy flow: AI sent product IDs — resolve and send inline.
          let resolved = await resolveOutlineCosmeticsByIds(conversationId, cosmetics_data);
          if (!resolved.length) {
            resolved = await resolveAndPersistOutlineCosmetics(conversationId, skinAnalysis);
          }
          if (resolved.length) cosmetics_data = { recommendations: resolved };
        }
      }

      const message = stripMarkdownFormatting(
        parsed.message
          .split(/\n\n\[\s*(?:garments?|cosmetics|maps?)\s*\]/)[0]
          .split(/\[(?:MAPS_DATA|STYLIST|NAV_DATA|GARMENT_DATA|COSMETICS_DATA|GENDER_UPDATE|TAILOR_DATA)\]/)[0]
          .trim()
      );

      writeSseEvent({
        type: "complete",
        message,
        intent: parsed.intent,
        garment_data,
        cosmetics_data,
        maps_data,
        stylist_data,
        tailor_data,
        gender_update: gender_data,
        events: parsed.events,
        sets: parsed.sets,
        metadata: {
          conversationId,
          userMessageId: "pending",
        },
      });
      res.end();

      ctx.userMessagePromise.catch((err) =>
        logger.error(`[onComplete] saveUserMessage failed: ${(err as Error).message}`)
      );
      ChatWonderService.saveAIMessage(userId, conversationId, parsed.message).catch((err) =>
        logger.error(`[onComplete] saveAIMessage failed: ${(err as Error).message}`)
      );
      checkAndFinalizeOutline(input, conversationId, kioskId).catch((err) =>
        logger.error(`[onComplete] checkAndFinalizeOutline failed: ${(err as Error).message}`)
      );
      persistOutlineOutfits(conversationId, garment_data).catch((err) =>
        logger.error(`[onComplete] persistOutlineOutfits failed: ${(err as Error).message}`)
      );
      // persistOutlineMaps(conversationId, maps_data).catch((err) =>
      //   logger.error(`[onComplete] persistOutlineMaps failed: ${(err as Error).message}`)
      // );
    } catch (err) {
      logger.error(`[ChatWonderController.chat] onComplete error: ${(err as Error).message}`);
      writeSseEvent({ type: "error", message: "Failed to parse final response" });
      res.end();
    }
  };

  const onError = async (err: Error) => {
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
  };

  return { onChunk, onComplete, onError };
}
