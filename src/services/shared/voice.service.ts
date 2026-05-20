import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  OutputFormat,
  VoiceId,
  TextType,
} from "@aws-sdk/client-polly";
import OpenAI, { toFile } from "openai";
import axios from "axios";
import { Readable } from "stream";
import {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  OPENAI_API_KEY,
  CHAT_WONDER_API_URL,
} from "../../config";
import { weatherService } from "./weather.service";
import { prisma } from "../../utils/prisma";
import { streamChat } from "../../utils/chat-wonder-stream";
import { parseChatWonderResponse } from "../../utils/parse-response.util";
import logger from "../../utils/logger";
import ChatRepository from "../../repositories/chat.repository";
import WeatherSnapshotService from "./weather-snapshot.service";

const VOICE_REGION = process.env.AWS_VOICE_REGION || "eu-west-1";

const pollyClient = new PollyClient({
  region: VOICE_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

export interface VoiceContext {
  lat?: number;
  lng?: number;
  trafficEnabled?: boolean;
  isNavigating?: boolean;
  profile?: string;
  history?: Array<{ user: string; assistant: string }>;
  remainingDistance?: number;
  remainingDuration?: number;
  destinationName?: string;
  currentInstruction?: string;
  nextManeuverDistance?: number;
  nextInstruction?: string;
  currentTime?: string;
  currentDate?: string;
  schedules?: string;
  currentPage?: string;
  userOutlineId?: string;
  staffClarification?: string;
  sessionId?: string;
}

export interface VoiceAction {
  type: string;
  [key: string]: unknown;
}

function formatDistance(metres?: number): string {
  if (metres === undefined || metres <= 0) return "unknown";
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds <= 0) return "unknown";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min${mins !== 1 ? "s" : ""}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

function buildChatWonderQuery(transcript: string, ctx: VoiceContext, weatherInfo: string): string {
  const time = ctx.currentTime ?? new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const date = ctx.currentDate ?? new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const contextLines = [
    `[Smart Mirror — ${date}, ${time}]`,
    `Weather: ${weatherInfo}`,
    ctx.schedules                          ? `Schedule: ${ctx.schedules}`                                                                                                     : null,
    ctx.currentPage                        ? `Current screen: ${ctx.currentPage}`                                                                                             : null,
    ctx.isNavigating                       ? `Navigation: active | destination: ${ctx.destinationName ?? "unknown"} | distance: ${formatDistance(ctx.remainingDistance)} | ETA: ${formatDuration(ctx.remainingDuration)}` : null,
    ctx.staffClarification?.trim()         ? `Staff note: ${ctx.staffClarification.trim()}`                                                                                   : null,
  ].filter(Boolean).join("\n");

  return `${contextLines}\n\nUser: ${transcript}`;
}

function detectIntent(transcript: string): VoiceAction {
  const t = transcript.toLowerCase().trim();

  // Navigate to a physical place
  const navMatch = t.match(/(?:take me to|navigate to|directions? to|drive to|go to)\s+(.+)/i);
  if (navMatch) return { type: "maps_navigate", destination: navMatch[1].trim() };

  // Travel mode
  const modeMatch = t.match(/(?:switch|change|set).{0,10}(?:to|mode).{0,5}(car|motorcycle|bicycle|bike|walking|walk)\b/i);
  if (modeMatch) {
    const modeMap: Record<string, string> = { bike: "bicycle", walk: "walking" };
    const raw = modeMatch[1].toLowerCase();
    return { type: "set_profile", profile: modeMap[raw] ?? raw };
  }

  // Map controls
  if (/\b(best route|avoid traffic|traffic.{0,10}route)\b/i.test(t)) return { type: "traffic_route" };
  if (/\b(turn on|enable|show)\s+traffic\b/i.test(t))               return { type: "traffic_on" };
  if (/\b(turn off|disable|hide)\s+traffic\b/i.test(t))             return { type: "traffic_off" };
  if (/\b(stop|cancel|end)\s+navigation\b/i.test(t))                return { type: "stop_navigation" };

  // Screen navigation
  if (/\b(open|show|go\s+to)\s+(the\s+)?map\b/i.test(t))                                                        return { type: "navigate", route: "/map" };
  if (/\b(build|create|make|assemble)\s+(an?\s+)?(outfit|look|style)\b|\b(pick|choose)\s+(clothes|outfit)\b/i.test(t)) return { type: "navigate", route: "/outfit-builder" };
  if (/\btry\s+it\s+on\b|\bvirtual\s+(fitting|mirror|try)\b/i.test(t))                                          return { type: "navigate", route: "/virtual-mirror" };
  if (/\b(show|open|go\s+to)\s+(my\s+)?schedule\b/i.test(t))                                                    return { type: "navigate", route: "/schedule" };
  if (/\b(take\s+(a\s+)?photo|capture|camera)\b/i.test(t))                                                      return { type: "navigate", route: "/kiosk-logged-in" };
  if (/\b(scan|qr\s*code|pair)\b/i.test(t))                                                                     return { type: "navigate", route: "/qrcode" };
  if (/\b(plan|set\s+up).{0,10}event\b/i.test(t))                                                               return { type: "navigate", route: "/event-setup" };
  if (/\b(home|main\s+screen|welcome)\b/i.test(t))                                                              return { type: "navigate", route: "/" };

  return { type: "speak" };
}

async function getChatWonderSession(sessionId?: string): Promise<string> {
  if (sessionId) return sessionId;
  try {
    const res = await axios.get(`${CHAT_WONDER_API_URL}/session`);
    return res.data?.session_id || "mirror-voice";
  } catch {
    return "mirror-voice";
  }
}

async function askChatWonder(transcript: string, ctx: VoiceContext, weatherInfo: string): Promise<string> {
  const query = buildChatWonderQuery(transcript, ctx, weatherInfo);
  const sid   = await getChatWonderSession(ctx.sessionId);

  let raw = "";
  try {
    await streamChat(query, sid, "mirror", {
      onChunk:    (chunk) => { raw += chunk; },
      onComplete: () => {},
      onError:    (err)  => { logger.error(`[VoiceService] ChatWonder stream error: ${err.message}`); },
    });
  } catch (err: any) {
    logger.error(`[VoiceService] ChatWonder failed: ${err.message}`);
    return "I'm here to help — could you say that again?";
  }

  return parseChatWonderResponse(raw).message || "I'm here to help with your style and more.";
}


function pcmToWav(pcm: Buffer, sampleRate = 16000, channels = 1, bitsPerSample = 16): Buffer {
  const dataSize = pcm.length;
  const header   = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(dataSize + 36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function transcribe(pcmBuffer: Buffer): Promise<string> {
  const wav  = pcmToWav(pcmBuffer);
  const file = await toFile(wav, "audio.wav", { type: "audio/wav" });
  const result = await openai.audio.transcriptions.create({ model: "whisper-1", file, language: "en" });
  return result.text.trim();
}


async function synthesize(text: string): Promise<Buffer> {
  const command = new SynthesizeSpeechCommand({
    Engine:       Engine.NEURAL,
    OutputFormat: OutputFormat.MP3,
    Text:         text,
    TextType:     TextType.TEXT,
    VoiceId:      VoiceId.Joanna,
  });
  const result = await pollyClient.send(command);
  if (!result.AudioStream) throw new Error("Polly returned no audio stream");
  const stream = result.AudioStream as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export const voiceService = {
  process: async (
    pcmBuffer: Buffer,
    ctx: VoiceContext = {},
  ): Promise<{ transcript: string; speech: string; action: VoiceAction; audio: Buffer }> => {
    const transcript = await transcribe(pcmBuffer);
    if (!transcript) throw new Error("EMPTY_TRANSCRIPT");

    let weatherInfo = "unavailable";
    if (ctx.lat !== undefined && ctx.lng !== undefined && !isNaN(ctx.lat) && !isNaN(ctx.lng)) {
      try {
        const w = await weatherService.getWeather(ctx.lat, ctx.lng);
        weatherInfo = `${Math.round(w.temperature)}°C, ${w.condition}, wind ${Math.round(w.windspeed)} km/h, humidity ${w.humidity}%`;
        if (ctx.userOutlineId) {
          await prisma.userOutline.update({
            where: { id: ctx.userOutlineId },
            data: { weather: w as any },
          });
          WeatherSnapshotService.ingestObservation(ctx.userOutlineId, {
            temperature:      Math.round(w.temperature),
            humidity:         Math.round(w.humidity),
            uvIndex:          Math.round(w.uvIndex),
            precipitationProb: Math.round(w.precipitationProb),
            windSpeed:        Math.round(w.windspeed),
          }).catch((err) => logger.error(`[VoiceService] Weather snapshot failed: ${err.message}`));
        }
      } catch {}
    }

    const action = detectIntent(transcript);
    const speech = await askChatWonder(transcript, ctx, weatherInfo);
    const audio  = await synthesize(speech);

    if (ctx.userOutlineId) {
      try {
        const outline = await prisma.userOutline.findUnique({
          where: { id: ctx.userOutlineId },
          select: { userId: true, conversationId: true },
        });

        if (outline?.userId) {
          let conversationId = outline.conversationId;

          if (!conversationId) {
            const conv = await ChatRepository.createConversation({
              userId: outline.userId,
              title: "Voice Session",
            });
            conversationId = conv.id;
            await prisma.userOutline.update({
              where: { id: ctx.userOutlineId },
              data: { conversationId },
            });
          }

          await ChatRepository.createMessage({
            userId: outline.userId,
            conversationId,
            message: transcript,
            role: "USER",
          });
          await ChatRepository.createMessage({
            userId: outline.userId,
            conversationId,
            message: speech,
            role: "AI",
          });
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() },
          });
        }
      } catch (err: any) {
        logger.error(`[VoiceService] Failed to persist conversation: ${err.message}`);
      }
    }

    return { transcript, speech, action, audio };
  },

  tts: async (text: string): Promise<Buffer> => synthesize(text),
};
