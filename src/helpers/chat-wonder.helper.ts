import Joi from "joi";
import ChatWonderService from "../services/shared/chat-wonder.service";
import { emitToKiosk } from "../utils/socket.util";
import logger from "../utils/logger";
import CacheUtil from "../utils/cache.util";
import { cutToMessage } from "../utils/parse-chatWonder-response.util";

export const chatWonderBaseSchema = Joi.object({
  input: Joi.string().min(1).max(5000).optional(),
  user_input: Joi.string().min(1).max(5000).optional(),
  conversationId: Joi.string().allow(null, "").optional(),
  session_id: Joi.string().allow(null, "").optional(),
  type: Joi.string().allow(null, "").optional(),
  weather: Joi.object().allow(null).optional(),
  location: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  })
    .allow(null)
    .optional(),
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
}).or("input", "user_input");

export async function checkAndFinalizeOutline(
  input: string,
  conversationId: string,
  kioskId?: string | null
) {
  const isFinalization =
    /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(
      input
    );

  if (isFinalization) {
    await ChatWonderService.finalizeOutlineByConversationId(conversationId);
    logger.info(
      `[ChatWonderHelper] Finalized UserOutline status for conversation: ${conversationId}`
    );

    if (kioskId) {
      emitToKiosk(kioskId, "itinerary_locked", { conversationId });
      logger.info(`[ChatWonderHelper] Emitted itinerary_locked to kiosk: ${kioskId}`);
    }
  }
}

/**
 * Strips trailing data markers and holds back a partially-arrived marker so
 * it never flickers in the display stream. Suppresses an in-progress heading
 * line until it is complete (can't distinguish `## Set` from `### Outfit` mid-line).
 */
export function cleanDisplayPrefix(full: string): string {
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
}

/** Clears a stale chat session from Redis and pre-warms a fresh one. */
export async function clearStaleSession(userId: string): Promise<void> {
  await CacheUtil.del(`chat:sessionId:${userId}`);
  ChatWonderService.generateChatSessionId(userId, true)
    .then((id) => logger.info(`[ChatWonderHelper] Fresh session pre-warmed: ${id}`))
    .catch((e) =>
      logger.warn(`[ChatWonderHelper] Pre-warm failed for user ${userId}: ${e.message}`)
    );
}
