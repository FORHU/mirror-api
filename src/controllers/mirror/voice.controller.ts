import { Request, Response, NextFunction } from "express";
import { voiceService, VoiceContext } from "../../services/shared/voice.service";
import { cognitiveVoiceService } from "../../services/shared/cognitive-voice.service";
import { CHAT_WONDER_API_URL } from "../../config";
import { weatherService } from "../../services/shared/weather.service";
import { mapService } from "../../services/shared/map.service";
import { resolveItineraryCosmetics, ChatWonderEvent } from "../../utils/chat-wonder-cosmetics.util";
import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import logger from "../../utils/logger";

export default class VoiceController {
  static async transcribe(req: Request, res: Response, next: NextFunction) {
    const pcmBuffer = req.body as Buffer;
    const lang = (req.query.lang as string) || "en-US";

    if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
      return res.status(400).json({ error: "No audio data received" });
    }
    if (pcmBuffer.length < 1000) {
      return res.status(400).json({ error: "Audio too short" });
    }

    try {
      const transcript = await voiceService.transcribeAudio(pcmBuffer, lang);
      return res.json({ transcript });
    } catch (err) {
      if ((err as Error).message === "EMPTY_TRANSCRIPT") {
        return res
          .status(422)
          .json({ error: "Could not transcribe audio. Please speak clearly and try again." });
      }
      next(err);
    }
  }

  static async ask(req: Request, res: Response, next: NextFunction) {
    const { transcript, ctx } = req.body;
    const lang = (req.query.lang as string) || "en-US";

    if (!transcript) return res.status(400).json({ error: "transcript is required" });

    const voiceCtx: VoiceContext = ctx || {};

    try {
      // Resolve weather in the controller so cognitiveVoiceService receives it as _weatherInfo
      let weatherInfo = "unavailable";
      if (
        voiceCtx.lat !== undefined &&
        voiceCtx.lng !== undefined &&
        !isNaN(voiceCtx.lat) &&
        !isNaN(voiceCtx.lng)
      ) {
        const [weatherResult, locationResult] = await Promise.allSettled([
          weatherService.getWeather(voiceCtx.lat, voiceCtx.lng),
          mapService.reverseGeocode(voiceCtx.lat, voiceCtx.lng),
        ]);
        if (weatherResult.status === "fulfilled") {
          const w = weatherResult.value;
          weatherInfo = `${Math.round(w.temperature)}°C, ${w.condition}, wind ${Math.round(w.windspeed)} km/h, humidity ${w.humidity}%`;
        } else {
          logger.warn(`[VoiceController] Weather fetch failed: ${weatherResult.reason}`);
        }
        if (locationResult.status === "fulfilled") {
          voiceCtx.locationName = locationResult.value;
        }
      }

      // Attach weather so cognitiveVoiceService can read it via _weatherInfo
      (voiceCtx as Record<string, unknown>)._weatherInfo = weatherInfo;

      const { response, sessionId } = await cognitiveVoiceService.ask(
        transcript,
        voiceCtx,
        CHAT_WONDER_API_URL || ""
      );

      // Run backend-side effects: save itinerary events and user preferences
      if (voiceCtx.userOutlineId) {
        try {
          const outline = await prisma.userOutline.findUnique({
            where: { id: voiceCtx.userOutlineId },
            select: { userId: true, conversationId: true },
          });

          if (outline?.userId) {
            // 1. Resolve Events (Itinerary & Cosmetics Engine)
            if (response.events && response.events.length > 0) {
              response.events = await resolveItineraryCosmetics(
                outline.userId,
                response.events as ChatWonderEvent[],
                outline.conversationId || ""
              );
            }

            // 2. Persist Memory Updates (Preferences)
            if (response.memoryUpdates && Object.keys(response.memoryUpdates).length > 0) {
              const user = await prisma.user.findUnique({
                where: { id: outline.userId },
                select: { preferences: true },
              });
              const currentPrefs = (user?.preferences as Record<string, unknown>) || {};
              const newPrefs = { ...currentPrefs, ...response.memoryUpdates };

              await prisma.user.update({
                where: { id: outline.userId },
                data: { preferences: newPrefs as Prisma.InputJsonValue },
              });
              logger.info(`[VoiceController] Saved memory updates for user ${outline.userId}`);
            }
          }
        } catch (err) {
          logger.error(
            `[VoiceController] Failed to process backend response effects: ${(err as Error).message}`
          );
        }
      }

      // Synthesize TTS from the cognitive reply
      const audio = await voiceService.tts(response.reply, lang, response.emotion);

      return res.json({
        reply: response.reply,
        action: response.action,
        events: response.events || [],
        sessionId,
        audioBase64: audio.toString("base64"),
        // New cognitive fields
        intent: response.intent,
        emotion: response.emotion,
        requiresConfirmation: response.requiresConfirmation,
        followUpQuestion: response.followUpQuestion,
        suggestions: response.suggestions,
        uiHints: response.uiHints,
        memoryUpdates: response.memoryUpdates,
      });
    } catch (err) {
      next(err);
    }
  }

  static async tts(req: Request, res: Response, next: NextFunction) {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "text is required" });

    try {
      const audio = await voiceService.tts(text.trim());
      res.set("Content-Type", "audio/mpeg");
      res.send(audio);
    } catch (err) {
      next(err);
    }
  }

  static async suggest(req: Request, res: Response, next: NextFunction) {
    const { type, ctx } = req.body as { type: "fashion" | "cosmetics"; ctx?: VoiceContext };
    if (!type || (type !== "fashion" && type !== "cosmetics")) {
      return res.status(400).json({ error: "Invalid type. Must be 'fashion' or 'cosmetics'." });
    }

    try {
      const suggestion = await voiceService.suggestAI(type, ctx || {});
      return res.json({ suggestion });
    } catch (err) {
      next(err);
    }
  }
}
