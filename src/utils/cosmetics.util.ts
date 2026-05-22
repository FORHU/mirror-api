import type { COSMETIC_TYPE, COSMETIC_FINISH, SKIN_TYPE } from "@prisma/client";

/**
 * Pure rule engine for cosmetic recommendations. No I/O — call
 * `rankProducts` with the analysis input and a catalog snapshot and it
 * returns ordered picks ready to persist as CosmeticRecommendation rows.
 *
 * The service layer is the only thing that should touch this file; tests
 * can import it directly because it has no side effects.
 */

export type WeatherContext = {
  // From WeatherSnapshot — all optional because skin analysis can run
  // without a snapshot (kiosk hasn't taken one yet).
  oilRisk?: number; // 0-100
  drynessRisk?: number;
  uvRisk?: number;
  smudgeRisk?: number;
  sweatRisk?: number;
  tags?: string[];
};

export type AnalysisInput = {
  skinType: SKIN_TYPE;
  hydrationPct: number; // 0-100
  oilinessPct: number; // 0-100
  concerns: string[]; // free-text labels from vision
  weather?: WeatherContext;
};

export type ProductForScoring = {
  id: string;
  type: COSMETIC_TYPE | null;
  tags: string[];
  spf: number | null;
  waterproof: boolean;
  transferProof: boolean;
  hydrating: boolean;
  oilFree: boolean;
  finish: COSMETIC_FINISH | null;
};

export type ScoredProduct = {
  productId: string;
  score: number; // 0-100, clamped
  rank: number; // 1-based
  reason: string[]; // short labels surfaced in UI
  signals: Record<string, number>; // contribution per rule, for debugging
};

const MIN_SCORE = 25; // products below this drop out
const MAX_RESULTS = 10;

// Concern keyword → preference. Match is substring, case-insensitive.
const CONCERN_RULES: Array<{
  match: RegExp;
  label: string;
  prefer: Partial<{
    hydrating: number;
    oilFree: number;
    minSpf: number;
    finish: COSMETIC_FINISH;
    types: COSMETIC_TYPE[];
    tags: string[];
  }>;
}> = [
  {
    match: /dehydrat|dry|tight/i,
    label: "Mild dehydration",
    prefer: { hydrating: 20, finish: "DEWY", types: ["MOISTURIZER", "SERUM", "ESSENCE"] },
  },
  {
    match: /oil|shin|greasy/i,
    label: "Oiliness",
    prefer: { oilFree: 20, finish: "MATTE", types: ["TONER", "MOISTURIZER"] },
  },
  {
    match: /pore|blackhead/i,
    label: "Enlarged pores",
    prefer: { types: ["EXFOLIANT", "SERUM", "TONER"], tags: ["niacinamide", "salicylic"] },
  },
  {
    match: /uneven|tone|dark spot|pigment/i,
    label: "Uneven skin tone",
    prefer: {
      types: ["EXFOLIANT", "SERUM", "SUNSCREEN"],
      tags: ["vitamin c", "niacinamide", "glycolic"],
      minSpf: 30,
    },
  },
  {
    match: /wrinkle|fine line|aging/i,
    label: "Fine lines",
    prefer: { types: ["SERUM", "MOISTURIZER"], tags: ["retinol", "peptide"], hydrating: 10 },
  },
  {
    match: /sensit|redness|irritat/i,
    label: "Sensitivity",
    prefer: {
      types: ["MOISTURIZER", "CLEANSER"],
      tags: ["ceramide", "oatmeal", "centella"],
      hydrating: 10,
    },
  },
  {
    match: /sun|uv|sunburn/i,
    label: "Sun exposure",
    prefer: { types: ["SUNSCREEN"], minSpf: 30 },
  },
];

// Skin-type baseline preferences
const SKIN_TYPE_PREF: Record<
  SKIN_TYPE,
  { hydrating?: number; oilFree?: number; finish?: COSMETIC_FINISH }
> = {
  DRY: { hydrating: 15, finish: "DEWY" },
  OILY: { oilFree: 15, finish: "MATTE" },
  COMBINATION: { hydrating: 8, oilFree: 8 },
  NORMAL: {},
  SENSITIVE: { hydrating: 10 },
};

export function scoreProduct(
  input: AnalysisInput,
  product: ProductForScoring
): {
  score: number;
  reason: string[];
  signals: Record<string, number>;
} {
  const reason: string[] = [];
  const signals: Record<string, number> = {};
  let score = 0;

  const add = (key: string, n: number, label?: string) => {
    if (n <= 0) return;
    score += n;
    signals[key] = (signals[key] || 0) + n;
    if (label && !reason.includes(label)) reason.push(label);
  };

  // 1. Skin-type baseline
  const skinPref = SKIN_TYPE_PREF[input.skinType] || {};
  if (skinPref.hydrating && product.hydrating)
    add("skin_hydrating", skinPref.hydrating, input.skinType);
  if (skinPref.oilFree && product.oilFree) add("skin_oilFree", skinPref.oilFree, input.skinType);
  if (skinPref.finish && product.finish === skinPref.finish) add("skin_finish", 10, input.skinType);

  // 2. Concern rules
  for (const rule of CONCERN_RULES) {
    const hit = input.concerns.some((c) => rule.match.test(c));
    if (!hit) continue;

    if (rule.prefer.hydrating && product.hydrating)
      add(`concern_${rule.label}_hydrating`, rule.prefer.hydrating, rule.label);
    if (rule.prefer.oilFree && product.oilFree)
      add(`concern_${rule.label}_oilFree`, rule.prefer.oilFree, rule.label);
    if (rule.prefer.minSpf && product.spf && product.spf >= rule.prefer.minSpf)
      add(`concern_${rule.label}_spf`, 15, rule.label);
    if (rule.prefer.finish && product.finish === rule.prefer.finish)
      add(`concern_${rule.label}_finish`, 8, rule.label);
    if (rule.prefer.types && product.type && rule.prefer.types.includes(product.type))
      add(`concern_${rule.label}_type`, 20, rule.label);
    const preferredTags = rule.prefer.tags;
    if (preferredTags && product.tags.length) {
      const tagHit = product.tags.some((t) =>
        preferredTags.some((rt) => t.toLowerCase().includes(rt))
      );
      if (tagHit) add(`concern_${rule.label}_tag`, 10, rule.label);
    }
  }

  // 3. Hydration/oiliness percentages (continuous signals)
  if (input.hydrationPct < 50 && product.hydrating)
    add("low_hydration", (50 - input.hydrationPct) / 5, "Low hydration");
  if (input.oilinessPct > 60 && product.oilFree)
    add("high_oiliness", (input.oilinessPct - 60) / 5, "High oiliness");

  // 4. Weather context (optional)
  const w = input.weather;
  if (w) {
    if ((w.uvRisk ?? 0) >= 60 && product.spf && product.spf >= 30) add("weather_uv", 12, "High UV");
    if ((w.oilRisk ?? 0) >= 60 && product.oilFree) add("weather_oil", 10, "Humid weather");
    if ((w.drynessRisk ?? 0) >= 60 && product.hydrating) add("weather_dry", 10, "Dry weather");
    if ((w.smudgeRisk ?? 0) >= 60 && product.transferProof) add("weather_smudge", 8, "Smudge risk");
    if ((w.sweatRisk ?? 0) >= 60 && product.waterproof) add("weather_sweat", 8, "Sweat risk");
  }

  // Clamp
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return { score, reason, signals };
}

export function rankProducts(input: AnalysisInput, products: ProductForScoring[]): ScoredProduct[] {
  const scored = products
    .map((p) => {
      const { score, reason, signals } = scoreProduct(input, p);
      return { productId: p.id, score, reason, signals };
    })
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
