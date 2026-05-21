import openai from "./ai-request.util";
import { DESIGN_TYPE, FITTING_SLOT, LAYER_LEVEL } from "@prisma/client";

export type GenerableField = "name" | "description" | "designType" | "tags" | "dominantColor";

export const GENERABLE_FIELDS: GenerableField[] = [
  "name",
  "description",
  "designType",
  "tags",
  "dominantColor",
];

export interface OutfitEvaluation {
  name?: string;
  description?: string;
  designType?: DESIGN_TYPE;
  tags?: string[];
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

const FIELD_SCHEMA: Record<GenerableField, string> = {
  name: `"name": "short evocative name (e.g. 'Rainy Day Soft Knit Set')"`,
  description: `"description": "one or two sentences describing the outfit and its vibe"`,
  designType: `"designType": "one of: ${designTypes}"`,
  tags: `"tags": ["free-form descriptors, e.g. 'minimal', 'autumn', 'workwear'"]`,
  dominantColor: `"dominantColor": "hex color like #1a1a1a"`,
};

function buildSchemaBlock(extra: string[], generate: Set<GenerableField>): string {
  const lines = GENERABLE_FIELDS.filter((f) => generate.has(f)).map((f) => `  ${FIELD_SCHEMA[f]}`);
  const all = [...lines, ...extra.map((l) => `  ${l}`)];
  if (!all.length) return `{}`;
  return `{\n${all.join(",\n")}\n}`;
}

const noHallucinationRules = `
HARD RULES:
- Do NOT invent or imagine garments that aren't actually present.
- Do NOT alter, restyle, or re-describe the garments' designs, colors, materials, or silhouettes.
- Do NOT add fields that are not in the schema below — return ONLY the schema fields.
- If a requested field has no confident answer from the image / context, omit it or set it to null. Do not guess.
`.trim();

function evaluatePrompt(
  garments: WardrobeGarment[] | undefined,
  userPrompt: string | undefined,
  generate: Set<GenerableField>
): string {
  const grounding =
    garments && garments.length
      ? `
The outfit is composed of these specific garments (authoritative — the image
may include extras like background or partial views, but THESE are the items
the caller has tagged as part of the outfit). Do not invent items beyond this
list and do not modify how these garments are described.

Garments (JSON):
${JSON.stringify(garments)}
`
      : "";

  const hint =
    userPrompt && userPrompt.trim()
      ? `
User-provided context for this outfit (use it only to bias the requested
fields below; never override the garments or invent items from it):
"${userPrompt.trim()}"
`
      : "";

  const schema = buildSchemaBlock([], generate);

  return `
You are an outfit classifier for a Smart Mirror styling system.
Analyze the assembled outfit in the image and return a STRICT JSON object
containing ONLY the fields listed in the schema below. Any field not in the
schema must be omitted entirely.
${grounding}${hint}
${noHallucinationRules}

Allowed enum values:
- designType: ${designTypes}

Return JSON with this exact shape:
${schema}

Return ONLY the JSON. No markdown, no commentary.
`.trim();
}

const composePrompt = (wardrobe: WardrobeGarment[], userPrompt: string) => `
You are a personal stylist composing an outfit from a user's wardrobe.
Pick 2-6 garments from the wardrobe below that best satisfy the user's request.
You MUST only use garmentIds present in the wardrobe. Do not invent garments,
and do not alter how the wardrobe items are described.

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

function matchPrompt(
  wardrobe: WardrobeGarment[],
  userPrompt: string | undefined,
  generate: Set<GenerableField>
): string {
  const hint =
    userPrompt && userPrompt.trim()
      ? `\nUser-provided context (bias the requested fields below; never invent garments from it):\n"${userPrompt.trim()}"\n`
      : "";

  const extra = [
    `"items": [ { "garmentId": "<wardrobe id>", "slot": "...", "layerLevel": "..." } ]`,
    `"unmatchedDescriptions": ["factual descriptions of unmatched items only"]`,
  ];
  const schema = buildSchemaBlock(extra, generate);

  return `
You are an outfit matcher for a Smart Mirror.
Look at the outfit in the image, then match each visible garment to one item
in the user's wardrobe below. Use the wardrobe item's EXACT garmentId.

If a visible garment has no good wardrobe match, list a factual description
under "unmatchedDescriptions". Never invent garmentIds, and never bend the
wardrobe item's design to make it fit — when in doubt, mark unmatched.
${hint}
Wardrobe (JSON):
${JSON.stringify(wardrobe)}

Allowed enum values:
- slot: ${fittingSlots}
- layerLevel: ${layerLevels}
- designType: ${designTypes}

${noHallucinationRules}

Return JSON with this exact shape (fields not listed in the schema must be omitted):
${schema}

Return ONLY the JSON. No markdown.
`.trim();
}

function parseJson<T>(raw: string | undefined | null): T {
  if (!raw) throw { status: 502, message: "OpenAI returned an empty response" };
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as T;
  } catch {
    throw { status: 502, message: "Failed to parse OpenAI JSON response" };
  }
}

function sanitizeDesignType(value: unknown): DESIGN_TYPE | undefined {
  if (value == null) return undefined;
  const allowed = Object.values(DESIGN_TYPE) as string[];
  return allowed.includes(value as string) ? (value as DESIGN_TYPE) : undefined;
}

function sanitizeItems(
  rawItems: unknown,
  wardrobeIds: Set<string>
): { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[] {
  if (!Array.isArray(rawItems)) return [];
  const slotSet = new Set(Object.values(FITTING_SLOT) as string[]);
  const layerSet = new Set(Object.values(LAYER_LEVEL) as string[]);
  const seen = new Set<string>();
  const result: { garmentId: string; slot?: FITTING_SLOT; layerLevel?: LAYER_LEVEL }[] = [];

  for (const raw of rawItems as unknown[]) {
    const item = raw as Record<string, unknown>;
    const id = item?.garmentId;
    if (typeof id !== "string" || !wardrobeIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      garmentId: id as string,
      slot: slotSet.has(item.slot as string) ? (item.slot as FITTING_SLOT) : undefined,
      layerLevel: layerSet.has(item.layerLevel as string)
        ? (item.layerLevel as LAYER_LEVEL)
        : undefined,
    });
  }
  return result;
}

function normalizeGenerate(input?: GenerableField[] | null): Set<GenerableField> {
  if (!Array.isArray(input)) return new Set();
  const allowed = new Set<GenerableField>(GENERABLE_FIELDS);
  return new Set(input.filter((f): f is GenerableField => allowed.has(f as GenerableField)));
}

/**
 * Merges caller-provided values with AI output. Caller wins. Fields that
 * are neither caller-provided nor in `generate` are dropped entirely so the
 * persist layer can tell "leave empty" apart from "AI failed".
 */
function mergeEvaluation(
  ai: Record<string, unknown> | null,
  provided: Partial<OutfitEvaluation> | undefined,
  generate: Set<GenerableField>
): OutfitEvaluation {
  const out: OutfitEvaluation = {};
  const take = <K extends GenerableField>(field: K, aiValue: OutfitEvaluation[K]) => {
    const callerValue = provided?.[field];
    if (callerValue !== undefined && callerValue !== null && callerValue !== "") {
      out[field] = callerValue;
    } else if (generate.has(field) && aiValue !== undefined && aiValue !== null) {
      out[field] = aiValue;
    }
  };

  take("name", typeof ai?.name === "string" ? ai.name : undefined);
  take("description", typeof ai?.description === "string" ? ai.description : undefined);
  take("designType", sanitizeDesignType(ai?.designType));
  take(
    "tags",
    Array.isArray(ai?.tags) ? ai.tags.filter((t: unknown) => typeof t === "string") : undefined
  );
  take("dominantColor", typeof ai?.dominantColor === "string" ? ai.dominantColor : undefined);
  return out;
}

export interface EvaluateOutfitOptions {
  imageUrl: string;
  garments?: WardrobeGarment[];
  userPrompt?: string;
  provided?: Partial<OutfitEvaluation>;
  generate?: GenerableField[];
}

/**
 * Vision pass over a single outfit image. The caller controls which fields
 * the AI may fill via `generate`; any field present in `provided` overrides
 * the AI entirely. Fields that are neither requested nor provided are
 * omitted from the result — the persist layer must NOT fall back to a
 * generated default.
 */
export async function evaluateOutfitImage(opts: EvaluateOutfitOptions): Promise<OutfitEvaluation> {
  const generate = normalizeGenerate(opts.generate);

  if (generate.size === 0) {
    return mergeEvaluation(null, opts.provided, generate);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a precise outfit classifier. Always respond with valid JSON that strictly matches the requested schema. Never invent or alter garments.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: evaluatePrompt(opts.garments, opts.userPrompt, generate) },
          { type: "image_url", image_url: { url: opts.imageUrl } },
        ],
      },
    ],
  });

  const parsed = parseJson<Record<string, unknown>>(response.choices[0]?.message?.content);
  return mergeEvaluation(parsed, opts.provided, generate);
}

export async function composeOutfitFromWardrobe(
  wardrobe: WardrobeGarment[],
  userPrompt: string
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

export interface MatchOutfitOptions {
  imageUrl: string;
  wardrobe: WardrobeGarment[];
  userPrompt?: string;
  provided?: Partial<OutfitEvaluation>;
  generate?: GenerableField[];
}

/**
 * Hybrid: vision identifies items in the image and matches them against
 * the user's wardrobe. Items are always matched (that's the point of this
 * endpoint), but the descriptive fields (name/description/tags/etc.) follow
 * the same `generate` + `provided` rules as evaluateOutfitImage.
 */
export async function matchOutfitToWardrobe(opts: MatchOutfitOptions): Promise<OutfitMatch> {
  const generate = normalizeGenerate(opts.generate);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a careful outfit matcher. Always respond with valid JSON. Never invent garmentIds and never alter wardrobe items' designs.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: matchPrompt(opts.wardrobe, opts.userPrompt, generate) },
          { type: "image_url", image_url: { url: opts.imageUrl } },
        ],
      },
    ],
  });

  const parsed = parseJson<Record<string, unknown>>(response.choices[0]?.message?.content);
  const wardrobeIds = new Set(opts.wardrobe.map((g) => g.id));
  const descriptive = mergeEvaluation(parsed, opts.provided, generate);

  return {
    ...descriptive,
    items: sanitizeItems(parsed?.items, wardrobeIds),
    unmatchedDescriptions: Array.isArray(parsed?.unmatchedDescriptions)
      ? (parsed.unmatchedDescriptions as unknown[]).filter((s: unknown) => typeof s === "string")
      : [],
  };
}
