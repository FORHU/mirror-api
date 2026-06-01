import { streamChat } from "../../utils/chat-wonder-stream";
import logger from "../../utils/logger";
import type { VoiceContext } from "./voice.service";

// ─────────────────────────────────────────────────────────────────────────────
// COGNITIVE RESPONSE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CognitiveIntent =
  | "navigate"
  | "maps_show_route"
  | "maps_clear_route"
  | "maps_camera_overview"
  | "maps_camera_free"
  | "traffic_on"
  | "traffic_off"
  | "set_profile"
  | "calendar_save_event"
  | "select_gender"
  | "speak"
  | "none";

export type CognitiveEmotion =
  | "neutral"
  | "excited"
  | "urgent"
  | "curious"
  | "relaxed"
  | "frustrated";

export interface CognitiveActionPayload {
  route?: string;
  destination?: string;
  mode?: string;
  profile?: string;
  query?: string;
  label?: string;
  gender?: string;
  suggestion?: string;
  title?: string;
  eventType?: string;
  dateTime?: string;
  location?: string;
  [key: string]: unknown;
}

export interface CognitiveAction {
  type: CognitiveIntent;
  payload: CognitiveActionPayload;
}

export interface CognitiveIntentBlock {
  primary: string;
  secondary: string | null;
  confidence: number;
}

export interface CognitiveUIHints {
  overlay: string | null;
  focus: string | null;
}

export interface CognitiveResponse {
  reply: string;
  intent: CognitiveIntentBlock;
  emotion: CognitiveEmotion;
  action: CognitiveAction | null;
  followUpQuestion: string | null;
  requiresConfirmation: boolean;
  suggestions: string[];
  memoryUpdates: Record<string, unknown>;
  uiHints: CognitiveUIHints;
  events?: unknown[];
  raw: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT LAYERS
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_BEHAVIOR = `You are the cognitive orchestration engine of an advanced multimodal AI assistant embedded inside a Smart Mirror.

Your role is NOT just to chat.
Your role is to:
- Understand intent
- Reason about context
- Maintain conversational continuity
- Manage UI/navigation state
- Guide the user naturally
- Decide when confirmation is required
- Avoid interrupting ongoing flows
- Behave like a proactive real-world assistant

Rules:
- Respond in a natural, confident, conversational tone.
- Keep "reply" extremely concise (max 2-3 sentences).
- Do not use markdown, bullet points, or long explanations in "reply".
- Always be direct and helpful.
- Never hallucinate unavailable tools.
- Never force navigation unnecessarily.
- Prefer maintaining conversational continuity.
- Be adaptive to ambiguity.`;

const INTENT_RULES = `Intent and Action decision rules:

Navigation Actions (use when user wants to go somewhere in the app):
- "navigate" → app screen navigation. payload must include "route": one of "/", "/select-gender", "/authentication", "/ai-recommendation-fashion", "/ai-recommendation-cosmetic", "/map", "/overview", "/virtual-mirror"

Map Route Actions:
- "maps_show_route" → show route to a destination. payload: "destination": place name string.
- "maps_clear_route" → clear the current route and return to explore view. payload: {}.
- "maps_camera_overview" → fit the full route into view ("zoom out", "show full route"). payload: {}.
- "maps_camera_free" → zoom into the destination area ("zoom in", "focus on destination"). payload: {}.
- "traffic_on" → enable traffic overlay
- "traffic_off" → disable traffic overlay
- "set_profile" → change travel mode. payload: "profile": "car"|"motorcycle"|"bicycle"|"walking"

Calendar Actions:
- "calendar_save_event" → save an event. payload: "title", "eventType", "dateTime", "location"

User Actions:
- "select_gender" → user selected gender. payload: "gender": "MALE"|"FEMALE"
- "speak" → no action needed, just reply conversationally.
- "none" → uncertain, ask a follow-up question.

Confirmation Rules:
- Set "requiresConfirmation": true when:
  - User is on /ai-recommendation-fashion or /ai-recommendation-cosmetic and tries to navigate away to a different section or map
  - User is on /authentication and tries to restart (navigate to "/")
  - Any action that would disrupt an active focused flow
- Set "requiresConfirmation": false for all other cases.
- When "requiresConfirmation" is true, the "reply" MUST be phrased as a clear yes/no question (e.g., "Are you sure you want to leave fashion and go to the map?"). Never emit requiresConfirmation: true with a statement-form reply — the client holds the action until the user answers, and a statement would strand the user.

Gender Guard:
- The Smart Mirror Context above includes a "- User gender:" line when gender is known. Treat that line as authoritative.
- If "- User gender:" IS present (MALE or FEMALE), gender is KNOWN. Proceed with the user's fashion/cosmetics request normally. DO NOT ask about gender, DO NOT navigate to /select-gender, DO NOT mention gender in the reply.
- If "- User gender:" is ABSENT and the user asks for FASHION or COSMETICS, you MUST set action to "navigate" with route "/select-gender" and tell them to select a gender.
- EXTREMELY IMPORTANT: If the user asks for anything related to MAPS, LOCATIONS, or DIRECTIONS, IGNORE gender entirely (known or not). You MUST immediately issue a map action (like "navigate" to "/map", or "maps_navigate"). NEVER ask for their gender when dealing with maps.

Recommendation Guard (Fashion & Cosmetics):
- Before navigating to /ai-recommendation-fashion or /ai-recommendation-cosmetic, you MUST know the user's intended destination, event, or venue (e.g., "the office", "a party", "the park").
- If the venue/location is UNKNOWN, DO NOT navigate. Set action to "none", and ask the user where they are going.
- For Fashion: If the venue is known, but the user hasn't specified if they want a single [ garment ] or a full [ outfit ], ask them to clarify before navigating.
- Once the venue (and garment/outfit choice for fashion) is KNOWN:
  1. Set the action type to "navigate" with the respective route.
  2. You MUST populate the "events" array with an itinerary event object tailored to their destination and the weather.

If the context contains mode: "confirm_context_required", the user gave an ambiguous reply (e.g., "maybe") to a confirmation prompt. Ask them to clarify with a friendly follow-up question. Set action to null.`;

const OUTPUT_CONTRACT = `OUTPUT CONTRACT — You MUST follow this exactly.

Respond ONLY with valid JSON matching this schema:
{
  "reply": "<spoken reply, max 2-3 sentences, no markdown>",
  "intent": {
    "primary": "<intent name>",
    "secondary": "<secondary intent or null>",
    "confidence": <0.0 to 1.0>
  },
  "emotion": "neutral" | "excited" | "urgent" | "curious" | "relaxed" | "frustrated",
  "action": {
    "type": "<action type from the list above>",
    "payload": { <action-specific fields> }
  } | null,
  "followUpQuestion": "<optional clarifying question or null>",
  "requiresConfirmation": false | true,
  "suggestions": ["<optional suggestion chip text>"],
  "memoryUpdates": {},
  "uiHints": {
    "overlay": null,
    "focus": null
  },
  "events": [
    {
      "type": "<event type e.g. casual outing, formal dinner>",
      "timeBlock": "<morning|afternoon|evening|night>",
      "fashion": { "suggestion": "<fashion advice based on weather/venue>" },
      "cosmetics": { "suggestion": "<cosmetics advice>" },
      "route": { "destination": "<venue/location name>" }
    }
  ]
}

Strict rules:
- Output must be valid JSON only. No extra text before or after.
- Do not wrap in markdown code blocks or backticks.
- "action" must be null if the intent is just conversational (speak/none).
- "requiresConfirmation" must always be present (true or false).
- "events" is optional, only include if generating fashion/cosmetic itinerary events. It can be an empty array [].
- If you fail to follow this JSON format, your response is invalid.`;

// ─────────────────────────────────────────────────────────────────────────────
// QUERY BUILDER
// ─────────────────────────────────────────────────────────────────────────────

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

function buildCognitiveQuery(transcript: string, ctx: VoiceContext, weatherInfo: string): string {
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

  const contextParts = [
    `Smart Mirror Context:`,
    ctx.gender
      ? `- User gender: ${ctx.gender}  (KNOWN — do not ask again, proceed normally)`
      : `- User gender: UNKNOWN  (fashion/cosmetics requests must navigate to /select-gender)`,
    `- Date: ${date}`,
    `- Time: ${time}`,
    ctx.locationName ? `- Location: ${ctx.locationName}` : null,
    `- Weather: ${weatherInfo}`,
    ctx.currentPage ? `- Current screen: ${ctx.currentPage}` : null,
    ctx.schedules ? `- Schedule: ${ctx.schedules}` : null,
    ctx.mode ? `- Mode flag: ${ctx.mode}` : null,
    ctx.isRouteActive
      ? `- Route: active | destination: ${ctx.destinationName ?? "unknown"} | distance: ${formatDistance(ctx.routeDistance)} | ETA: ${formatDuration(ctx.routeDuration)} | profile: ${ctx.profile ?? "unknown"}`
      : null,
    ctx.eventPlan && ctx.eventPlan.length > 0
      ? `- Planned Events: ${JSON.stringify(ctx.eventPlan)}`
      : null,
    ctx.staffClarification?.trim() ? `- Staff note: ${ctx.staffClarification.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [SYSTEM_BEHAVIOR, INTENT_RULES, OUTPUT_CONTRACT, contextParts, `\nUser: ${transcript}`]
    .filter(Boolean)
    .join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseCognitiveResponse(raw: string): CognitiveResponse {
  const fallback: CognitiveResponse = {
    reply: "I'm here to help.",
    intent: { primary: "none", secondary: null, confidence: 0 },
    emotion: "neutral",
    action: null,
    followUpQuestion: null,
    requiresConfirmation: false,
    suggestions: [],
    memoryUpdates: {},
    uiHints: { overlay: null, focus: null },
    events: [],
    raw,
  };

  try {
    const trimmed = raw.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.reply) return fallback;

    return {
      reply: String(parsed.reply)
        .replace(/[*_~`#]/g, "")
        .trim(),
      intent: {
        primary: parsed.intent?.primary ?? "none",
        secondary: parsed.intent?.secondary ?? null,
        confidence: Number(parsed.intent?.confidence ?? 0),
      },
      emotion: parsed.emotion ?? "neutral",
      action: parsed.action ?? null,
      followUpQuestion: parsed.followUpQuestion ?? null,
      requiresConfirmation: Boolean(parsed.requiresConfirmation),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      memoryUpdates: parsed.memoryUpdates ?? {},
      uiHints: {
        overlay: parsed.uiHints?.overlay ?? null,
        focus: parsed.uiHints?.focus ?? null,
      },
      events: Array.isArray(parsed.events) ? parsed.events : [],
      raw,
    };
  } catch (err) {
    logger.warn(
      `[CognitiveVoiceService] Failed to parse cognitive response: ${(err as Error).message}`
    );
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function getSession(sessionId?: string, chatWonderApiUrl?: string): Promise<string> {
  if (sessionId) return sessionId;
  if (!chatWonderApiUrl) return "";
  try {
    const { default: axios } = await import("axios");
    const res = await axios.get(`${chatWonderApiUrl}/session-id`);
    return res.data?.session_id || "";
  } catch (err) {
    logger.error(`[CognitiveVoiceService] Failed to get session: ${(err as Error).message}`);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export const cognitiveVoiceService = {
  /**
   * Send a voice transcript and context to the ChatWonder AI using the
   * cognitive orchestration system prompt. Returns a structured CognitiveResponse.
   *
   * Still uses streamChat under the hood — same transport, new prompt + parser.
   */
  ask: async (
    transcript: string,
    ctx: VoiceContext,
    chatWonderApiUrl: string
  ): Promise<{ response: CognitiveResponse; sessionId: string }> => {
    const weatherInfo = ((ctx as Record<string, unknown>)._weatherInfo as string) ?? "unavailable";
    const query = buildCognitiveQuery(transcript, ctx, weatherInfo);
    const sid = await getSession(ctx.sessionId, chatWonderApiUrl);

    if (!sid) {
      logger.error("[CognitiveVoiceService] No session ID — cannot stream");
      return {
        response: {
          ...{
            reply: "I'm having trouble connecting right now. Please try again.",
            intent: { primary: "none", secondary: null, confidence: 0 },
            emotion: "neutral" as CognitiveEmotion,
            action: null,
            followUpQuestion: null,
            requiresConfirmation: false,
            suggestions: [],
            memoryUpdates: {},
            uiHints: { overlay: null, focus: null },
            events: [],
            raw: "",
          },
        },
        sessionId: "",
      };
    }

    logger.debug(`[CognitiveVoiceService] Query:\n${query}`);

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
          logger.error(`[CognitiveVoiceService] Stream error: ${err.message}`);
        },
      });
    } catch (err) {
      logger.error(`[CognitiveVoiceService] Stream failed: ${(err as Error).message}`);
    }

    logger.debug(`[CognitiveVoiceService] Raw response:\n${raw}`);
    return { response: parseCognitiveResponse(raw), sessionId: sid };
  },
};
