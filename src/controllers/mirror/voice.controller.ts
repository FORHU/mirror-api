import { Request, Response, NextFunction } from "express";
import { voiceService, VoiceContext } from "../../services/shared/voice.service";

import { CHAT_WONDER_API_URL } from "../../config";
import { weatherService } from "../../services/shared/weather.service";
import { mapService } from "../../services/shared/map.service";
import { resolveItineraryEvents, ChatWonderEvent } from "../../utils/chat-wonder-events.util";
import { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import logger from "../../utils/logger";

export default class VoiceController {
  static async transcribe(req: Request, res: Response, next: NextFunction) {
    const pcmBuffer = req.body as Buffer;
    const lang = (req.query.lang as string) || "en-US";
    const provider = (req.query.provider as string) === "openai" ? "openai" : "aws";

    if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
      return res.status(400).json({ error: "No audio data received" });
    }
    if (pcmBuffer.length < 1000) {
      return res.status(400).json({ error: "Audio too short" });
    }

    try {
      const transcript = await voiceService.transcribeAudio(pcmBuffer, lang, provider as "aws" | "openai");
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
