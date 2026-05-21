import axios from "axios";
import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  VoiceId,
  OutputFormat,
} from "@aws-sdk/client-polly";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  LanguageCode,
} from "@aws-sdk/client-transcribe-streaming";
import {
  AWS_VOICE_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  CHAT_WONDER_API_URL,
} from "../../config";
import { weatherService } from "./weather.service";
import { prisma } from "../../utils/prisma";
import { streamChat } from "../../utils/chat-wonder-stream";
import { parseChatWonderResponse } from "../../utils/parse-response.util";
import logger from "../../utils/logger";
import ChatRepository from "../../repositories/chat.repository";
import WeatherSnapshotService from "./weather-snapshot.service";

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
  const time =
    ctx.currentTime ??
    new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const date =
    ctx.currentDate ??
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const contextLines = [
    `[Smart Mirror — ${date}, ${time}]`,
    `Weather: ${weatherInfo}`,
    ctx.schedules ? `Schedule: ${ctx.schedules}` : null,
    ctx.currentPage ? `Current screen: ${ctx.currentPage}` : null,
    ctx.isNavigating
      ? `Navigation: active | destination: ${ctx.destinationName ?? "unknown"} | distance: ${formatDistance(ctx.remainingDistance)} | ETA: ${formatDuration(ctx.remainingDuration)}`
      : null,
    ctx.staffClarification?.trim() ? `Staff note: ${ctx.staffClarification.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${contextLines}\n\nUser: ${transcript}`;
}

function detectIntent(transcript: string): VoiceAction {
  const t = transcript.toLowerCase().trim();

  // Navigate to a physical place
  const navMatch = t.match(/(?:take me to|navigate to|directions? to|drive to|go to)\s+(.+)/i);
  if (navMatch) return { type: "maps_navigate", destination: navMatch[1].trim() };

  // Travel mode
  const modeMatch = t.match(
    /(?:switch|change|set).{0,10}(?:to|mode).{0,5}(car|motorcycle|bicycle|bike|walking|walk)\b/i
  );
  if (modeMatch) {
    const modeMap: Record<string, string> = { bike: "bicycle", walk: "walking" };
    const raw = modeMatch[1].toLowerCase();
    return { type: "set_profile", profile: modeMap[raw] ?? raw };
  }

  // Map controls
  if (/\b(best route|avoid traffic|traffic.{0,10}route)\b/i.test(t))
    return { type: "traffic_route" };
  if (/\b(turn on|enable|show)\s+traffic\b/i.test(t)) return { type: "traffic_on" };
  if (/\b(turn off|disable|hide)\s+traffic\b/i.test(t)) return { type: "traffic_off" };
  if (/\b(stop|cancel|end)\s+navigation\b/i.test(t)) return { type: "stop_navigation" };

  // Screen navigation
  if (/\b(open|show|go\s+to)\s+(the\s+)?map\b/i.test(t)) return { type: "navigate", route: "/map" };
  if (
    /\b(build|create|make|assemble)\s+(an?\s+)?(outfit|look|style)\b|\b(pick|choose)\s+(clothes|outfit)\b/i.test(
      t
    )
  )
    return { type: "navigate", route: "/outfit-builder" };
  if (/\btry\s+it\s+on\b|\bvirtual\s+(fitting|mirror|try)\b/i.test(t))
    return { type: "navigate", route: "/virtual-mirror" };
  if (/\b(show|open|go\s+to)\s+(my\s+)?schedule\b/i.test(t))
    return { type: "navigate", route: "/schedule" };
  if (/\b(take\s+(a\s+)?photo|capture|camera)\b/i.test(t))
    return { type: "navigate", route: "/kiosk-logged-in" };
  if (/\b(scan|qr\s*code|pair)\b/i.test(t)) return { type: "navigate", route: "/qrcode" };
  if (/\b(plan|set\s+up).{0,10}event\b/i.test(t))
    return { type: "navigate", route: "/event-setup" };
  if (/\b(home|main\s+screen|welcome)\b/i.test(t)) return { type: "navigate", route: "/" };

  return { type: "speak" };
}

async function getChatWonderSession(sessionId?: string): Promise<string> {
  if (sessionId) return sessionId;
  try {
    const res = await axios.get(`${CHAT_WONDER_API_URL}/session-id`);
    const sid = res.data?.session_id;
    if (!sid) logger.warn("[VoiceService] /session returned no session_id, response:", res.data);
    return sid || "";
  } catch (err) {
    logger.error(`[VoiceService] Failed to create ChatWonder session: ${(err as Error).message}`);
    return "";
  }
}

async function askChatWonder(
  transcript: string,
  ctx: VoiceContext,
  weatherInfo: string
): Promise<string> {
  const query = buildChatWonderQuery(transcript, ctx, weatherInfo);
  const sid = await getChatWonderSession(ctx.sessionId);

  if (!sid) {
    logger.error("[VoiceService] No ChatWonder session ID available — cannot stream chat");
    return "I'm here to help — could you say that again?";
  }

  logger.info(`[VoiceService] Using ChatWonder session: ${sid}`);
  let raw = "";
  try {
    await streamChat(query, sid, "mirror", {
      onChunk: (chunk) => {
        raw += chunk;
      },
      onComplete: () => {
        /* stream complete */
      },
      onError: (err) => {
        logger.error(`[VoiceService] ChatWonder stream error: ${err.message}`);
      },
    });
  } catch (err) {
    logger.error(`[VoiceService] ChatWonder failed: ${(err as Error).message}`);
    return "I'm here to help — could you say that again?";
  }

  return parseChatWonderResponse(raw).message || "I'm here to help with your style and more.";
}

const awsCredentials = { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY };
const pollyClient = new PollyClient({ region: AWS_VOICE_REGION, credentials: awsCredentials });
const transcribeClient = new TranscribeStreamingClient({
  region: AWS_VOICE_REGION,
  credentials: awsCredentials,
});

async function transcribe(pcmBuffer: Buffer): Promise<string> {
  async function* audioStream() {
    // Transcribe Streaming requires chunks ≤ 32 KB
    const CHUNK = 32000;
    for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK) {
      yield { AudioEvent: { AudioChunk: pcmBuffer.subarray(offset, offset + CHUNK) } };
    }
  }

  const cmd = new StartStreamTranscriptionCommand({
    LanguageCode: LanguageCode.EN_US,
    MediaEncoding: "pcm",
    MediaSampleRateHertz: 16000,
    AudioStream: audioStream(),
  });

  const response = await transcribeClient.send(cmd);
  const parts: string[] = [];

  if (!response.TranscriptResultStream) {
    throw new Error("No TranscriptResultStream received");
  }

  for await (const event of response.TranscriptResultStream) {
    const results = event.TranscriptEvent?.Transcript?.Results ?? [];
    for (const result of results) {
      if (!result.IsPartial) {
        const alt = result.Alternatives?.[0]?.Transcript;
        if (alt) parts.push(alt);
      }
    }
  }

  return parts.join(" ").trim();
}

async function synthesize(text: string): Promise<Buffer> {
  const cmd = new SynthesizeSpeechCommand({
    Engine: Engine.NEURAL,
    VoiceId: VoiceId.Joanna,
    OutputFormat: OutputFormat.MP3,
    Text: text,
  });

  const response = await pollyClient.send(cmd);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const voiceService = {
  process: async (
    pcmBuffer: Buffer,
    ctx: VoiceContext = {}
  ): Promise<{ transcript: string; speech: string; action: VoiceAction; audio: Buffer }> => {
    const transcript = await transcribe(pcmBuffer);
    if (!transcript) throw new Error("EMPTY_TRANSCRIPT");

    let weatherInfo = "unavailable";
    if (ctx.lat !== undefined && ctx.lng !== undefined && !isNaN(ctx.lat) && !isNaN(ctx.lng)) {
      try {
        const w = await weatherService.getWeather(ctx.lat, ctx.lng);
        weatherInfo = `${Math.round(w.temperature)}°C, ${w.condition}, wind ${Math.round(w.windspeed)} km/h, humidity ${w.humidity}%`;
        if (ctx.userOutlineId) {
          WeatherSnapshotService.ingestObservation(ctx.userOutlineId, {
            temperature: Math.round(w.temperature),
            humidity: Math.round(w.humidity),
            uvIndex: Math.round(w.uvIndex),
            precipitationProb: Math.round(w.precipitationProb),
            windSpeed: Math.round(w.windspeed),
          }).catch((err) => logger.error(`[VoiceService] Weather snapshot failed: ${err.message}`));
        }
      } catch (err) {
        logger.warn(`[VoiceService] Failed to fetch weather info: ${(err as Error).message}`);
      }
    }

    const action = detectIntent(transcript);
    const speech = await askChatWonder(transcript, ctx, weatherInfo);
    const audio = await synthesize(speech);

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
            conversationId,
            message: transcript,
            role: "USER",
          });
          await ChatRepository.createMessage({
            conversationId,
            message: speech,
            role: "AI",
          });
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() },
          });
        }
      } catch (err) {
        logger.error(`[VoiceService] Failed to persist conversation: ${(err as Error).message}`);
      }
    }

    return { transcript, speech, action, audio };
  },

  tts: async (text: string): Promise<Buffer> => synthesize(text),
};
