import Joi from "joi";
import ChatWonderService from "../services/shared/chat-wonder.service";
import { emitToKiosk } from "../utils/socket.util";
import logger from "../utils/logger";

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
