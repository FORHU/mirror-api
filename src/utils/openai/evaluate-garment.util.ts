import openai from "./ai-request.util";
import {
  GARMENT_TYPES,
  FITTING_SLOT,
  CATEGORY,
  GARMENT_GENDER,
  LAYER_LEVEL,
  SILHOUETTE,
} from "@prisma/client";

export interface GarmentEvaluation {
  name: string;
  description: string;
  garmentType: GARMENT_TYPES[];
  fittingSlot: FITTING_SLOT[];
  category: CATEGORY[];
  gender: GARMENT_GENDER;
  layerLevel: LAYER_LEVEL;
  silhouette: SILHOUETTE;
  tags: string[];
  dominantColor?: string;
}

const buildPrompt = () => `
You are a fashion classifier for a Smart Mirror styling system.
Analyze the garment in the provided image and return a STRICT JSON object that
classifies it using ONLY the allowed enum values below. Do not invent new values.

Allowed values:
- garmentType (array, pick 1-3): ${Object.values(GARMENT_TYPES).join(", ")}
- fittingSlot (array, pick 1-2): ${Object.values(FITTING_SLOT).join(", ")}
- category (array, pick 1-3): ${Object.values(CATEGORY).join(", ")}
- gender (single): ${Object.values(GARMENT_GENDER).join(", ")}
- layerLevel (single): ${Object.values(LAYER_LEVEL).join(", ")}
- silhouette (single): ${Object.values(SILHOUETTE).join(", ")}

Return JSON with this exact shape:
{
  "name": "short descriptive name (e.g. 'Black Oversized Hoodie')",
  "description": "one or two sentences describing the garment",
  "garmentType": ["..."],
  "fittingSlot": ["..."],
  "category": ["..."],
  "gender": "...",
  "layerLevel": "...",
  "silhouette": "...",
  "tags": ["free-form descriptive tags, e.g. 'black', 'cotton', 'streetwear'"],
  "dominantColor": "hex color like #1a1a1a"
}

Return ONLY the JSON. No markdown, no commentary.
`;

/**
 * Sends an image (URL or base64 data URL) to GPT-4o vision and returns a
 * structured garment evaluation that maps to our Prisma enums.
 */
export async function evaluateGarmentImage(imageUrl: string): Promise<GarmentEvaluation> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a precise fashion classifier. Always respond with valid JSON that strictly matches the requested schema and uses only the allowed enum values.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt() },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw { status: 502, message: "OpenAI returned an empty response" };

  let parsed: GarmentEvaluation;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (err) {
    throw { status: 502, message: "Failed to parse OpenAI JSON response" };
  }

  return sanitizeEvaluation(parsed);
}

/**
 * Drops any enum values the model hallucinated so Prisma writes never fail.
 */
function sanitizeEvaluation(evalData: GarmentEvaluation): GarmentEvaluation {
  const garmentTypes = Object.values(GARMENT_TYPES) as string[];
  const fittingSlots = Object.values(FITTING_SLOT) as string[];
  const categories = Object.values(CATEGORY) as string[];
  const genders = Object.values(GARMENT_GENDER) as string[];
  const layerLevels = Object.values(LAYER_LEVEL) as string[];
  const silhouettes = Object.values(SILHOUETTE) as string[];

  return {
    ...evalData,
    garmentType: (evalData.garmentType || []).filter((t) => garmentTypes.includes(t)) as GARMENT_TYPES[],
    fittingSlot: (evalData.fittingSlot || []).filter((t) => fittingSlots.includes(t)) as FITTING_SLOT[],
    category: (evalData.category || []).filter((t) => categories.includes(t)) as CATEGORY[],
    gender: (genders.includes(evalData.gender) ? evalData.gender : GARMENT_GENDER.UNISEX) as GARMENT_GENDER,
    layerLevel: (layerLevels.includes(evalData.layerLevel) ? evalData.layerLevel : LAYER_LEVEL.BASE) as LAYER_LEVEL,
    silhouette: (silhouettes.includes(evalData.silhouette) ? evalData.silhouette : SILHOUETTE.Regular) as SILHOUETTE,
    tags: Array.isArray(evalData.tags) ? evalData.tags : [],
  };
}
