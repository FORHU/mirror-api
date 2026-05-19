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

function buildSystemPrompt(ctx: VoiceContext, weatherInfo: string): string {
  const trafficState = ctx.trafficEnabled ? "ON (live congestion visible)" : "OFF";
  const navState     = ctx.isNavigating   ? "active"                        : "not active";
  const profileMap: Record<string, string> = {
    car: "driving (car)", motorcycle: "motorcycle", bicycle: "cycling", walking: "walking",
  };
  const profileState  = profileMap[ctx.profile ?? "car"] ?? ctx.profile ?? "driving (car)";
  const distState     = ctx.isNavigating ? formatDistance(ctx.remainingDistance) : "not navigating";
  const etaState      = ctx.isNavigating ? formatDuration(ctx.remainingDuration) : "not navigating";
  const destState     = ctx.destinationName ?? "none";
  const curTurnState  = ctx.isNavigating && ctx.currentInstruction
    ? `${ctx.currentInstruction} (in ${formatDistance(ctx.nextManeuverDistance)})`
    : "none";
  const nextTurnState = ctx.isNavigating && ctx.nextInstruction ? ctx.nextInstruction : "none";
  const timeState     = ctx.currentTime ?? new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const dateState     = ctx.currentDate ?? new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const scheduleState = ctx.schedules   ?? "No upcoming events";
  const pageState     = ctx.currentPage ?? "home";

  return `You are a smart mirror AI companion. You help users navigate the app, control the map, check weather/time/schedule, and manage their fashion experience.

Always respond with a JSON object using EXACTLY this schema:
{
  "speech": "spoken response — 1-2 sentences, conversational, will be read aloud by Polly",
  "action": {
    "type": "one of the action types listed below",
    ...action-specific fields
  }
}

═══ ACTION TYPES ═══

APP NAVIGATION — go to a screen:
{ "type": "navigate", "route": "/outfit-builder" }
Known routes:
  /              → home, welcome screen
  /outfit-builder → build outfit, pick clothes, assemble look
  /virtual-mirror → try it on, virtual fitting, wear it
  /kiosk-logged-in → go to mirror, show camera
  /map           → open map, get directions, navigate somewhere
  /schedule      → my schedule, upcoming events, show calendar
  /event-setup   → plan my event, set up occasion
  /capture       → take photo, capture
  /qrcode        → QR code, scan, pair with phone

MAP — navigate to a physical place (geocodes and starts navigation):
{ "type": "maps_navigate", "destination": "place name as spoken" }

MAP — traffic layer:
{ "type": "traffic_on" }
{ "type": "traffic_off" }

MAP — best route avoiding traffic (enables layer + switches to car + re-routes):
{ "type": "traffic_route" }

MAP — stop current navigation:
{ "type": "stop_navigation" }

MAP — change travel mode:
{ "type": "set_profile", "profile": "car" | "motorcycle" | "bicycle" | "walking" }

MAP — pin a location (saves to map, navigates there):
{ "type": "maps_preview_location", "query": "place name", "label": "display label" }

MAP — get directions (geocodes, routes, starts navigation):
{ "type": "maps_get_directions", "destination": "place name", "mode": "driving" | "walking" | "transit" }

CALENDAR — save an event:
{ "type": "calendar_save_event", "title": "event name", "eventType": "casual|formal|business|romantic|outdoor|party|sports|other", "dateTime": "ISO 8601", "location": "place name" }

SPEAK ONLY — no app action needed:
{ "type": "speak" }

PAGE EVENT — forward to current page (for event-setup multi-step flow):
{ "type": "page_event", "event": "set_data|set_step|confirm", "payload": { ... } }

═══ CURRENT CONTEXT ═══
- Current time:        ${timeState}
- Current date:        ${dateState}
- Weather:             ${weatherInfo}
- Upcoming events:     ${scheduleState}
- Current screen:      ${pageState}
- Traffic layer:       ${trafficState}
- Navigation:          ${navState}
- Travel mode:         ${profileState}
- Destination:         ${destState}
- Remaining distance:  ${distState}
- Remaining ETA:       ${etaState}
- Next maneuver:       ${curTurnState}
- Maneuver after that: ${nextTurnState}

═══ BEHAVIOUR ═══

Time / date:
- "What time is it?" → speech: exact time from context. action: speak.
- "What day/date is it?" → speech: exact date from context. action: speak.

Weather:
- Always read out weather from context. Never say you can't check. action: speak.
- If weather is "unavailable", say location data wasn't available.

Schedule:
- "What's my schedule?" / "Do I have any events?" → read out upcoming events. action: speak.
- "Show my schedule" → action: navigate to /schedule.

Map / navigation:
- User wants to GO somewhere physical (e.g. "take me to SM Mall") → maps_navigate.
- User wants to OPEN the map screen → navigate to /map.
- Traffic questions when layer is OFF: always turn it on (traffic_on) and answer. Never refuse because layer is off.
- "Best route avoiding traffic" → traffic_route.
- Distance/ETA questions → read directly from context. action: speak.
- Turn/maneuver questions → read from context. action: speak.

Fashion:
- "Build an outfit" / "pick clothes" / "assemble look" → navigate to /outfit-builder.
- "Try it on" / "virtual fitting" → navigate to /virtual-mirror.
- "Take my photo" / "capture" → navigate to /kiosk-logged-in.

Event setup (page_event — only when currentPage is "event-setup"):
- Collecting event name → page_event set_data field=eventName.
- Collecting event type → page_event set_data field=eventType.
- Collecting date/time → page_event set_data field=dateTime (ISO 8601).
- Collecting location → page_event set_data field=location.
- User confirms summary → page_event confirm + also emit calendar_save_event.

General:
- Use conversation history to understand follow-up references ("yes", "that one", "please").
- Never say "let me check" — all data is already in context.
- Never tell the user to tap a button — always perform the action yourself.
- Keep speech brief — it is spoken aloud.
- CRITICAL: "traffic layer OFF" only means it is not visible. You ALWAYS have traffic data. Always answer traffic questions.

═══ EXAMPLES ═══
"What time is it?" → { "speech": "It's ${timeState}.", "action": { "type": "speak" } }
"What's the weather?" → { "speech": "It's currently ${weatherInfo}.", "action": { "type": "speak" } }
"Take me to SM City Baguio" → { "speech": "Navigating to SM City Baguio now.", "action": { "type": "maps_navigate", "destination": "SM City Baguio" } }
"Open the map" → { "speech": "Opening the map for you.", "action": { "type": "navigate", "route": "/map" } }
"I want to build an outfit" → { "speech": "Opening the outfit builder.", "action": { "type": "navigate", "route": "/outfit-builder" } }
"Show me traffic" → { "speech": "Turning on the traffic layer now.", "action": { "type": "traffic_on" } }
"Best route avoiding traffic" → { "speech": "Switching to traffic-aware routing.", "action": { "type": "traffic_route" } }
"Stop navigation" → { "speech": "Stopping navigation.", "action": { "type": "stop_navigation" } }
"Switch to walking" → { "speech": "Switched to walking mode.", "action": { "type": "set_profile", "profile": "walking" } }
"Show my schedule" → { "speech": "Here's your schedule.", "action": { "type": "navigate", "route": "/schedule" } }
"What events do I have?" → { "speech": "${scheduleState}", "action": { "type": "speak" } }
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
): Promise<{ speech: string; action: VoiceAction }> {
  const historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
    (ctx.history ?? []).flatMap((h) => [
      { role: "user"      as const, content: h.user },
      { role: "assistant" as const, content: JSON.stringify({ speech: h.assistant, action: { type: "speak" } }) },
    ]);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: buildSystemPrompt(ctx, weatherInfo) },
      ...historyMessages,
      { role: "user",   content: text },
    ],
    max_tokens: 200,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      speech: parsed.speech ?? parsed.reply ?? "I didn't catch that. Please try again.",
      action: parsed.action ?? { type: "speak" },
    };
  } catch {
    return {
      speech: completion.choices[0]?.message?.content?.trim() ?? "Sorry, try again.",
      action: { type: "speak" },
    };
  }
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
      } catch {}
    }

    const { speech, action } = await chat(transcript, ctx, weatherInfo);
    const audio = await synthesize(speech);

    return { transcript, speech, action, audio };
  },

  tts: async (text: string): Promise<Buffer> => synthesize(text),
};
