import os from "os";
import axios from "axios";
import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  VoiceId,
  OutputFormat,
  type LanguageCode,
} from "@aws-sdk/client-polly";

const GENERATIVE_VOICES = new Set<string>([
  VoiceId.Ruth,
  VoiceId.Matthew,
  VoiceId.Stephen,
  VoiceId.Amy,
  VoiceId.Brian,
  VoiceId.Aria,
]);
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
import openai from "../../utils/openai/ai-request.util";
import { weatherService } from "./weather.service";
import { prisma } from "../../utils/prisma";
import { streamChat } from "../../utils/chat-wonder-stream";
import {
  parseChatWonderResponse,
  type ChatWonderParsedResponse,
} from "../../utils/parse-chatWonder-response.util";
import logger from "../../utils/logger";
import * as crypto from "crypto";
import ChatRepository from "../../repositories/chat.repository";
import fs from "fs";
import path from "path";

export interface VoiceContext {
  lat?: number;
  lng?: number;
  trafficEnabled?: boolean;
  isRouteActive?: boolean;
  profile?: string;
  routeDistance?: number;
  routeDuration?: number;
  destinationName?: string;
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

function buildChatWonderQuery(
  transcript: string,
  _ctx: VoiceContext,
  _weatherInfo: string
): string {
  // Prompts removed as requested. We can just send the raw transcript.
  return transcript;
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

async function buildConversationHistory(userOutlineId?: string): Promise<string> {
  if (!userOutlineId) return "";
  try {
    const outline = await prisma.userOutline.findUnique({
      where: { id: userOutlineId },
      select: { conversationId: true },
    });
    if (!outline?.conversationId) return "";
    const messages = await ChatRepository.getHistory(outline.conversationId, 6);
    if (!messages.length) return "";
    const history = messages
      .reverse()
      .map((m) => `${m.role === "USER" ? "User" : "Assistant"}: ${m.message}`)
      .join("\n");
    logger.info(`[VoiceService] Conversation history injected: ${messages.length} messages`);
    return history;
  } catch (err) {
    logger.warn(`[VoiceService] Failed to fetch conversation history: ${(err as Error).message}`);
    return "";
  }
}

async function askChatWonder(
  transcript: string,
  ctx: VoiceContext,
  weatherInfo: string
): Promise<{ response: ChatWonderParsedResponse; sessionId: string }> {
  const query = buildChatWonderQuery(transcript, ctx, weatherInfo);
  // Catalog is no longer injected into the prompt (saved tokens + keeps our
  // product data on our side). Cosmetic recommendations are matched to real
  // CosmeticProduct rows by attributes after parsing — see resolveSetProducts.
  const [sid, userHistorySelect] = await Promise.all([
    getChatWonderSession(ctx.sessionId),
    buildConversationHistory(ctx.userOutlineId),
  ]);
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

  logger.info(
    `[VoiceService] Using ChatWonder session: ${sid} | history turns: ${userHistorySelect ? userHistorySelect.split("\n").length : 0}`
  );
  let raw = "";
  try {
    await streamChat({
      userInput: query,
      sessionId: sid,
      callbacks: {
        onChunk: (chunk) => {
          raw += chunk;
        },
        onComplete: () => {
          /* stream complete */
        },
        onError: (err) => {
          logger.error(`[VoiceService] ChatWonder stream error: ${err.message}`);
        },
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

function pcmToWav(pcmBuffer: Buffer, sampleRate = 16000, channels = 1, bitDepth = 16): Buffer {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = pcmBuffer.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitDepth, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wav, 44);
  return wav;
}

async function transcribeWithWhisper(pcmBuffer: Buffer, language: string): Promise<string> {
  const t0 = Date.now();
  const wavBuffer = pcmToWav(pcmBuffer);
  const langCode = language.split("-")[0];
  const tmpPath = path.join(os.tmpdir(), `voice-${Date.now()}.wav`);
  fs.writeFileSync(tmpPath, wavBuffer);
  try {
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath) as unknown as File,
      model: "gpt-4o-mini-transcribe",
      language: langCode,
    });
    const text = response.text?.trim();
    logger.info(`[VoiceService] Whisper transcription time: ${Date.now() - t0}ms`);
    if (!text) throw new Error("EMPTY_TRANSCRIPT");
    return text;
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

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
    const t0 = Date.now();
    const cmd = new StartStreamTranscriptionCommand({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      LanguageCode: language as any,
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 16000,
      AudioStream: audioStream(),
    });
    const result = await doTranscribe(cmd);
    logger.info(`[VoiceService] AWS Transcribe streaming time: ${Date.now() - t0}ms`);
    if (!result) throw new Error("EMPTY_TRANSCRIPT");
    return result;
  } catch (err: unknown) {
    if ((err as Error).message === "EMPTY_TRANSCRIPT") {
      logger.warn(`[VoiceService] Transcription resulted in empty transcript`);
    } else {
      logger.error(`[VoiceService] Transcription failed: ${(err as Error).message}`);
    }
    throw err;
  }
}

/**
 * Strips URLs and markdown links from text before TTS so the voice never reads
 * out links. The link *label* is kept (e.g. "[Round Rattan Bag](http://...)"
 * becomes "Round Rattan Bag") so sentences still read naturally. This only
 * affects the spoken copy — the original message returned to the UI is untouched,
 * so on-screen links stay visible/clickable.
 */
function stripLinksForSpeech(text: string): string {
  if (!text) return text;
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // ![alt](url) markdown image -> remove
    .replace(/\[([^\]]+)\]\(\s*(?:https?:\/\/|www\.|\/)[^)]*\)/g, "$1") // [label](url) -> label
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "") // bare URLs -> remove
    .replace(/\(\s*[.-]\s*\)/g, "") // "(.)" / "(-)" artifacts should not be spoken
    .replace(/^\s*[.-]\s+/gm, "") // markdown-ish bullet markers -> spoken sentence
    .replace(/\s+[–—-]\s+/g, ", ") // separator dashes -> natural pause, not "dash"
    .replace(/(?:^|\n)\s*\.\s+/g, "\n") // stray leading dots from model lists
    .replace(/\s+([.,!?;:])/g, "$1") // drop space left before punctuation
    .replace(/\s{2,}/g, " ") // collapse leftover whitespace
    .trim();
}

function applyEmotionSSML(text: string, emotion?: string): string {
  const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  switch (emotion) {
    case "excited":
      return `<speak><prosody rate="fast" pitch="high">${escapedText}</prosody></speak>`;
    case "urgent":
      return `<speak><prosody rate="fast">${escapedText}</prosody></speak>`;
    case "curious":
      return `<speak><prosody pitch="high">${escapedText}</prosody></speak>`;
    case "relaxed":
      return `<speak><prosody rate="slow" pitch="low">${escapedText}</prosody></speak>`;
    case "frustrated":
      return `<speak><prosody rate="slow" volume="loud">${escapedText}</prosody></speak>`;
    case "neutral":
    default:
      return `<speak>${escapedText}</speak>`;
  }
}

async function synthesize(text: string, language: string, emotion?: string): Promise<Buffer> {
  const synthStart = Date.now();
  logger.info(`[VoiceService] Synthesizing speech of length: ${text.length}`);
  logger.debug(`[VoiceService] Speech text: ${text.substring(0, 100)}...`);

  const isFallbackText = text.includes("having trouble connecting");
  if (isFallbackText) {
    try {
      return fs.readFileSync(path.join(__dirname, "../../assets/error-fallback.mp3"));
    } catch (err) {
      logger.error(`[VoiceService] Failed to read local fallback MP3: ${(err as Error).message}`);
    }
  }

  // Remove links so the voice doesn't read URLs aloud. If a chunk was nothing
  // but a link, there is nothing left to speak — return empty audio.
  const cleanText = stripLinksForSpeech(text);
  if (!cleanText) {
    logger.info("[VoiceService] Text was empty after stripping links — skipping synthesis");
    return Buffer.alloc(0);
  }

  // Voice config per language — default to Ruth (generative) for en-US
  const langMap: Record<string, { voiceId: VoiceId; langCode: string }> = {
    "en-GB": { voiceId: VoiceId.Amy, langCode: "en-GB" },
    "en-AU": { voiceId: VoiceId.Olivia, langCode: "en-AU" },
    "en-IN": { voiceId: VoiceId.Kajal, langCode: "en-IN" },
    "en-SG": { voiceId: VoiceId.Jasmine, langCode: "en-SG" },
    "en-NZ": { voiceId: VoiceId.Aria, langCode: "en-NZ" },
    "en-ZA": { voiceId: VoiceId.Ayanda, langCode: "en-ZA" },
    "en-IE": { voiceId: VoiceId.Niamh, langCode: "en-IE" },
    "fr-FR": { voiceId: VoiceId.Lea, langCode: "fr-FR" },
    "fr-CA": { voiceId: VoiceId.Gabrielle, langCode: "fr-CA" },
    "fr-BE": { voiceId: VoiceId.Isabelle, langCode: "fr-BE" },
    "de-DE": { voiceId: VoiceId.Daniel, langCode: "de-DE" },
    "de-AT": { voiceId: VoiceId.Hannah, langCode: "de-AT" },
    "de-CH": { voiceId: VoiceId.Sabrina, langCode: "de-CH" },
    "es-ES": { voiceId: VoiceId.Lucia, langCode: "es-ES" },
    "es-MX": { voiceId: VoiceId.Mia, langCode: "es-MX" },
    "es-US": { voiceId: VoiceId.Lupe, langCode: "es-US" },
    "it-IT": { voiceId: VoiceId.Bianca, langCode: "it-IT" },
    "pt-BR": { voiceId: VoiceId.Camila, langCode: "pt-BR" },
    "pt-PT": { voiceId: VoiceId.Ines, langCode: "pt-PT" },
    "nl-NL": { voiceId: VoiceId.Laura, langCode: "nl-NL" },
    "nl-BE": { voiceId: VoiceId.Lisa, langCode: "nl-BE" },
    "pl-PL": { voiceId: VoiceId.Ola, langCode: "pl-PL" },
    "ru-RU": { voiceId: VoiceId.Tatyana, langCode: "ru-RU" },
    "sv-SE": { voiceId: VoiceId.Elin, langCode: "sv-SE" },
    "da-DK": { voiceId: VoiceId.Sofie, langCode: "da-DK" },
    "nb-NO": { voiceId: VoiceId.Ida, langCode: "nb-NO" },
    "fi-FI": { voiceId: VoiceId.Suvi, langCode: "fi-FI" },
    "cs-CZ": { voiceId: VoiceId.Jitka, langCode: "cs-CZ" },
    "ro-RO": { voiceId: VoiceId.Carmen, langCode: "ro-RO" },
    "tr-TR": { voiceId: VoiceId.Burcu, langCode: "tr-TR" },
    "ca-ES": { voiceId: VoiceId.Arlet, langCode: "ca-ES" },
    "cy-GB": { voiceId: VoiceId.Gwyneth, langCode: "cy-GB" },
    "is-IS": { voiceId: VoiceId.Dora, langCode: "is-IS" },
    "ja-JP": { voiceId: VoiceId.Kazuha, langCode: "ja-JP" },
    "ko-KR": { voiceId: VoiceId.Seoyeon, langCode: "ko-KR" },
    "cmn-CN": { voiceId: VoiceId.Zhiyu, langCode: "cmn-CN" },
    "yue-CN": { voiceId: VoiceId.Hiujin, langCode: "yue-CN" },
    "hi-IN": { voiceId: VoiceId.Kajal, langCode: "hi-IN" },
    arb: { voiceId: VoiceId.Zeina, langCode: "arb" },
    "ar-AE": { voiceId: VoiceId.Hala, langCode: "ar-AE" },
  };
  const { voiceId, langCode } = langMap[language] ?? { voiceId: VoiceId.Ruth, langCode: "en-US" };
  const engine = GENERATIVE_VOICES.has(voiceId) ? Engine.GENERATIVE : Engine.NEURAL;

  const maxChunkLength = 2000;
  const sentences = cleanText.match(/[^.!?]+[.!?]*/g) || [cleanText];
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

  // Simple in-memory LRU cache for TTS chunks (small, per-process)
  const TTS_CACHE_SIZE = 200;
  // store on module-level to persist across calls
  const synthesizeFn = synthesize as { _cache?: Map<string, Buffer> };
  if (!synthesizeFn._cache) synthesizeFn._cache = new Map<string, Buffer>();
  const ttsCache: Map<string, Buffer> = synthesizeFn._cache;

  // Polly concurrency control (bounded parallelism)
  const POLLY_CONCURRENCY = 3;

  try {
    for (let i = 0; i < textChunks.length; i += POLLY_CONCURRENCY) {
      const batch = textChunks.slice(i, i + POLLY_CONCURRENCY);
      const promises = batch.map(async (chunkText) => {
        const useSSML = engine === Engine.NEURAL;
        const effectiveText = useSSML ? applyEmotionSSML(chunkText, emotion) : chunkText;
        const cacheKey = crypto
          .createHash("sha256")
          .update(effectiveText + "|" + voiceId + "|" + langCode + "|" + (emotion || ""))
          .digest("hex");

        const cached = ttsCache.get(cacheKey);
        if (cached) {
          // refresh LRU
          ttsCache.delete(cacheKey);
          ttsCache.set(cacheKey, cached);
          logger.debug(`[VoiceService] TTS cache hit for chunk (len=${chunkText.length})`);
          return cached;
        }

        const cmd = new SynthesizeSpeechCommand({
          Engine: engine,
          LanguageCode: langCode as LanguageCode,
          VoiceId: voiceId,
          OutputFormat: OutputFormat.MP3,
          Text: effectiveText,
          TextType: useSSML ? "ssml" : "text",
        });

        const chunkStart = Date.now();
        const res = await pollyClient.send(cmd);
        const dur = Date.now() - chunkStart;
        logger.info(
          `[VoiceService] Polly chunk synthesized in ${dur}ms (chars=${chunkText.length})`
        );
        if (!res.AudioStream) throw new Error("No audio stream returned");
        const audioArray = await res.AudioStream.transformToByteArray();
        const buff = Buffer.from(audioArray);
        // cache result
        ttsCache.set(cacheKey, buff);
        if (ttsCache.size > TTS_CACHE_SIZE) {
          const firstKey = ttsCache.keys().next().value;
          if (firstKey) {
            ttsCache.delete(firstKey);
          }
        }
        return buff;
      });

      const results = await Promise.all(promises);
      audioBuffers.push(...results);
    }

    const total = Date.now() - synthStart;
    logger.info(`[VoiceService] TTS synthesis total time: ${total}ms, chunks=${textChunks.length}`);
    return Buffer.concat(audioBuffers);
  } catch (err) {
    logger.error(`[VoiceService] AWS Polly failed: ${(err as Error).message}`);
    try {
      return fs.readFileSync(path.join(__dirname, "../../assets/error-fallback.mp3"));
    } catch (err) {
      throw new Error(`TTS synthesis failed, and fallback audio not found`);
    }
  }
}

export const voiceService = {
  transcribeAudio: async (
    pcmBuffer: Buffer,
    language: string = "en-US",
    provider: "aws" | "openai" = "aws"
  ): Promise<string> => {
    const transcript =
      provider === "openai"
        ? await transcribeWithWhisper(pcmBuffer, language)
        : await transcribe(pcmBuffer, language);
    if (!transcript) throw new Error("EMPTY_TRANSCRIPT");
    return transcript;
  },

  tts: async (text: string, language: string = "en-US", emotion?: string): Promise<Buffer> =>
    synthesize(text, language, emotion),

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
