import openai from "./ai-request.util";
import { DESIGN_TYPE, FITTING_SLOT, LAYER_LEVEL } from "@prisma/client";

export interface OutfitEvaluation {
  name: string;
  description: string;
  designType: DESIGN_TYPE;
  tags: string[];
  dominantColor?: string;
}

export interface OutfitComposition {
  name: string;
  description: string;
  items: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[];
  tags: string[];
  designType?: DESIGN_TYPE;
}

export interface OutfitMatch extends OutfitEvaluation {
  items: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[];
  unmatchedDescriptions: string[];
}

/**
 * Compact garment payload for prompts. Keep this small — we may send dozens
 * of wardrobe items per request, and large prompts blow the token budget.
 */
export interface WardrobeGarment {
  id: string;
  name: string;
  description?: string | null;
  garmentType?: string[];
  fittingSlot?: string[];
  category?: string[];
  gender?: string;
  layerLevel?: string;
  silhouette?: string;
  tags?: string[];
  dominantColor?: string;
}

const designTypes = Object.values(DESIGN_TYPE).join(", ");
const fittingSlots = Object.values(FITTING_SLOT).join(", ");
const layerLevels = Object.values(LAYER_LEVEL).join(", ");

const evaluatePrompt = (garments?: WardrobeGarment[]) => {
  const grounding = garments && garments.length
    ? `
The outfit is composed of these specific garments (authoritative — the image
may include extras like background or partial views, but THESE are the items
the caller has tagged as part of the outfit). Ground your name, description,
and tags in this list. Tags should reflect the actual garments' types, colors,
and categories — do not invent items that aren't listed here.

Garments (JSON):
${JSON.stringify(garments)}
`
    : "";

  return `
You are an outfit classifier for a Smart Mirror styling system.
Analyze the assembled outfit in the image and return a STRICT JSON object.
Do not invent enum values; only use the allowed ones.
${grounding}
Allowed values:
- designType (single): ${designTypes}

Return JSON with this exact shape:
{
  "name": "short evocative name (e.g. 'Rainy Day Soft Knit Set')",
  "description": "one or two sentences describing the outfit and its vibe",
  "designType": "${Object.values(DESIGN_TYPE)[0]}",
  "tags": ["free-form descriptors, e.g. 'minimal', 'autumn', 'workwear'"],
  "dominantColor": "hex color like #1a1a1a"
}

Return ONLY the JSON. No markdown, no commentary.
`;
};

const composePrompt = (
  wardrobe: WardrobeGarment[],
  userPrompt: string,
) => `
You are a personal stylist composing an outfit from a user's wardrobe.
Pick 2-6 garments from the wardrobe below that best satisfy the user's request.
You MUST only use garmentIds present in the wardrobe.

User request: "${userPrompt}"

Wardrobe (JSON):
${JSON.stringify(wardrobe)}

Allowed enum values:
- slot: ${fittingSlots}
- layerLevel: ${layerLevels}
- designType: ${designTypes}

Return JSON with this exact shape:
{
  "name": "short evocative outfit name",
  "description": "one or two sentences explaining the choice",
  "items": [
    { "garmentId": "<id from wardrobe>", "slot": "...", "layerLevel": "..." }
  ],
  "tags": ["mood / occasion / season descriptors"],
  "designType": "${Object.values(DESIGN_TYPE)[1] ?? Object.values(DESIGN_TYPE)[0]}"
}

Return ONLY the JSON. No markdown.
`;

const matchPrompt = (wardrobe: WardrobeGarment[]) => `
You are an outfit matcher for a Smart Mirror.
Look at the outfit in the image, then describe each visible garment and try
to match it to one item in the user's wardrobe below. Use the wardrobe item's
exact garmentId. If a visible garment has no good wardrobe match, list its
description under "unmatchedDescriptions" instead.

Wardrobe (JSON):
${JSON.stringify(wardrobe)}

Allowed enum values:
- slot: ${fittingSlots}
- layerLevel: ${layerLevels}
- designType: ${designTypes}

Return JSON with this exact shape:
{
  "name": "short evocative outfit name",
  "description": "one or two sentences",
  "designType": "${Object.values(DESIGN_TYPE)[0]}",
  "tags": ["..."],
  "dominantColor": "hex like #1a1a1a",
  "items": [
    { "garmentId": "<wardrobe id>", "slot": "...", "layerLevel": "..." }
  ],
  "unmatchedDescriptions": ["free-text descriptions of unmatched items"]
}

Return ONLY the JSON. No markdown.
`;

function parseJson<T>(raw: string | undefined | null): T {
  if (!raw) throw { status: 502, message: "OpenAI returned an empty response" };
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as T;
  } catch {
    throw { status: 502, message: "Failed to parse OpenAI JSON response" };
  }
}

function sanitizeDesignType(value: any): DESIGN_TYPE {
  const allowed = Object.values(DESIGN_TYPE) as string[];
  return (allowed.includes(value) ? value : DESIGN_TYPE.UserDesign) as DESIGN_TYPE;
}

function sanitizeItems(
  rawItems: any,
  wardrobeIds: Set<string>,
): { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[] {
  if (!Array.isArray(rawItems)) return [];
  const slotSet = new Set(Object.values(FITTING_SLOT) as string[]);
  const layerSet = new Set(Object.values(LAYER_LEVEL) as string[]);
  const seen = new Set<string>();
  const result: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[] = [];

  for (const item of rawItems) {
    const id = item?.garmentId;
    if (typeof id !== "string" || !wardrobeIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      garmentId: id,
      slot: slotSet.has(item.slot) ? (item.slot as FITTING_SLOT) : undefined,
      layerLevel: layerSet.has(item.layerLevel) ? (item.layerLevel as LAYER_LEVEL) : undefined,
    });
  }
  return result;
}

/**
 * Vision pass over a single outfit image. Returns descriptors only — caller
 * still owns the `items[]` composition. If `garments` is provided, the model
 * grounds its tags/description in that authoritative composition rather than
 * relying purely on what it sees in the image.
 */
export async function evaluateOutfitImage(
  imageUrl: string,
  garments?: WardrobeGarment[],
): Promise<OutfitEvaluation> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a precise outfit classifier. Always respond with valid JSON that strictly matches the requested schema.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: evaluatePrompt(garments) },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  const parsed = parseJson<OutfitEvaluation>(response.choices[0]?.message?.content);
  return {
    ...parsed,
    designType: sanitizeDesignType(parsed.designType),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}

/**
 * Text-only compose: GPT picks garmentIds from the supplied wardrobe.
 */
export async function composeOutfitFromWardrobe(
  wardrobe: WardrobeGarment[],
  userPrompt: string,
): Promise<OutfitComposition> {
  if (!wardrobe.length) {
    throw { status: 400, message: "Wardrobe is empty — add garments before composing" };
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.4,
    max_tokens: 800,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a stylist who only uses garments from the user's wardrobe. Always respond with valid JSON.",
      },
      { role: "user", content: composePrompt(wardrobe, userPrompt) },
    ],
  });

  const parsed = parseJson<OutfitComposition>(response.choices[0]?.message?.content);
  const wardrobeIds = new Set(wardrobe.map((g) => g.id));
  const items = sanitizeItems(parsed.items, wardrobeIds);

  if (!items.length) {
    throw {
      status: 502,
      message: "AI did not return any garments from the wardrobe",
    };
  }

  return {
    ...parsed,
    items,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    designType: sanitizeDesignType(parsed.designType),
  };
}

/**
 * Hybrid: vision pass identifies items in the image and matches them against
 * the user's wardrobe. Unmatched items are returned as free-text descriptions.
 */
export async function matchOutfitToWardrobe(
  imageUrl: string,
  wardrobe: WardrobeGarment[],
): Promise<OutfitMatch> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a careful outfit matcher. Always respond with valid JSON. Never invent garmentIds.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: matchPrompt(wardrobe) },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  const parsed = parseJson<OutfitMatch>(response.choices[0]?.message?.content);
  const wardrobeIds = new Set(wardrobe.map((g) => g.id));

  return {
    ...parsed,
    designType: sanitizeDesignType(parsed.designType),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    items: sanitizeItems(parsed.items, wardrobeIds),
    unmatchedDescriptions: Array.isArray(parsed.unmatchedDescriptions)
      ? parsed.unmatchedDescriptions.filter((s) => typeof s === "string")
      : [],
  };
}
