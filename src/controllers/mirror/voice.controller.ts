import { Request, Response, NextFunction } from "express";
import { voiceService, VoiceContext } from "../../services/shared/voice.service";

export default class VoiceController {
  static async process(req: Request, res: Response, next: NextFunction) {
    const pcmBuffer = req.body as Buffer;

    if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
      return res.status(400).json({ error: "No audio data received" });
    }
    if (pcmBuffer.length < 1000) {
      return res.status(400).json({ error: "Audio too short" });
    }

    let history: Array<{ user: string; assistant: string }> = [];
    try {
      if (req.query.history) history = JSON.parse(req.query.history as string);
    } catch {
      /* ignore malformed */
    }

    const ctx: VoiceContext = {
      lat: parseFloat(req.query.lat as string),
      lng: parseFloat(req.query.lng as string),
      trafficEnabled: req.query.traffic === "true",
      isNavigating: req.query.navigating === "true",
      profile: (req.query.profile as string) || "car",
      remainingDistance: req.query.remainingDistance
        ? parseFloat(req.query.remainingDistance as string)
        : undefined,
      remainingDuration: req.query.remainingDuration
        ? parseFloat(req.query.remainingDuration as string)
        : undefined,
      destinationName: req.query.destinationName
        ? decodeURIComponent(req.query.destinationName as string)
        : undefined,
      currentInstruction: req.query.currentInstruction
        ? decodeURIComponent(req.query.currentInstruction as string)
        : undefined,
      nextManeuverDistance: req.query.nextManeuverDistance
        ? parseFloat(req.query.nextManeuverDistance as string)
        : undefined,
      nextInstruction: req.query.nextInstruction
        ? decodeURIComponent(req.query.nextInstruction as string)
        : undefined,
      currentTime: req.query.currentTime
        ? decodeURIComponent(req.query.currentTime as string)
        : undefined,
      currentDate: req.query.currentDate
        ? decodeURIComponent(req.query.currentDate as string)
        : undefined,
      schedules: req.query.schedules
        ? decodeURIComponent(req.query.schedules as string)
        : undefined,
      currentPage: req.query.currentPage
        ? decodeURIComponent(req.query.currentPage as string)
        : undefined,
      userOutlineId: (req.query.userOutlineId as string) || undefined,
      staffClarification: (req.query.staffClarification as string)
        ? decodeURIComponent(req.query.staffClarification as string)
        : undefined,
      history,
    };

    try {
      const { transcript, speech, action, audio, events } = await voiceService.process(
        pcmBuffer,
        ctx
      );

      res.set({
        "Content-Type": "audio/mpeg",
        "X-Transcript": encodeURIComponent(transcript),
        "X-Reply": encodeURIComponent(speech),
        "X-Action": encodeURIComponent(JSON.stringify(action)),
        "X-Events": encodeURIComponent(JSON.stringify(events || [])),
      });
      res.send(audio);
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
}
