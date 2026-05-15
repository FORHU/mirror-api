import { Request, Response, NextFunction } from "express";
import { voiceService, VoiceContext } from "../../services/shared/voice.service";

export default class VoiceController {
  static async process(req: Request, res: Response, next: NextFunction) {
    const pcmBuffer = req.body as Buffer;

    if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
      return res.status(400).json({ error: "No audio data received" });
    }
    if (pcmBuffer.length < 8000) {
      return res.status(400).json({ error: "Audio too short" });
    }

    let history: Array<{ user: string; assistant: string }> = [];
    try {
      if (req.query.history) history = JSON.parse(req.query.history as string);
    } catch { /* ignore malformed */ }

    const ctx: VoiceContext = {
      lat:               parseFloat(req.query.lat as string),
      lng:               parseFloat(req.query.lng as string),
      trafficEnabled:    req.query.traffic    === "true",
      isNavigating:      req.query.navigating === "true",
      profile:           (req.query.profile as string) || "car",
      remainingDistance: req.query.remainingDistance ? parseFloat(req.query.remainingDistance as string) : undefined,
      remainingDuration: req.query.remainingDuration ? parseFloat(req.query.remainingDuration as string) : undefined,
      destinationName:   req.query.destinationName   ? decodeURIComponent(req.query.destinationName as string) : undefined,
      history,
    };

    try {
      const { transcript, reply, intent, destination, profile, audio } = await voiceService.process(pcmBuffer, ctx);

      res.set({
        "Content-Type":  "audio/mpeg",
        "X-Transcript":  encodeURIComponent(transcript),
        "X-Reply":       encodeURIComponent(reply),
        "X-Intent":      intent,
        "X-Destination": encodeURIComponent(destination ?? ""),
        "X-Profile":     encodeURIComponent(profile    ?? ""),
      });
      res.send(audio);
    } catch (err: any) {
      if (err.message === "EMPTY_TRANSCRIPT") {
        return res.status(422).json({ error: "Could not transcribe audio. Please speak clearly and try again." });
      }
      next(err);
    }
  }
}
