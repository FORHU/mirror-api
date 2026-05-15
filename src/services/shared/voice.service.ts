import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  OutputFormat,
  VoiceId,
  TextType,
} from "@aws-sdk/client-polly";
import OpenAI, { toFile } from "openai";
import { Readable } from "stream";
import {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  OPENAI_API_KEY,
} from "../../config";
import { weatherService } from "./weather.service";

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
  remainingDistance?: number; // metres
  remainingDuration?: number; // seconds
  destinationName?: string;
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

function buildSystemPrompt(ctx: VoiceContext, weatherInfo: string): string {
  const trafficState = ctx.trafficEnabled ? "ON (live congestion visible)" : "OFF";
  const navState     = ctx.isNavigating   ? "active"                        : "not active";
  const profileMap: Record<string, string> = {
    car: "driving (car)", motorcycle: "motorcycle", bicycle: "cycling", walking: "walking",
  };
  const profileState = profileMap[ctx.profile ?? "car"] ?? ctx.profile ?? "driving (car)";
  const distState    = ctx.isNavigating ? formatDistance(ctx.remainingDistance) : "not navigating";
  const etaState     = ctx.isNavigating ? formatDuration(ctx.remainingDuration) : "not navigating";
  const destState    = ctx.destinationName || "none";

  return `You are a voice companion for a map navigation app.
Always respond with a JSON object using this exact schema:
{
  "reply": "spoken response (1-2 sentences, conversational, will be read aloud)",
  "intent": one of: "navigate" | "traffic_on" | "traffic_off" | "traffic_route" | "stop_navigation" | "set_profile" | "other",
  "destination": "place name (only when intent is navigate)",
  "profile": "car" | "motorcycle" | "bicycle" | "walking" (only when intent is set_profile)
}

Current map state:
- Weather: ${weatherInfo}
- Traffic layer visibility: ${trafficState}
- Navigation: ${navState}
- Travel mode: ${profileState}
- Destination: ${destState}
- Remaining distance: ${distState}
- Remaining ETA: ${etaState}

CRITICAL — what "off" means:
- "Traffic layer: OFF" means it is not shown visually on the map. It does NOT mean traffic data is unavailable.
  You ALWAYS have access to traffic information. When asked about traffic conditions, ALWAYS turn the layer on (intent "traffic_on" or "traffic_route") and answer the question. Never say you can't check traffic because the layer is off.
- Weather data is always available from the context above regardless of any UI state. Always read it out when asked.
- Any feature being toggled off only affects the visual display — it never blocks your ability to answer or act.

App capabilities you must know:
- Car routing uses real-time Mapbox traffic data (driving-traffic profile) — the route already avoids the worst congestion automatically.
- Turning on the traffic layer lets the user see live congestion colour-coded on the map (red = heavy, orange = moderate, green = clear).
- Non-car profiles (walking, cycling, motorcycle) do not use live traffic data.
- You can switch travel modes and re-route instantly.

Intent rules:
- "navigate"         → user wants directions or to go somewhere; extract destination name
- "traffic_on"       → user asks to see traffic / asks about traffic conditions when layer is off; turn it on and answer
- "traffic_off"      → user asks to hide/disable the traffic layer
- "traffic_route"    → user wants the best/fastest route avoiding traffic (show traffic layer + switch to car + re-route)
- "stop_navigation"  → user wants to stop/cancel current navigation
- "set_profile"      → user wants to change travel mode; set "profile" field
- "other"            → everything else

Behaviour rules:
- Always use prior conversation turns (provided as messages) to understand "yes", "please", "that one", etc.
- For weather questions: always read out the exact weather from context. Never say you can't check.
- For any traffic question (conditions, congestion, "how's traffic"): ALWAYS turn on the traffic layer and describe what you know. Never refuse because the layer is off.
- For distance/ETA questions ("how far", "how long", "when will I arrive"): read out the exact remaining distance and ETA from context above. Never say "let me check" — the data is already in context.
- For "best route to avoid traffic": use intent "traffic_route".
- For travel mode changes: use intent "set_profile".
- Always perform the action yourself. Never tell the user to tap a button or enable something manually.
- Never say "let me check" or "I'll look that up" — all the data you need is already in context. Answer directly.
- Keep "reply" brief — it is spoken aloud.

Examples:
User: "What's the weather?" → { "reply": "It's currently ${weatherInfo}.", "intent": "other" }
User: "How's traffic today?" (layer off) → { "reply": "Turning on the traffic layer so you can see congestion on the map. Your car route is already using live traffic data to find the fastest path.", "intent": "traffic_on" }
User: "What's the condition of traffic?" (layer off) → { "reply": "I'm turning on the traffic layer now so you can see it. Car routing is already optimised around live congestion.", "intent": "traffic_on" }
User: "Show me traffic" → { "reply": "Turning on the traffic layer now.", "intent": "traffic_on" }
User: "What's the best route to avoid traffic?" → { "reply": "Switching to traffic-aware routing and showing you congestion on the map.", "intent": "traffic_route" }
User: "Give me a route that avoids traffic" → { "reply": "I've turned on the traffic layer and re-routed you using live traffic data to find the fastest path.", "intent": "traffic_route" }
User: "Take me to SM City Baguio" → { "reply": "Navigating to SM City Baguio now.", "intent": "navigate", "destination": "SM City Baguio" }
User: "Navigate via walking" → { "reply": "Switching to walking mode and re-routing.", "intent": "set_profile", "profile": "walking" }
User: "Change to cycling" → { "reply": "Switched to cycling mode.", "intent": "set_profile", "profile": "bicycle" }
User: "Stop navigation" → { "reply": "Stopping navigation.", "intent": "stop_navigation" }
`;
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

async function chat(
  text: string,
  ctx: VoiceContext,
  weatherInfo: string,
): Promise<{ reply: string; intent: string; destination?: string; profile?: string }> {
  const historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
    (ctx.history ?? []).flatMap((h) => [
      { role: "user"      as const, content: h.user },
      { role: "assistant" as const, content: JSON.stringify({ reply: h.assistant, intent: "other" }) },
    ]);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: buildSystemPrompt(ctx, weatherInfo) },
      ...historyMessages,
      { role: "user",   content: text },
    ],
    max_tokens: 150,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      reply:       parsed.reply       ?? "I didn't catch that. Please try again.",
      intent:      parsed.intent      ?? "other",
      destination: parsed.destination ?? undefined,
      profile:     parsed.profile     ?? undefined,
    };
  } catch {
    return { reply: completion.choices[0]?.message?.content?.trim() ?? "Sorry, try again.", intent: "other" };
  }
}

async function synthesize(text: string): Promise<Buffer> {
  const command = new SynthesizeSpeechCommand({
    Engine:      Engine.NEURAL,
    OutputFormat: OutputFormat.MP3,
    Text:        text,
    TextType:    TextType.TEXT,
    VoiceId:     VoiceId.Joanna,
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
  ): Promise<{ transcript: string; reply: string; intent: string; destination?: string; profile?: string; audio: Buffer }> => {
    const transcript = await transcribe(pcmBuffer);
    if (!transcript) throw new Error("EMPTY_TRANSCRIPT");

    let weatherInfo = "unavailable";
    if (ctx.lat !== undefined && ctx.lng !== undefined && !isNaN(ctx.lat) && !isNaN(ctx.lng)) {
      try {
        const w = await weatherService.getWeather(ctx.lat, ctx.lng);
        weatherInfo = `${Math.round(w.temperature)}°C, ${w.condition}, wind ${Math.round(w.windspeed)} km/h, humidity ${w.humidity}%`;
      } catch {
        // non-fatal
      }
    }

    const { reply, intent, destination, profile } = await chat(transcript, ctx, weatherInfo);
    const audio = await synthesize(reply);

    return { transcript, reply, intent, destination, profile, audio };
  },
};
