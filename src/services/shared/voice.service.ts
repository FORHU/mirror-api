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
} from "@aws-sdk/client-transcribe-streaming";
import {
  AWS_VOICE_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  CHAT_WONDER_API_URL,
} from "../../config";
import { weatherService } from "./weather.service";
import { mapService } from "./map.service";
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
  gender?: string; // User's gender from auth profile (MALE | FEMALE)
  locationName?: string; // Human-readable location resolved from lat/lng
  eventPlan?: unknown[]; // Existing event plan from UserOutline to provide context to AI
  mode?: string; // Pass mode flag e.g. "confirm_context_required"
  language?: string;
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

// ── Layer 1: SYSTEM BEHAVIOR — tone and style constraints only ──────────────
const SYSTEM_BEHAVIOR = `You are a Smart Mirror assistant.

Rules:
- Respond in a natural, confident, conversational tone.
- Keep responses extremely concise (max 2-3 sentences).
- Do not use markdown, bullet points, lists, or long explanations.
- Always be direct and helpful.`;

// ── Layer 2: DECISION / INTENT LOGIC — how to choose intents ────────────────
const INTENT_RULES = `Intent decision rules:
- Your ONLY job is to classify the user's intent into one of: FASHION, COSMETIC, MAP, MENU, RESTART, or NONE.
- DO NOT attempt to manage state, routing, or ask for confirmation to switch features. The frontend will handle all routing guards and confirmations securely.
- If the user asks to go to a feature, just output that intent directly.
- If the context contains 'mode: "confirm_context_required"', the user gave an ambiguous reply (e.g., "maybe") to a system prompt. You must ask them to clarify what they want in a friendly way (Use NONE intent).
- If the user mentions an event but hasn't stated a specific reason/plan:
  Use NONE intent and ask what the occasion is.
- If you know the event/plan (e.g. going to a party, heading to work):
  Use FASHION or COSMETIC intent. Factor in their gender and weather to recommend categories. Generate the events[] array.
- If the user asks for directions:
  Use MAP intent and populate route_suggestion.
- If the request is unclear or general conversation:
  Use NONE intent and provide a helpful conversational reply.`;

// ── Layer 3: STRICT OUTPUT CONTRACT — schema enforcement ────────────────────
const OUTPUT_CONTRACT = `OUTPUT CONTRACT — You MUST follow this exactly.

Respond ONLY with valid JSON matching this schema:
{
  "intent": "FASHION" | "COSMETIC" | "MAP" | "MENU" | "RESTART" | "NONE",
  "message": "<spoken reply, max 2-3 sentences>",
  "data": {
    "outfit"?: "<specific clothing advice if intent is FASHION>",
    "cosmetics"?: "<specific makeup/skincare advice if intent is COSMETIC>",
    "route"?: "<destination name if intent is MAP>"
  },
  "events"?: [
    {
      "type": "<event type>",
      "timeBlock": "<morning|afternoon|evening|night>",
      "fashion"?: { "suggestion": "<text>", "tags": ["<tag>", "..."] },
      "cosmetics"?: { "suggestion": "<text>", "tags": ["<tag>", "..."] }
    }
  ]
}

Strict rules:
- Output must be valid JSON only. No extra text before or after.
- Do not wrap in markdown code blocks or backticks.
- The "data" object must always be present, even if empty: "data": {}
- Only include fields inside "data" that are relevant to the intent.
- Include "events" only when intent is FASHION or COSMETIC and you have generated specific recommendations with tags.
- If you fail to follow this JSON format, your response is invalid.`;

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

  // ── Layer 4: CONTEXT BLOCK — dynamic real-time state ──────────────────────
  const contextParts = [
    `Smart Mirror Context:`,
    `- Date: ${date}`,
    `- Time: ${time}`,
    ctx.locationName ? `- Location: ${ctx.locationName}` : null,
    `- Weather: ${weatherInfo}`,
    ctx.gender ? `- User gender: ${ctx.gender}` : null,
    ctx.eventPlan && ctx.eventPlan.length > 0
      ? `- Planned Events: ${JSON.stringify(ctx.eventPlan)}`
      : null,
    ctx.currentPage ? `- Screen: ${ctx.currentPage}` : null,
    ctx.schedules ? `- Schedule: ${ctx.schedules}` : null,
    ctx.isNavigating
      ? `- Navigation: active | destination: ${ctx.destinationName ?? "unknown"} | distance: ${formatDistance(ctx.remainingDistance)} | ETA: ${formatDuration(ctx.remainingDuration)}`
      : null,
    ctx.staffClarification?.trim() ? `- Staff note: ${ctx.staffClarification.trim()}` : null,
    ctx.language ? `- Spoken Language: ${ctx.language}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const contextLines = [SYSTEM_BEHAVIOR, INTENT_RULES, OUTPUT_CONTRACT, contextParts];

  const contextStr = contextLines.filter(Boolean).join("\n");

  return `${contextStr}\n\nUser: ${transcript}`;
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
): Promise<{ response: ChatWonderResponse; sessionId: string }> {
  const query = buildChatWonderQuery(transcript, ctx, weatherInfo);
  const sid = await getChatWonderSession(ctx.sessionId);
  logger.debug(`query --------- ${query}`);
  if (!sid) {
    logger.error("[VoiceService] No ChatWonder session ID available — cannot stream chat");
    return {
      response: parseChatWonderResponse(
        "I'm having trouble connecting to the network right now. Please check the connection and try again."
      ),
      sessionId: "",
    };
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
    return {
      response: parseChatWonderResponse(
        "I'm having trouble connecting to the network right now. Please check the connection and try again."
      ),
      sessionId: sid,
    };
  }

  return { response: parseChatWonderResponse(raw), sessionId: sid };
}

const awsCredentials = { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY };
const pollyClient = new PollyClient({ region: AWS_VOICE_REGION, credentials: awsCredentials });
const transcribeClient = new TranscribeStreamingClient({
  region: AWS_VOICE_REGION,
  credentials: awsCredentials,
});

async function transcribe(pcmBuffer: Buffer, language: string): Promise<string> {
  async function* audioStream() {
    const CHUNK = 32000;
    for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK) {
      yield { AudioEvent: { AudioChunk: pcmBuffer.subarray(offset, offset + CHUNK) } };
    }
  }

  const doTranscribe = async (cmd: StartStreamTranscriptionCommand) => {
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
  };

  try {
    const cmd = new StartStreamTranscriptionCommand({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      LanguageCode: language as any,
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 16000,
      AudioStream: audioStream(),
    });

    const result = await doTranscribe(cmd);
    if (!result) throw new Error("EMPTY_TRANSCRIPT");
    return result;
  } catch (err: unknown) {
    logger.error(`[VoiceService] Transcription failed: ${(err as Error).message}`);
    throw err;
  }
}

async function synthesize(text: string, language: string): Promise<Buffer> {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let engine: any = Engine.GENERATIVE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let voiceId: any = VoiceId.Matthew;
  let langCode = "en-US";

  if (language === "fr-FR") {
    engine = Engine.NEURAL;
    voiceId = VoiceId.Lea;
    langCode = "fr-FR";
  } else if (language === "ko-KR") {
    engine = Engine.NEURAL;
    voiceId = VoiceId.Seoyeon;
    langCode = "ko-KR";
  }

  try {
    for (const chunkText of textChunks) {
      const cmd = new SynthesizeSpeechCommand({
        Engine: engine,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        LanguageCode: langCode as any,
        VoiceId: voiceId,
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
  transcribeAudio: async (pcmBuffer: Buffer, language: string = "en-US"): Promise<string> => {
    const transcript = await transcribe(pcmBuffer, language);
    if (!transcript) throw new Error("EMPTY_TRANSCRIPT");
    return transcript;
  },

  askAI: async (
    transcript: string,
    ctx: VoiceContext = {}
  ): Promise<{
    speech: string;
    action: VoiceAction;
    audio: Buffer;
    events: unknown[];
    sessionId: string;
  }> => {
    let weatherInfo = "unavailable";
    if (ctx.lat !== undefined && ctx.lng !== undefined && !isNaN(ctx.lat) && !isNaN(ctx.lng)) {
      // Resolve human-readable location name in parallel with weather fetch
      const [weatherResult, locationName] = await Promise.allSettled([
        weatherService.getWeather(ctx.lat, ctx.lng),
        mapService.reverseGeocode(ctx.lat, ctx.lng),
      ]);

      if (weatherResult.status === "fulfilled") {
        const w = weatherResult.value;
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
      } else {
        logger.warn(`[VoiceService] Failed to fetch weather info: ${weatherResult.reason}`);
      }

      if (locationName.status === "fulfilled") {
        ctx.locationName = locationName.value;
      } else {
        logger.warn(`[VoiceService] reverseGeocode failed: ${locationName.reason}`);
      }
    }

    if (ctx.userOutlineId) {
      try {
        const outline = await prisma.userOutline.findUnique({
          where: { id: ctx.userOutlineId },
          select: {
            events: {
              select: {
                type: true,
                timeBlock: true,
                fashionSuggestion: true,
                routeDestination: true,
              },
            },
          },
        });
        if (outline?.events && outline.events.length > 0) {
          ctx.eventPlan = outline.events;
        }
      } catch (err) {
        logger.warn(`[VoiceService] Failed to fetch outline events: ${(err as Error).message}`);
      }
    }

    const { response: aiResponse, sessionId } = await askChatWonder(transcript, ctx, weatherInfo);
    const speech = aiResponse.message || "I'm here to help with your style and more.";

    let action: VoiceAction = { type: "speak" };
    // Route strictly based on intent enum — no inferred routing from optional fields
    const routeMap: Record<string, string> = {
      FASHION: "/ai-recommendation-fashion",
      COSMETIC: "/ai-recommendation-cosmetic",
    };
    const intent = aiResponse.intent;
    if (intent === "MAP" && aiResponse.route_suggestion) {
      action = { type: "maps_navigate", destination: aiResponse.route_suggestion };
    } else if (intent === "FASHION" || intent === "COSMETIC") {
      const route = routeMap[intent] ?? "/ai-recommendation-fashion"; // fallback guard
      const suggestion =
        intent === "FASHION" ? aiResponse.outfit_suggestion : aiResponse.cosmetics_suggestion;
      action = { type: "navigate", route, suggestion: suggestion ?? undefined };
    }

    let enrichedEvents = aiResponse.events || [];

    // ── Sync prep: only what the response depends on ──────────────────────────
    // Resolve conversationId + cosmetics enrichment synchronously because
    // enrichedEvents is returned in the response payload. Everything else
    // (message inserts, finalization status, lastMessageAt) runs after the
    // response is sent (fire-and-forget) — see below.
    let resolvedConversationId: string | null = null;
    if (ctx.userOutlineId) {
      try {
        const outline = await prisma.userOutline.findUnique({
          where: { id: ctx.userOutlineId },
          select: { userId: true, conversationId: true },
        });

        if (outline?.userId) {
          resolvedConversationId = outline.conversationId;

          if (!resolvedConversationId) {
            const conv = await ChatRepository.createConversation({
              userId: outline.userId,
              title: "Voice Session",
            });
            resolvedConversationId = conv.id;
            await prisma.userOutline.update({
              where: { id: ctx.userOutlineId },
              data: { conversationId: resolvedConversationId },
            });
          }

          if (enrichedEvents.length > 0) {
            enrichedEvents = await resolveItineraryCosmetics(
              outline.userId,
              aiResponse.events,
              resolvedConversationId
            );
          }
        }
      } catch (err) {
        logger.error(
          `[VoiceService] Conversation/cosmetics prep failed: ${(err as Error).message}`
        );
      }
    }

    const audio = await synthesize(speech, ctx.language || "en-US");

    // ── Fire-and-forget: write messages + finalization without blocking ───────
    if (ctx.userOutlineId && resolvedConversationId) {
      const conversationId = resolvedConversationId;
      const outlineId = ctx.userOutlineId;
      void (async () => {
        try {
          const isFinalization =
            /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(
              transcript
            );
          if (isFinalization) {
            await prisma.userOutline.update({
              where: { id: outlineId },
              data: { status: "FINALIZED" },
            });
            logger.info(`[VoiceService] Finalized UserOutline: ${outlineId}`);
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
        } catch (err) {
          logger.error(
            `[VoiceService] Async conversation persistence failed: ${(err as Error).message}`
          );
        }
      })();
    }

    return { speech, action, audio, events: enrichedEvents, sessionId };
  },

  tts: async (text: string, language: string = "en-US"): Promise<Buffer> =>
    synthesize(text, language),

  suggestAI: async (type: "fashion" | "cosmetics", ctx: VoiceContext = {}): Promise<string> => {
    let weatherInfo = "unavailable";
    if (ctx.lat !== undefined && ctx.lng !== undefined && !isNaN(ctx.lat) && !isNaN(ctx.lng)) {
      try {
        const w = await weatherService.getWeather(ctx.lat, ctx.lng);
        weatherInfo = `${Math.round(w.temperature)}°C, ${w.condition}, wind ${Math.round(w.windspeed)} km/h, humidity ${w.humidity}%`;
      } catch (err) {
        logger.warn(
          `[VoiceService] Failed to fetch weather info for suggestAI: ${(err as Error).message}`
        );
      }
    }
    const transcript = `I need a quick ${type} recommendation based on the current weather.`;
    const { response: aiResponse } = await askChatWonder(transcript, ctx, weatherInfo);

    if (type === "fashion" && aiResponse.outfit_suggestion) {
      return aiResponse.outfit_suggestion;
    } else if (type === "cosmetics" && aiResponse.cosmetics_suggestion) {
      return aiResponse.cosmetics_suggestion;
    }
    return aiResponse.message || "I recommend dressing comfortably for the current weather.";
  },
};
