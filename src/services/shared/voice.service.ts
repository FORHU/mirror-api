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
import {
  parseChatWonderResponse,
  type ChatWonderResponse,
} from "../../utils/parse-chatWonder-response.util";
import { resolveItineraryCosmetics } from "../../utils/chat-wonder-cosmetics.util";
import logger from "../../utils/logger";
import ChatRepository from "../../repositories/chat.repository";
import WeatherSnapshotService from "./weather-snapshot.service";
import fs from "fs";
import path from "path";

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

function buildChatWonderQuery(
  transcript: string,
  ctx: VoiceContext,
  weatherInfo: string,
  isCommand: boolean = false
): string {
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
    "SYSTEM: You are a Smart Mirror assistant. Keep all responses highly conversational, natural, and EXTREMELY concise (maximum 2-3 short sentences). Do not output markdown, lists, or long explanations. If the user asks for styling or fashion advice (e.g., 'style my fashion', 'what to wear'), act as an expert virtual stylist and give them a confident, specific clothing recommendation based on the current weather and time.",
    `[Smart Mirror — ${date}, ${time}]`,
    `Weather: ${weatherInfo}`,
    ctx.schedules ? `Schedule: ${ctx.schedules}` : null,
    ctx.currentPage ? `Current screen: ${ctx.currentPage}` : null,
    ctx.isNavigating
      ? `Navigation: active | destination: ${ctx.destinationName ?? "unknown"} | distance: ${formatDistance(ctx.remainingDistance)} | ETA: ${formatDuration(ctx.remainingDuration)}`
      : null,
    ctx.staffClarification?.trim() ? `Staff note: ${ctx.staffClarification.trim()}` : null,
  ];

  if (isCommand) {
    contextLines.push(
      "CRITICAL SYSTEM INSTRUCTION: The user is issuing a navigation or system command (like changing the screen or route). Acknowledge this command EXTREMELY briefly in 1 short sentence (e.g., 'Sure, navigating to fashion now' or 'Opening that up'). Do NOT provide a long response or advice. ALWAYS RESPOND IN ENGLISH."
    );
  }

  const contextStr = contextLines.filter(Boolean).join("\n");

  return `${contextStr}\n\nUser: ${transcript}`;
}

function detectIntent(transcript: string): VoiceAction {
  const t = transcript.toLowerCase().trim();

  // 1. Screen navigation (Check these FIRST so 'go to fashion' doesn't trigger map navigation)
  if (/\b(open|show|go\s+to)\s+(the\s+)?map\b/i.test(t)) return { type: "navigate", route: "/map" };
  if (
    /\b(build|create|make|assemble|style)\s+(an?\s+)?(outfit|look|style|fashion)\b|\b(pick|choose|go\s+to|open)\s+(clothes|outfit|fashion)\b/i.test(
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

  // 2. Travel mode
  const modeMatch = t.match(
    /(?:switch|change|set).{0,10}(?:to|mode).{0,5}(car|motorcycle|bicycle|bike|walking|walk)\b/i
  );
  if (modeMatch) {
    const modeMap: Record<string, string> = { bike: "bicycle", walk: "walking" };
    const raw = modeMatch[1].toLowerCase();
    return { type: "set_profile", profile: modeMap[raw] ?? raw };
  }

  // 3. Map controls
  if (/\b(best route|avoid traffic|traffic.{0,10}route)\b/i.test(t))
    return { type: "traffic_route" };
  if (/\b(turn on|enable|show)\s+traffic\b/i.test(t)) return { type: "traffic_on" };
  if (/\b(turn off|disable|hide)\s+traffic\b/i.test(t)) return { type: "traffic_off" };
  if (/\b(stop|cancel|end)\s+navigation\b/i.test(t)) return { type: "stop_navigation" };

  // 4. Navigate to a physical place (Check this LAST)
  const navMatch = t.match(/(?:take me to|navigate to|directions? to|drive to|go to)\s+(.+)/i);
  if (navMatch) return { type: "maps_navigate", destination: navMatch[1].trim() };

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
  weatherInfo: string,
  isCommand: boolean = false
): Promise<ChatWonderResponse> {
  const query = buildChatWonderQuery(transcript, ctx, weatherInfo, isCommand);
  const sid = await getChatWonderSession(ctx.sessionId);
  console.log("query ---------", query);
  if (!sid) {
    logger.error("[VoiceService] No ChatWonder session ID available — cannot stream chat");
    return parseChatWonderResponse(
      "I'm having trouble connecting to the network right now. Please check the connection and try again."
    );
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
    return parseChatWonderResponse(
      "I'm having trouble connecting to the network right now. Please check the connection and try again."
    );
  }

  return parseChatWonderResponse(raw);
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
  logger.info(`[VoiceService] Synthesizing speech of length: ${text.length}`);
  logger.info(`[VoiceService] Speech text: ${text.substring(0, 100)}...`);
  const isFallbackText = text.includes("having trouble connecting");

  if (isFallbackText) {
    try {
      const fallbackPath = path.join(__dirname, "../../assets/error-fallback.mp3");
      return fs.readFileSync(fallbackPath);
    } catch (e) {
      logger.error(`[VoiceService] Failed to read local fallback MP3: ${(e as Error).message}`);
      // Continue to Polly as a last resort
    }
  }

  const maxChunkLength = 2000;
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const textChunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length <= maxChunkLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim()) textChunks.push(currentChunk.trim());
      currentChunk = sentence;
    }
  }
  if (currentChunk.trim()) textChunks.push(currentChunk.trim());

  const audioBuffers: Buffer[] = [];

  try {
    for (const chunkText of textChunks) {
      const cmd = new SynthesizeSpeechCommand({
        // Available Generative Voices: Matthew (Male), Ruth (Female), Stephen (Male)
        // Available Neural Voices (requires Engine.NEURAL): Joanna, Salli, Kendra, Kimberly, Justin, Joey
        Engine: Engine.GENERATIVE,
        LanguageCode: "en-US",
        VoiceId: VoiceId.Matthew,
        OutputFormat: OutputFormat.MP3,
        Text: chunkText,
      });

      const res = await pollyClient.send(cmd);
      if (!res.AudioStream) throw new Error("No audio stream returned");
      const chunks: Uint8Array[] = [];
      // @ts-expect-error - AsyncIterable typing is incomplete in AWS SDK for AudioStream
      for await (const streamChunk of res.AudioStream) {
        chunks.push(streamChunk);
      }
      audioBuffers.push(Buffer.concat(chunks));
    }
    return Buffer.concat(audioBuffers);
  } catch (err) {
    logger.error(`[VoiceService] AWS Polly failed: ${(err as Error).message}`);
    // If Polly itself fails, try reading the local fallback file
    try {
      const fallbackPath = path.join(__dirname, "../../assets/error-fallback.mp3");
      return fs.readFileSync(fallbackPath);
    } catch (e) {
      throw new Error(`TTS synthesis failed, and fallback audio not found`);
    }
  }
}

export const voiceService = {
  process: async (
    pcmBuffer: Buffer,
    ctx: VoiceContext = {}
  ): Promise<{
    transcript: string;
    speech: string;
    action: VoiceAction;
    audio: Buffer;
    events: unknown[];
  }> => {
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

    let action = detectIntent(transcript);
    const isCommand = action.type !== "speak";
    const aiResponse = await askChatWonder(transcript, ctx, weatherInfo, isCommand);
    const speech = aiResponse.message || "I'm here to help with your style and more.";

    // AI-Driven Routing
    if (aiResponse.route_suggestion) {
      action = { type: "maps_navigate", destination: aiResponse.route_suggestion };
    } else if (aiResponse.outfit_suggestion) {
      action = { type: "navigate", route: "/outfit-builder" };
    } else if (aiResponse.cosmetics_suggestion) {
      action = { type: "navigate", route: "/ai-recommendation-cosmetic" };
    }

    let enrichedEvents = aiResponse.events || [];
    const audio = await synthesize(speech);

    if (ctx.userOutlineId) {
      try {
        const outline = await prisma.userOutline.findUnique({
          where: { id: ctx.userOutlineId },
          select: { userId: true, conversationId: true },
        });

        if (outline?.userId) {
          let conversationId = outline.conversationId;

          // Ensure conversation exists BEFORE resolving cosmetics so DB records can be linked
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

          // Process cosmetics recommendations if events exist
          if (enrichedEvents.length > 0) {
            enrichedEvents = await resolveItineraryCosmetics(
              outline.userId,
              aiResponse.events,
              conversationId
            );
          }

          // Check if user is finalizing the outline based on transcript
          const isFinalization =
            /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(
              transcript
            );
          if (isFinalization) {
            await prisma.userOutline.update({
              where: { id: ctx.userOutlineId },
              data: { status: "FINALIZED" },
            });
            logger.info(`[VoiceService] Finalized UserOutline: ${ctx.userOutlineId}`);
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

    return { transcript, speech, action, audio, events: enrichedEvents };
  },

  tts: async (text: string): Promise<Buffer> => synthesize(text),
};
