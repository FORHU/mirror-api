import logger from "./logger";
import type { WeatherContext } from "./cosmetics.util";

export interface OutfitPlan {
  suggestion: string;
  resolved_products?: string[];
  resolvedProducts?: ResolvedProduct[];
  tags?: string[];
  [key: string]: unknown;
}

export interface ResolvedProduct {
  id: string;
  name?: string;
  brand?: string | null;
  details?: string | null;
  type?: string | null;
  spf?: number | null;
  finish?: string | null;
  hexColor?: string | null;
  imageUrl?: string | null;
  score?: number;
  rank?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface CosmeticPlan {
  suggestion: string;
  resolved_products?: string[];
  resolvedProducts?: ResolvedProduct[];
  reason?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface RoutePlan {
  suggestion: string;
  origin?: string;
  destination?: string;
  origin_lng?: string | number;
  destination_lat?: string | number;
  lat?: number;
  lng?: number;
  placeId?: string;
  address?: string;
  map_error?: string;
  [key: string]: unknown;
}

export interface ChatWonderEvent {
  type: string;
  timeBlock: string;
  context: WeatherContext;
  fashion: OutfitPlan;
  cosmetics: CosmeticPlan;
  map: RoutePlan;
}

export type AIIntent =
  | "FASHION"
  | "COSMETIC"
  | "MAP"
  | "MENU"
  | "RESTART"
  | "NONE"
  | "itinerary_setup"
  | "itinerary_resolved";

export interface ChatWonderParsedResponse {
  intent: AIIntent;
  message: string;
  outfit_suggestion: string | null;
  mood: string | null;
  cosmetics_suggestion: string | null;
  route_suggestion: string | null;
  images: { url: string; caption?: string }[];
  events: ChatWonderEvent[];
  sets?: Record<string, unknown>[];
  raw: string;
  isFallback?: boolean;
}

/**
 * Repair common LLM JSON defects so structured data survives a slip.
 * Handles empty values (`"key":,` / `"key": }`) and trailing commas, which
 * are the failure modes we see from the model (e.g. `"success":,`,
 * `"set_number": ,`).
 */
function repairJson(input: string): string {
  return (
    input
      // "key": ,  /  "key": }  /  "key": ]  -> empty value becomes null
      .replace(/(:\s*)(?=[,}\]])/g, "$1null")
      // trailing comma before a closing brace/bracket
      .replace(/,(\s*[}\]])/g, "$1")
  );
}
1;

/**
 * The trailing metadata blocks ChatWonder appends after the prose. Anything from
 * the first such marker onward is structured data, not user-facing message text.
 */
const DATA_BLOCK_TAIL =
  /\[(?:Sources|GARMENT_DATA|COSMETICS_DATA|MAPS_DATA|NAV_DATA|DONE)\][\s\S]*$/;

/**
 * The per-set markdown breakdown ChatWonder writes after the conversational
 * intro (`## Set 1 — …`, `## Set  — …`). Every field in it is duplicated in the
 * structured GARMENT_DATA block, so it's redundant in the message. Targets the
 * literal word "Set" only — single-outfit responses use other headings
 * (e.g. `### Outfit Composition`) and must be left intact.
 */
const SET_BREAKDOWN_TAIL = /\n*#{1,6}\s*Set\b[\s\S]*$/i;

/**
 * The JSON-bearing markers ChatWonder emits. Each is `[MARKER]` followed by a
 * JSON object (`{…}`) or array (`[…]`). Unlike `[Sources]`/`[DONE]`, these can
 * appear ANYWHERE in the response — nav replies lead with `[NAV_DATA]{…}` before
 * the prose — so they must be removed by position, not just stripped as a tail.
 */
const JSON_BLOCK_MARKER = /\[(?:GARMENT_DATA|COSMETICS_DATA|MAPS_DATA|NAV_DATA|STYLIST)\]/;

/**
 * Given the index of an opening `{` or `[`, return the index of its matching
 * close, accounting for nesting and quoted strings. Returns -1 if unbalanced.
 */
function matchBracket(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Remove every `[MARKER]{…}` / `[MARKER][…]` span wherever it occurs, keeping
 * the prose around it. Robust to blocks that lead, trail, or interleave.
 */
function stripDataBlocks(text: string): string {
  let out = "";
  let rest = text;
  for (;;) {
    const m = rest.match(JSON_BLOCK_MARKER);
    if (!m || m.index === undefined) {
      out += rest;
      break;
    }
    out += rest.slice(0, m.index);
    let j = m.index + m[0].length;
    while (j < rest.length && /\s/.test(rest[j])) j++;
    if (rest[j] === "{" || rest[j] === "[") {
      const close = matchBracket(rest, j);
      if (close !== -1) {
        rest = rest.slice(close + 1);
        continue;
      }
    }
    // Marker without a parseable JSON payload — drop just the marker token.
    rest = rest.slice(j);
  }
  return out;
}

/**
 * Remove ALL bare JSON objects that contain "tool_name" from anywhere in the
 * text. ChatWonder emits tool-call status blobs like:
 *   {"status":"pending_approval","tool_name":"recommend_garments","arguments":{...}}
 * These must never reach the user-facing message regardless of where they appear.
 */
function stripToolCallBlocks(text: string): string {
  let result = "";
  let remaining = text;
  for (;;) {
    const brace = remaining.indexOf("{");
    if (brace === -1) {
      result += remaining;
      break;
    }
    const end = matchBracket(remaining, brace);
    if (end === -1) {
      // Incomplete block (still streaming). If the fragment already looks like a
      // tool-call status block, suppress from here so partial JSON never leaks.
      const fragment = remaining.slice(brace);
      if (/^\{"(status|tool_name)"/.test(fragment) || /"tool_name"\s*:/.test(fragment)) {
        result += remaining.slice(0, brace).trimEnd();
      } else {
        result += remaining;
      }
      break;
    }
    const block = remaining.slice(brace, end + 1);
    if (/"tool_name"\s*:/.test(block)) {
      result += remaining.slice(0, brace).trimEnd();
      remaining = remaining.slice(end + 1).trimStart();
    } else {
      result += remaining.slice(0, end + 1);
      remaining = remaining.slice(end + 1);
    }
  }
  return result;
}

/**
 * Reduce a raw response to the user-facing message: strip the structured data
 * blocks (anywhere they appear), tool-call status blobs, and the redundant
 * per-set breakdown. Does NOT trim, so callers that stream incrementally can
 * track emitted length; trim at the final use site.
 */
export function cutToMessage(text: string): string {
  return stripToolCallBlocks(
    stripDataBlocks(text).replace(DATA_BLOCK_TAIL, "").replace(SET_BREAKDOWN_TAIL, ""),
  );
}

/**
 * Strips raw markdown (like images, links, headers, bold) from text
 * so it is safe and clean for Text-to-Speech and the simple Voice UI overlay.
 */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return text;
  return (
    text
      // Remove markdown images entirely: `![Alt Text](url)`
      .replace(/!\[.*?\]\(.*?\)/g, "")
      // Convert markdown links to just their text: `[Link Text](url)` -> `Link Text`
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      // Remove headers (#, ##, ###) and bold (**) markers
      .replace(/[#*]+/g, "")
      // Collapse multiple spaces/newlines caused by removals
      .replace(/ {2,}/g, " ")
      .trim()
  );
}

/**
 * Clean up the response for display in the UI.
 * Strips out specific blocks so they don't flicker.
 */
export function cleanDisplayPrefix(text: string): string {
  return stripDataBlocks(text).replace(DATA_BLOCK_TAIL, "").replace(SET_BREAKDOWN_TAIL, "");
}

/**
 * Build the structured response from a successfully-parsed object.
 */
function buildFromParsed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed: Record<string, any>,
  rawResponse: string
): ChatWonderParsedResponse {
  // Support both new { data: { outfit, cosmetics, route } } and old flat fields
  const data = parsed.data ?? {};
  const outfitSuggestion =
    data.outfit ?? parsed.outfit_suggestion ?? parsed.outfitSuggestion ?? null;
  const cosmeticsSuggestion =
    data.cosmetics ?? parsed.cosmetics_suggestion ?? parsed.cosmeticsSuggestion ?? null;
  const routeSuggestion = data.route ?? parsed.route_suggestion ?? parsed.routeSuggestion ?? null;

  // Derive strict intent enum
  let intent: AIIntent = "NONE";
  if (parsed.intent) {
    const raw = String(parsed.intent).toLowerCase();
    const upper = raw.toUpperCase();
    // Pass itinerary sub-intents through as lowercase so the client can gate on them.
    if (raw === "itinerary_setup" || raw === "itinerary_resolved") {
      intent = raw as AIIntent;
    } else if (["FASHION", "COSMETIC", "MAP", "MENU", "RESTART", "NONE"].includes(upper)) {
      intent = upper as AIIntent;
    } else if (["poi_recommendation", "general"].includes(raw)) {
      intent = "MAP";
    }
  } else if (outfitSuggestion) {
    intent = "FASHION";
  } else if (cosmeticsSuggestion) {
    intent = "COSMETIC";
  } else if (routeSuggestion) {
    intent = "MAP";
  }

  if (intent === "NONE") {
    if (rawResponse.includes("[GARMENT_DATA]")) {
      intent = "FASHION";
    } else if (rawResponse.includes("[COSMETICS_DATA]")) {
      intent = "COSMETIC";
    } else if (rawResponse.includes("[MAPS_DATA]")) {
      intent = "MAP";
    }
  }

  let finalMessage = parsed.message ? cutToMessage(parsed.message).trim() : "";

  // Join the specialized suggestions into the main message block for the UI
  if (outfitSuggestion && !finalMessage.includes(outfitSuggestion)) {
    finalMessage += `\n\n[ garments ] ${outfitSuggestion}`;
  }
  if (cosmeticsSuggestion && !finalMessage.includes(cosmeticsSuggestion)) {
    finalMessage += `\n\n[ cosmetics ] ${cosmeticsSuggestion}`;
  }
  if (routeSuggestion && !finalMessage.includes(routeSuggestion)) {
    finalMessage += `\n\n[ map ] ${routeSuggestion}`;
  }

  return {
    intent,
    message: finalMessage.trim(),
    outfit_suggestion: outfitSuggestion,
    mood: parsed.mood ?? null,
    cosmetics_suggestion: cosmeticsSuggestion,
    route_suggestion: routeSuggestion,
    images: Array.isArray(parsed.images) ? parsed.images : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    sets: Array.isArray(parsed.sets) ? parsed.sets : [],
    raw: rawResponse,
  };
}

/**
 * Extract and parse a ChatWonder data block into a JSON object.
 *
 * ChatWonder appends structured payloads to the response as marker-prefixed
 * blocks, e.g. `…message text…[GARMENT_DATA]{ "success": true, "sets": […] }[DONE]`.
 * This pulls out the JSON that follows the given marker (bounded by the next
 * marker, if any) and parses it — running the same `repairJson` pass as
 * `parseChatWonderResponse` so malformed model JSON still survives. Returns
 * `null` when the block is absent or no JSON can be recovered.
 */
export function extractChatWonderDataBlock(
  rawResponse: string,
  block: "GARMENT_DATA" | "COSMETICS_DATA" | "MAPS_DATA" | "NAV_DATA" | "GENDER_UPDATE" | "STYLIST" | "TAILOR_DATA"
): Record<string, unknown> | unknown[] | null {
  const marker = `[${block}]`;
  const idx = rawResponse.indexOf(marker);
  if (idx === -1) return null;

  // Take everything after the marker, but stop at the next data/terminator
  // marker so adjacent blocks don't bleed into this one.
  const after = rawResponse.slice(idx + marker.length);
  const stop = after.search(
    /\[(?:GARMENT_DATA|COSMETICS_DATA|MAPS_DATA|NAV_DATA|GENDER_UPDATE|STYLIST|TAILOR_DATA|DONE)\]/
  );
  const segment = stop === -1 ? after : after.slice(0, stop);

  // MAPS_DATA arrives as a top-level JSON array (`[{…}]`); GARMENT/COSMETICS as
  // an object (`{…}`). Match whichever bracket type the payload opens with so
  // the array's outer `[]` isn't lost.
  const trimmedSegment = segment.trim();

  if (block === "GENDER_UPDATE") {
    return { gender: trimmedSegment };
  }

  let unescaped = "";
  if (trimmedSegment.startsWith("{") || trimmedSegment.startsWith("[")) {
    const endIdx = matchBracket(trimmedSegment, 0);
    if (endIdx !== -1) {
      unescaped = trimmedSegment.slice(0, endIdx + 1);
    }
  }

  if (!unescaped) return null;

  try {
    if (unescaped.includes('\\"')) {
      unescaped = unescaped.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return JSON.parse(unescaped);
  } catch {
    try {
      if (unescaped.includes('\\"')) {
        unescaped = unescaped.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      return JSON.parse(repairJson(unescaped));
    } catch {
      return null;
    }
  }
}

/**
 * Parse ChatWonder response (handles both JSON and markdown formats)
 */
export function parseChatWonderResponse(rawResponse: string): ChatWonderParsedResponse {
  try {
    const trimmed = rawResponse.trim();

    // 1. Try to find and parse JSON
    // Strip trailing [GARMENT_DATA] or [COSMETICS_DATA] blocks before greedy regex
    let cleanForJson = trimmed.replace(/\[GARMENT_DATA\][\s\S]*$/, "");
    cleanForJson = cleanForJson.replace(/\[COSMETICS_DATA\][\s\S]*$/, "");
    cleanForJson = cleanForJson.replace(/\[MAPS_DATA\][\s\S]*$/, "");
    cleanForJson = cleanForJson.replace(/\[NAV_DATA\][\s\S]*$/, "");

    const jsonMatch = cleanForJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: Record<string, any> | null = null;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (err) {
        // Model emitted slightly-malformed JSON (empty values, trailing commas).
        // Repair and retry before giving up so we don't lose `sets`/suggestions.
        try {
          parsed = JSON.parse(repairJson(jsonMatch[0]));
          logger.warn(`[Parser] Recovered malformed JSON via repair pass.`);
        } catch (repairErr) {
          logger.warn(
            `[Parser] JSON parse failed (even after repair), falling back to markdown. Raw response was: ${rawResponse}`
          );
          // Last resort: salvage just the "message" field.
          const msgMatch = jsonMatch[0].match(/"message"\s*:\s*"([^"]+)"/);
          if (msgMatch && msgMatch[1]) {
            let intent: AIIntent = "NONE";
            if (rawResponse.includes("[GARMENT_DATA]")) {
              intent = "FASHION";
            } else if (rawResponse.includes("[COSMETICS_DATA]")) {
              intent = "COSMETIC";
            } else if (rawResponse.includes("[MAPS_DATA]")) {
              intent = "MAP";
            }

            return {
              intent,
              message: msgMatch[1].replace(/\\n/g, "\n"),
              outfit_suggestion: null,
              mood: null,
              cosmetics_suggestion: null,
              route_suggestion: null,
              images: [],
              events: [],
              sets: [],
              raw: rawResponse,
            };
          }
        }
      }

      if (parsed && (parsed.message || parsed.sets || parsed.success)) {
        return buildFromParsed(parsed, rawResponse);
      }
    }

    // 2. Fallback to raw text if JSON fails.
    // Cut at the first metadata marker so the structured blocks ChatWonder
    // appends ([GARMENT_DATA]/[COSMETICS_DATA]/[DONE]/[Sources]) never bleed
    // into the user-facing message.
    const fallbackText = cutToMessage(trimmed).trim();

    let intent: AIIntent = "NONE";
    if (trimmed.includes("[GARMENT_DATA]")) {
      intent = "FASHION";
    } else if (trimmed.includes("[COSMETICS_DATA]")) {
      intent = "COSMETIC";
    } else if (trimmed.includes("[MAPS_DATA]")) {
      intent = "MAP";
    }

    return {
      intent,
      message: fallbackText || rawResponse,
      outfit_suggestion: null,
      mood: null,
      cosmetics_suggestion: null,
      route_suggestion: null,
      images: [],
      events: [],
      raw: rawResponse,
    };
  } catch (error) {
    logger.error(
      `[Parser] Failed to parse response: ${(error as Error).message}. Raw: ${rawResponse}`
    );
    return {
      intent: "NONE" as AIIntent,
      message: rawResponse || "I'm here to help you.",
      outfit_suggestion: null,
      mood: null,
      cosmetics_suggestion: null,
      route_suggestion: null,
      images: [],
      events: [],
      raw: rawResponse,
    };
  }
}
