import { streamChat } from "../../utils/chat-wonder-stream";
import logger from "../../utils/logger";
import { CognitiveResponseSchema } from "../../ai/schemas/chatwonder.schema";
import { repairJson } from "../../utils/json-repair.util";
import type { VoiceContext } from "./voice.service";
import { prisma } from "../../utils/prisma";
import ChatRepository from "../../repositories/chat.repository";

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
  secondaryAction?: CognitiveAction | null;
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
- "maps_suggest_places" → show nearby POI suggestions on the map. payload: "category": "food"|"coffee"|"activities"|"shopping"|"medical"|"transit", "label": short display label string (e.g. "Nearby Restaurants").

POI Suggestion Follow-up Rule:
- EVERY TIME you emit a "maps_show_route" action, you MUST end the "reply" with a natural follow-up question asking if the user wants nearby suggestions. Keep it short and spoken — e.g. "Route set to [destination]. Want me to suggest what's nearby?" or "Heading to [destination] — should I find you some nearby spots?" Vary the phrasing naturally.
- When the user says yes (or "sure", "go ahead", "show me", "yes please"), emit a "maps_suggest_places" action with the most appropriate category based on context. If no category is clear, default to "food".
- When the user says no (or "no thanks", "skip it", "not now"), reply briefly and do nothing (action: null).

Calendar Actions:
- "calendar_save_event" → save an event. payload: "title", "eventType", "dateTime", "location"

User Actions:
- "select_gender" → user selected gender. payload: "gender": "MALE"|"FEMALE"
- "speak" → no action needed, just reply conversationally.
- "none" → uncertain, ask a follow-up question.

Confirmation Rules:
- CRITICAL: Map Route Actions ("maps_show_route", "maps_clear_route", "maps_camera_overview", "maps_camera_free", "maps_suggest_places") NEVER require confirmation. Always set "requiresConfirmation": false for these intents.
- Set "requiresConfirmation": true ONLY when:
  - User is on /ai-recommendation-fashion or /ai-recommendation-cosmetic and tries to navigate away to a different section or map
  - User is on /authentication and tries to restart (navigate to "/")
- Set "requiresConfirmation": false for all other cases.
- When "requiresConfirmation" is true, the "reply" MUST be phrased as a clear yes/no question (e.g., "Are you sure you want to leave fashion and go to the map?"). Never emit requiresConfirmation: true with a statement-form reply — the client holds the action until the user answers, and a statement would strand the user.

Screen Ground-Truth Rule:
- The "- Current screen:" line in the context shows the user's ACTUAL current route and is authoritative. Trust it over conversation history.
- NEVER tell the user they are "already on", "already in", or "already at" a screen unless "- Current screen:" actually matches that route.
- "/select-gender" means the user is on the gender selection screen and has NOT yet reached fashion ("/ai-recommendation-fashion") or cosmetics ("/ai-recommendation-cosmetic"). If they ask to go to fashion/cosmetics from here, navigate them there (subject to the Gender Guard) — do NOT claim they are already there.

Gender Guard:
- The Smart Mirror Context above includes a "- User gender:" line when gender is known. Treat that line as authoritative.
- If "- User gender:" IS present (MALE or FEMALE), gender is KNOWN. Proceed with the user's fashion/cosmetics request normally. DO NOT ask about gender, DO NOT navigate to /select-gender, DO NOT mention gender in the reply.
- If "- User gender:" is ABSENT and the user asks for FASHION or COSMETICS, you MUST set action to "navigate" with route "/select-gender" and tell them to select a gender.
- EXTREMELY IMPORTANT: If the user asks for anything related to MAPS, LOCATIONS, or DIRECTIONS, IGNORE gender entirely (known or not). You MUST immediately issue a map action (use "maps_show_route" to give directions). NEVER ask for their gender when dealing with maps.

<<<<<<< HEAD
Gender Capture Rule:
- When the user STATES or SELECTS their gender — e.g. "male", "I'm male", "I am a man", "I'm a guy", "female", "I'm female", "I am a woman", "I'm a girl" — you MUST emit action "select_gender" with payload.gender set to EXACTLY "MALE" or "FEMALE" (uppercase). Confirm warmly and briefly (e.g. "Got it!").
- After the user provides their gender, NEVER ask for it again in the same reply. Treat the gender as captured.
- This is the expected interaction whenever "- Current screen:" is "/select-gender" — capturing the gender is your primary job on that screen.

Recommendation Guard (Fashion & Cosmetics):
- Before navigating to /ai-recommendation-fashion or /ai-recommendation-cosmetic, you MUST know the user's intended destination, event, or venue (e.g., "the office", "a party", "the park").
=======
Recommendation Guard (Fashion):
- Before navigating to /ai-recommendation-fashion, you MUST know the user's intended destination, event, or venue (e.g., "the office", "a party", "the park").
>>>>>>> 29733870c0ca00933080c3c813e227bacb718134
- If the venue/location is UNKNOWN, DO NOT navigate. Set action to "none", and ask the user where they are going.
- If the venue is known, but the user hasn't specified if they want a single [ garment ] or a full [ outfit ], ask them to clarify before navigating.
- Once the venue AND garment/outfit choice is KNOWN:
  1. Set the action type to "navigate" with route "/ai-recommendation-fashion". You MUST include "suggestion": "garment" or "suggestion": "outfit" in the action payload.
  2. You MUST populate the "events" array with itinerary event objects for EACH destination (if the user discusses a multi-event day) tailored to the venue and weather.

<<<<<<< HEAD
Direct Launch Rule (Main Menu — OVERRIDES the Recommendation Guard):
- "/authentication" is the main menu / launchpad. When "- Current screen:" is "/authentication" and the user asks for FASHION, COSMETICS, or MAPS, you MUST navigate DIRECTLY to that feature and provide recommendations. Do NOT interrogate for a venue first — the venue requirement above does NOT apply when launching from "/authentication".
- GENDER IS A HARD PRECONDITION for Fashion and Cosmetics. If gender is UNKNOWN, you MUST navigate to "/select-gender" first and NEVER to "/ai-recommendation-fashion" or "/ai-recommendation-cosmetic". This applies even on the main menu — "direct launch" does NOT bypass gender.
- ONLY when gender is KNOWN: Fashion → navigate "/ai-recommendation-fashion" (if no garment/outfit preference was stated, default to "suggestion": "outfit"); Cosmetics → navigate "/ai-recommendation-cosmetic".
- Maps/directions → emit "maps_show_route" if a destination is given, otherwise navigate "/map". Maps ignore gender.
- Populate the "events" array with recommendation events based on whatever context is available (weather, time of day), even when the user did not name a specific destination.
=======
Recommendation Guard (Cosmetics):
- /ai-recommendation-cosmetic IS the skin analysis page. It always captures the user's face first, then recommends products based on their skin. There is no separate skin analysis step.
- Whenever the user asks for cosmetic product recommendations, skincare advice, or skin analysis — for ANY reason — navigate IMMEDIATELY to /ai-recommendation-cosmetic. Do NOT ask for a venue, event, or destination first.
- Your "reply" MUST always mention that the skin will be analyzed first (e.g. "I'll scan your skin first and then recommend the best products for you."). Never say just "cosmetic recommendation page" — always reference the skin analysis step.
- If the user ALSO mentions a place or destination (e.g. "and get the location", "I'm going to SM Baguio"), set "action" to navigate to /ai-recommendation-cosmetic AND set "secondaryAction" to "maps_show_route" with the named destination. Both happen at once.
- Never block cosmetic navigation to wait for any additional info. Proceed immediately.
>>>>>>> 29733870c0ca00933080c3c813e227bacb718134

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
    "type": "<action type>",
    "payload": {
      "route": "<optional route>",
      "destination": "<optional destination>",
      "suggestion": "<garment or outfit (for fashion)>",
      "gender": "<optional gender>"
    }
  } | null,
  "secondaryAction": {
    "type": "<secondary action type, e.g. maps_show_route>",
    "payload": { "destination": "<optional destination>" }
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

    // Model sometimes emits slightly-malformed JSON (empty values, trailing
    // commas). Repair and retry before giving up so we don't lose the `action`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = JSON.parse(repairJson(jsonMatch[0]));
      logger.warn("[CognitiveVoiceService] Recovered malformed JSON via repair pass.");
    }

    if (!parsed || typeof parsed !== "object" || !parsed.reply) return fallback;

    // Prefer strict validation, but if it fails, salvage the useful fields
    // (especially `action`) with safe defaults rather than discarding
    // navigation entirely and replying with the canned fallback.
    const validated = CognitiveResponseSchema.safeParse(parsed);
    const data: CognitiveResponse = validated.success
      ? (validated.data as CognitiveResponse)
      : {
          reply: String(parsed.reply),
          intent: parsed.intent ?? { primary: "none", secondary: null, confidence: 0 },
          emotion: parsed.emotion ?? "neutral",
          action: parsed.action ?? null,
          followUpQuestion: parsed.followUpQuestion ?? null,
          requiresConfirmation: Boolean(parsed.requiresConfirmation),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
          memoryUpdates:
            parsed.memoryUpdates && typeof parsed.memoryUpdates === "object"
              ? parsed.memoryUpdates
              : {},
          uiHints:
            parsed.uiHints && typeof parsed.uiHints === "object"
              ? parsed.uiHints
              : { overlay: null, focus: null },
          events: Array.isArray(parsed.events) ? parsed.events : [],
          raw,
        };

    if (!validated.success) {
      logger.warn(
        `[CognitiveVoiceService] Schema mismatch — salvaged fields (action preserved: ${Boolean(
          data.action
        )}): ${validated.error.message}`
      );
    }

    data.raw = raw;
    data.reply = data.reply.replace(/[*_~`#]/g, "").trim();

    return data;
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

    // Fetch conversation history so AI remembers prior turns
    // NOTE: catalog is intentionally NOT injected here — cognitive service only
    // handles navigation intent. Product matching runs after navigation in resolveItineraryCosmetics.
    const userHistorySelect = await (ctx.userOutlineId
      ? prisma.userOutline
          .findUnique({
            where: { id: ctx.userOutlineId },
            select: { conversationId: true },
          })
          .then(async (outline) => {
            if (!outline?.conversationId) return "";
            const messages = await ChatRepository.getHistory(outline.conversationId, 6);
            if (!messages.length) return "";
            const history = messages
              .reverse()
              .map((m) => `${m.role === "USER" ? "User" : "Assistant"}: ${m.message}`)
              .join("\n");
            logger.info(`[CognitiveVoiceService] History injected: ${messages.length} messages`);
            return history;
          })
          .catch((err) => {
            logger.warn(
              `[CognitiveVoiceService] Failed to fetch history: ${(err as Error).message}`
            );
            return "";
          })
      : Promise.resolve(""));
    const documentContext = "";

    logger.info(
      `[CognitiveVoiceService] Using session: ${sid} | history turns: ${userHistorySelect ? userHistorySelect.split("\n").length : 0}`
    );

    let raw = "";
    let activeSid = sid;

    const doStream = async (streamSid: string): Promise<boolean> => {
      raw = "";
      let sessionExpired = false;
      try {
        await streamChat(
          query,
          streamSid,
          "mirror",
          {
            onChunk: (chunk) => {
              raw += chunk;
            },
            onComplete: () => {
              /* stream complete */
            },
            onError: (err) => {
              logger.error(`[CognitiveVoiceService] Stream error: ${err.message}`);
              if (err.message.toLowerCase().includes("unknown session")) {
                sessionExpired = true;
              }
            },
          },
          documentContext,
          userHistorySelect
        );
      } catch (err) {
        const msg = (err as Error).message;
        logger.error(`[CognitiveVoiceService] Stream failed: ${msg}`);
        if (msg.toLowerCase().includes("unknown session")) {
          sessionExpired = true;
        }
      }
      return sessionExpired;
    };

    const sessionExpired = await doStream(activeSid);

    if (sessionExpired) {
      logger.warn("[CognitiveVoiceService] Session expired, fetching new session and retrying...");
      const freshSid = await getSession(undefined, chatWonderApiUrl);
      if (freshSid) {
        activeSid = freshSid;
        await doStream(activeSid);
      } else {
        logger.error("[CognitiveVoiceService] Could not obtain a fresh session for retry");
      }
    }

    logger.debug(`[CognitiveVoiceService] Raw response:\n${raw}`);
    return { response: parseCognitiveResponse(raw), sessionId: activeSid };
  },
};
