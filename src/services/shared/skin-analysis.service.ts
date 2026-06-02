import * as fs from "fs";
import * as path from "path";
import { prisma } from "../../utils/prisma";
import SkinAnalysisRepo from "../../repositories/skin-analysis.repository";
import FileRepo from "../../repositories/file.repository";
import {
  rankProducts,
  type AnalysisInput,
  type ProductForScoring,
  type WeatherContext,
} from "../../utils/cosmetics.util";
import { streamChat } from "../../utils/chat-wonder-stream";
import ChatWonderService from "./chat-wonder.service";
import axios from "axios";
import {
  SKIN_ANALYSIS_ENABLED,
  CHAT_WONDER_API_URL,
  YOUCAM_API_KEY,
  YOUCAM_API_URL,
} from "../../config";
import logger from "../../utils/logger";
import { parsePagination } from "../../helpers/pagination.helper";
import { notifyCompanion } from "../../utils/socket.util";
import { mapService } from "./map.service";
import { weatherService } from "./weather.service";
import { computeRisks, buildTags } from "../../utils/weather.util";

// ─── Mock skin-analysis loader (dev) ────────────────────────────────────────

const MOCK_HISTORY_PATH = path.resolve(process.cwd(), "src/mocks/skin-analysis.history.json");

type PerfectCorpEntry = {
  success: boolean;
  overallScore?: number;
  skinAge?: number;
  output: Array<{ type: string; ui_score?: number; score?: number }>;
};

function loadMockVision() {
  try {
    const raw = fs.readFileSync(MOCK_HISTORY_PATH, "utf-8");
    const entries: PerfectCorpEntry[] = JSON.parse(raw);
    const successful = entries.filter((e) => e.success);
    if (!successful.length) return null;
    // Pick a random entry so each scan feels different
    const entry = successful[Math.floor(Math.random() * successful.length)];
    return parsePerfectCorpEntry(entry);
  } catch (err) {
    logger.warn(`[SkinAnalysis] Could not load mock history: ${err}`);
    return null;
  }
}

function parsePerfectCorpEntry(entry: PerfectCorpEntry) {
  // Build score map from output array
  const s: Record<string, number> = {};
  for (const item of entry.output ?? []) {
    s[item.type] = item.ui_score ?? item.score ?? 0;
  }

  const oilinessPct = s["oiliness"] ?? 50;
  // PerfectCorp "moisture" = moisture-issue severity; high → dry skin.
  // When absent (some YouCam response shapes omit it), fall back based on oiliness:
  // high oiliness → low moisture issue; low oiliness → neutral.
  const hasMoisture = "moisture" in s;
  const moistureIssue = hasMoisture ? s["moisture"] : oilinessPct >= 70 ? 30 : 50;
  const hydrationPct = Math.round(100 - moistureIssue);

  // Determine skin type
  let skinType: "OILY" | "DRY" | "COMBINATION" | "NORMAL" | "SENSITIVE";
  if (oilinessPct >= 70 && moistureIssue < 50) skinType = "OILY";
  else if (oilinessPct < 30 && moistureIssue >= 55) skinType = "DRY";
  else if (oilinessPct >= 55 && moistureIssue >= 50) skinType = "COMBINATION";
  else if ((s["redness"] ?? 0) >= 70) skinType = "SENSITIVE";
  else skinType = "NORMAL";

  // Build concern list from thresholds
  const concerns: string[] = [];
  if (oilinessPct >= 70) concerns.push("Oiliness");
  if (moistureIssue >= 60) concerns.push("Mild dehydration");
  if ((s["acne"] ?? 0) >= 60) concerns.push("Acne");
  if ((s["wrinkle"] ?? 0) >= 60) concerns.push("Fine lines / wrinkles");
  if ((s["dark_circle_v2"] ?? 0) >= 60) concerns.push("Dark circles");
  if ((s["age_spot"] ?? 0) >= 60) concerns.push("Age spots / hyperpigmentation");
  if ((s["pore"] ?? 0) >= 60) concerns.push("Enlarged pores");
  if ((s["redness"] ?? 0) >= 70) concerns.push("Redness / sensitivity");
  if ((s["droopy_lower_eyelid"] ?? 0) >= 65 || (s["eye_bag"] ?? 0) >= 65)
    concerns.push("Under-eye puffiness");
  if (concerns.length === 0) concerns.push("General maintenance");

  const routineTips: Record<string, string> = {
    OILY: "Use oil-free, mattifying products. Add a BHA toner to minimise pores and control shine.",
    DRY: "Focus on ceramide-rich moisturisers and hydrating serums. Avoid harsh stripping cleansers.",
    COMBINATION:
      "Apply a lightweight gel moisturiser on the T-zone and a richer formula on dry patches.",
    SENSITIVE:
      "Choose fragrance-free, calming formulas with centella or oat extract to ease redness.",
    NORMAL: "Maintain your routine with a gentle cleanser, daily SPF, and a hydrating serum.",
  };

  return {
    skinType,
    skinTone: "Natural",
    hydrationPct,
    oilinessPct,
    concerns,
    routineTip: routineTips[skinType],
    overallScore: entry.overallScore ?? 75,
    skinAge: entry.skinAge ?? null,
    rawScores: s,
  };
}

// ─── Fallback vision when JSON file is missing ──────────────────────────────

function getFallbackVision() {
  return {
    skinType: "COMBINATION" as const,
    skinTone: "Natural",
    hydrationPct: 50,
    oilinessPct: 50,
    concerns: ["General maintenance"],
    routineTip: "Maintain your routine with a gentle cleanser, SPF, and a hydrating serum.",
    overallScore: 75,
    skinAge: null as number | null,
    rawScores: {} as Record<string, number>,
  };
}

// ─── YouCam / PerfectCorp real API call ─────────────────────────────────────

async function callYouCamApi(
  imageUrl: string
): Promise<ReturnType<typeof parsePerfectCorpEntry> | null> {
  if (!YOUCAM_API_KEY) {
    logger.warn("[SkinAnalysis] YOUCAM_API_KEY not set — cannot call real API");
    return null;
  }

  try {
    // Step 1: submit async job
    const submitRes = await axios.post(
      YOUCAM_API_URL,
      { image_url: imageUrl, effects: [{ id: "skin_analysis" }] },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${YOUCAM_API_KEY}`,
        },
        timeout: 15_000,
      }
    );

    const jobId: string = submitRes.data?.job_id ?? submitRes.data?.request_id;
    if (!jobId) {
      logger.warn("[SkinAnalysis] YouCam did not return a job_id");
      return null;
    }

    logger.info(`[SkinAnalysis] YouCam job submitted: ${jobId}`);

    // Step 2: poll for result (max 30s)
    const pollUrl = YOUCAM_API_URL.replace("/async/", "/result/") + `/${jobId}`;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 3_000));
      const pollRes = await axios.get(pollUrl, {
        headers: { Authorization: `Bearer ${YOUCAM_API_KEY}` },
        timeout: 10_000,
      });

      const status: string = pollRes.data?.status ?? "processing";
      if (status === "processing" || status === "queued") continue;
      if (status !== "done" && status !== "success" && status !== "completed") {
        logger.warn(`[SkinAnalysis] YouCam job failed with status: ${status}`);
        return null;
      }

      const result = pollRes.data?.result ?? pollRes.data;
      logger.info(`[SkinAnalysis] YouCam result received for job ${jobId}`);
      return parsePerfectCorpEntry(result as PerfectCorpEntry);
    }

    logger.warn(`[SkinAnalysis] YouCam job ${jobId} timed out after 30s`);
    return null;
  } catch (err) {
    logger.warn(`[SkinAnalysis] YouCam API call failed: ${(err as Error).message}`);
    return null;
  }
}

// ─── ChatWonder skin-analysis prompt ────────────────────────────────────────

function buildSkinPrompt(vision: ReturnType<typeof parsePerfectCorpEntry>): string {
  return (
    `A user's skin analysis shows the following results:\n` +
    `- Skin Type: ${vision.skinType}\n` +
    `- Oiliness: ${vision.oilinessPct}%\n` +
    `- Hydration: ${vision.hydrationPct}%\n` +
    `- Skin Concerns: ${vision.concerns.join(", ")}\n` +
    `- Routine Tip: ${vision.routineTip}\n\n` +
    `Based on this skin profile, recommend the most suitable products for this user. ` +
    `You MUST reference specific product names from the "Available cosmetic products" list provided in document_context. ` +
    `Mention 2-3 product names by name and explain briefly why each suits their skin profile.`
  );
}

export async function buildSkinCatalogContext(): Promise<string> {
  try {
    const catalog = await prisma.cosmeticProduct.findMany({
      take: 50,
      select: {
        id: true,
        name: true,
        brand: true,
        type: true,
        category: true,
        benefits: true,
        tags: true,
        spf: true,
        finish: true,
        priceAmount: true,
        priceUnit: true,
        fileUrl: { select: { fileUrl: true, thumbnailUrl: true } },
      },
    });
    if (!catalog.length) {
      logger.warn("[SkinAnalysis] Catalog is empty — no products injected into document_context");
      return "";
    }
    const lines = catalog.map((p) => {
      const tags = Array.isArray(p.tags) ? (p.tags as string[]).join(",") : "";
      const benefits = Array.isArray(p.benefits) ? (p.benefits as string[]).join(",") : "";
      const imageUrl = p.fileUrl?.thumbnailUrl ?? p.fileUrl?.fileUrl ?? "none";
      return (
        `- [${p.id}] ${p.brand ?? ""} ${p.name}` +
        ` | type:${p.type ?? "unknown"} | category:${p.category ?? "none"}` +
        ` | finish:${p.finish ?? "none"} | spf:${p.spf ?? "none"}` +
        ` | benefits:${benefits || "none"} | tags:${tags || "none"}` +
        ` | price:${p.priceAmount != null ? `${p.priceAmount} ${p.priceUnit ?? ""}`.trim() : "none"}` +
        ` | image:${imageUrl}`
      );
    });
    logger.info(
      `[SkinAnalysis] Catalog injected into document_context: ${catalog.length} products`
    );
    return `Available cosmetic products:\n${lines.join("\n")}`;
  } catch (err) {
    logger.warn(`[SkinAnalysis] Failed to build catalog context: ${(err as Error).message}`);
    return "";
  }
}

async function askChatWonderForSkinProducts(
  vision: ReturnType<typeof parsePerfectCorpEntry>,
  userId?: string
): Promise<string | null> {
  if (!CHAT_WONDER_API_URL) {
    logger.warn("[SkinAnalysis] CHAT_WONDER_API_URL not set — skipping ChatWonder call");
    return null;
  }

  try {
    const [sessionId, documentContext] = await Promise.all([
      userId
        ? ChatWonderService.generateChatSessionId(userId).then(String)
        : Promise.resolve(`skin-scan-${Date.now()}`),
      buildSkinCatalogContext(),
    ]);

    if (!sessionId) {
      logger.warn("[SkinAnalysis] Could not get ChatWonder session ID — skipping");
      return null;
    }

    const prompt = buildSkinPrompt(vision);
    logger.info(
      `[SkinAnalysis] Sending skin profile to ChatWonder | session: ${sessionId} | catalog injected: ${documentContext ? "yes" : "no"}`
    );

    let fullResponse = "";

    await streamChat({
      userInput: prompt,
      sessionId,
      callbacks: {
        onChunk: (chunk) => {
          fullResponse += chunk;
        },
        onComplete: () => {
          /* resolved by Promise */
        },
        onError: (err) => {
          logger.warn(`[SkinAnalysis] ChatWonder stream error: ${err.message}`);
        },
      },
    });

    if (!fullResponse) {
      logger.warn("[SkinAnalysis] ChatWonder returned empty response");
      return null;
    }

    logger.info(`[SkinAnalysis] ChatWonder raw response length: ${fullResponse.length} chars`);

    // Try to extract cosmetics_suggestion from JSON response; fall back to raw text
    try {
      const json = JSON.parse(fullResponse);
      const suggestion = json.cosmetics_suggestion || json.message || fullResponse;
      logger.info(`[SkinAnalysis] ChatWonder suggestion: ${String(suggestion).slice(0, 200)}…`);
      return String(suggestion);
    } catch {
      logger.info(`[SkinAnalysis] ChatWonder suggestion (raw): ${fullResponse.slice(0, 200)}…`);
      return fullResponse;
    }
  } catch (err) {
    logger.warn(`[SkinAnalysis] ChatWonder call failed: ${(err as Error).message}`);
    return null;
  }
}

// ─── Destination weather resolver ────────────────────────────────────────────
// Extracts location names from a user input string, geocodes each one,
// fetches live weather, and merges into a single worst-case WeatherContext.

export async function resolveDestinationWeather(
  input: string
): Promise<WeatherContext | undefined> {
  try {
    const matches = [
      ...input.matchAll(/\b(?:at|in|to)\s+([A-Z][^,.\n!?]+?)(?=\s+for\b|\s+and\b|\s*,|\s*\.|$)/gi),
    ];
    const locationNames = [...new Set(matches.map((m) => m[1].trim()).filter(Boolean))];
    if (!locationNames.length) return undefined;

    logger.info(`[resolveDestinationWeather] Detected: ${locationNames.join(", ")}`);

    const risks: Array<WeatherContext & { _tags: string[] }> = [];

    for (const name of locationNames) {
      try {
        const features = await mapService.search(name);
        if (!features.length) continue;
        const [lng, lat] = features[0].center;
        const w = await weatherService.getWeather(lat, lng);
        const obs = {
          temperature: w.temperature,
          humidity: w.humidity,
          uvIndex: w.uvIndex,
          precipitationProb: w.precipitationProb,
          windSpeed: w.windspeed,
        };
        const r = computeRisks(obs);
        const tags = buildTags(obs);
        risks.push({
          oilRisk: r.oilRisk,
          drynessRisk: r.drynessRisk,
          uvRisk: r.uvRisk,
          smudgeRisk: r.smudgeRisk,
          sweatRisk: r.sweatRisk,
          tags,
          _tags: tags,
        });
        logger.info(
          `[resolveDestinationWeather] ${name}: ${Math.round(w.temperature)}°C ` +
            `oilRisk=${r.oilRisk} uvRisk=${r.uvRisk} sweatRisk=${r.sweatRisk}`
        );
      } catch (e) {
        logger.warn(`[resolveDestinationWeather] Skipped "${name}": ${(e as Error).message}`);
      }
    }

    if (!risks.length) return undefined;

    // Take worst-case (max) across all destinations so products cover the full day
    return {
      oilRisk: Math.max(...risks.map((r) => r.oilRisk ?? 0)),
      drynessRisk: Math.max(...risks.map((r) => r.drynessRisk ?? 0)),
      uvRisk: Math.max(...risks.map((r) => r.uvRisk ?? 0)),
      smudgeRisk: Math.max(...risks.map((r) => r.smudgeRisk ?? 0)),
      sweatRisk: Math.max(...risks.map((r) => r.sweatRisk ?? 0)),
      tags: [...new Set(risks.flatMap((r) => r._tags))],
    };
  } catch (err) {
    logger.warn(`[resolveDestinationWeather] Failed: ${(err as Error).message}`);
    return undefined;
  }
}

// ─── Rule-engine fallback for chat-wonder/stream ─────────────────────────────
// Called when ChatWonder's own catalogue is unavailable and sets is empty.
// Parses the raw skin_analysis payload from the request, runs rankProducts,
// and returns a single set compatible with the chat-wonder complete event.

export async function buildFallbackCosmeticsSet(
  skinPayload: Record<string, unknown>,
  weather?: WeatherContext
): Promise<Record<string, unknown> | null> {
  try {
    const output =
      (skinPayload.output as Array<{ type: string; ui_score?: number; score?: number }>) ?? [];

    const entry: PerfectCorpEntry = {
      success: true,
      overallScore: (skinPayload.overallScore as number) ?? undefined,
      skinAge: (skinPayload.skinAge as number) ?? undefined,
      output,
    };
    const vision = parsePerfectCorpEntry(entry);
    const weatherCtx = weather;

    const catalog = await prisma.cosmeticProduct.findMany({
      select: {
        id: true,
        type: true,
        tags: true,
        spf: true,
        waterproof: true,
        transferProof: true,
        hydrating: true,
        oilFree: true,
        finish: true,
        name: true,
        brand: true,
        category: true,
        fileUrl: { select: { fileUrl: true, thumbnailUrl: true } },
      },
    });

    const ranked = rankProducts(
      {
        skinType: vision.skinType,
        hydrationPct: vision.hydrationPct,
        oilinessPct: vision.oilinessPct,
        concerns: vision.concerns,
        weather: weatherCtx,
      },
      catalog as ProductForScoring[]
    );

    if (!ranked.length) return null;

    const productMap = new Map(catalog.map((p) => [p.id, p]));

    const skinTypeLabels: Record<string, string> = {
      OILY: "oily",
      DRY: "dry",
      COMBINATION: "combination",
      SENSITIVE: "sensitive",
      NORMAL: "normal",
    };
    const SKIN_TYPES = new Set(["OILY", "DRY", "COMBINATION", "SENSITIVE", "NORMAL"]);

    const recommendations = ranked.slice(0, 5).map((r, i) => {
      const p = productMap.get(r.productId);
      // Convert raw scoring signals into a human-readable reason
      const signals = [...new Set(r.reason)]
        .filter((s) => !SKIN_TYPES.has(s.toUpperCase()))
        .map((s) => s.replace(/_/g, " ").toLowerCase())
        .filter(Boolean);
      const readableReason = signals.length
        ? `Helps with ${signals.slice(0, 3).join(", ")}.`
        : `Recommended for your skin profile.`;
      return {
        id: r.productId,
        name: p?.name ?? "Product",
        description: readableReason,
        type: p?.type ?? "Skincare",
        reason: readableReason,
        imageUrl: p?.fileUrl?.fileUrl ?? p?.fileUrl?.thumbnailUrl ?? null,
        score: r.score,
        rank: i + 1,
        resolved: true,
      };
    });

    const vibeMap: Record<string, string> = {
      OILY: "Matte & Clear",
      DRY: "Deep Hydration",
      COMBINATION: "Balanced Glow",
      SENSITIVE: "Calm & Soothe",
      NORMAL: "Healthy Glow",
    };

    const concerns = vision.concerns
      .filter((c) => c !== "General maintenance")
      .slice(0, 2)
      .join(" and ")
      .toLowerCase();
    const weatherNote = weatherCtx ? " suited for the weather at your destinations" : "";
    const message =
      `Here are your personalized skincare picks for ${skinTypeLabels[vision.skinType] ?? "your"} skin` +
      (concerns ? `, targeting ${concerns}` : "") +
      (weatherNote ? `,${weatherNote}` : "") +
      ".";

    return {
      set_number: 1,
      weather: null,
      vibe: vibeMap[vision.skinType] ?? "Healthy Glow",
      trend_note: `Personalized for your ${skinTypeLabels[vision.skinType] ?? ""} skin.`,
      recommendations,
      message,
    };
  } catch (err) {
    logger.warn(`[buildFallbackCosmeticsSet] Failed: ${(err as Error).message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────

const fileNotFound = () => ({ status: 400, message: "Referenced file (fileId) does not exist" });
const notFound = () => ({ status: 404, message: "Skin analysis not found" });

type PaginationQuery = {
  page?: string | number;
  limit?: string | number;
};

/**
 * The only thing that writes SkinAnalysis + its CosmeticRecommendation
 * rows. Two-step flow:
 *   1. Frontend uploads the captured photo via /file-uploads
 *   2. Frontend POSTs { fileId, weatherSnapshotId? } here
 *
 * This service runs vision → rule engine → persist atomically.
 */
export default class SkinAnalysisService {
  static async create(
    input: { fileId: string; weatherSnapshotId?: string | null },
    userId?: string
  ) {
    // 1. Validate referenced file
    const file = await FileRepo.findById(input.fileId);
    if (!file) throw fileNotFound();

    // 2. Optionally load weather context — we don't fail the request if the
    //    snapshot id is bogus, we just skip the weather signals.
    let weather: WeatherContext | undefined;
    if (input.weatherSnapshotId) {
      const snap = await prisma.weatherSnapshot.findUnique({
        where: { id: input.weatherSnapshotId },
      });
      if (snap) {
        weather = {
          oilRisk: snap.oilRisk,
          drynessRisk: snap.drynessRisk,
          uvRisk: snap.uvRisk,
          smudgeRisk: snap.smudgeRisk,
          sweatRisk: snap.sweatRisk,
          tags: snap.tags,
        };
      } else {
        logger.warn(
          `SkinAnalysis: weatherSnapshotId ${input.weatherSnapshotId} not found, skipping weather signals`
        );
      }
    }

    // 3. Vision analysis — toggle via SKIN_ANALYSIS_ENABLED env var
    //    false (default) → mock data from skin-analysis.history.json
    //    true            → real PerfectCorp/YouCam API call
    let vision: ReturnType<typeof parsePerfectCorpEntry>;

    if (SKIN_ANALYSIS_ENABLED) {
      const youCamResult = await callYouCamApi(file.fileUrl);
      if (youCamResult) {
        vision = youCamResult;
      } else {
        logger.warn("[SkinAnalysis] YouCam call failed — falling back to mock");
        vision = loadMockVision() ?? getFallbackVision();
      }
    } else {
      vision = loadMockVision() ?? getFallbackVision();
    }

    logger.info(
      `[SkinAnalysis] vision source=${SKIN_ANALYSIS_ENABLED ? "api" : "mock"} ` +
        `skinType=${vision.skinType} oiliness=${vision.oilinessPct} ` +
        `hydration=${vision.hydrationPct} concerns=[${vision.concerns.join(", ")}]`
    );

    // 4. Ask ChatWonder to suggest products based on the skin profile,
    //    then fall back to the local rule engine if ChatWonder is unavailable.
    const chatWonderSuggestion = await askChatWonderForSkinProducts(vision, userId);

    // 5. Load catalog and run rule engine (always runs — ChatWonder enriches on top)
    const catalog = await prisma.cosmeticProduct.findMany({
      select: {
        id: true,
        type: true,
        tags: true,
        spf: true,
        waterproof: true,
        transferProof: true,
        hydrating: true,
        oilFree: true,
        finish: true,
      },
    });

    logger.info(`[SkinAnalysis] Catalog loaded: ${catalog.length} products for scoring`);
    if (catalog.length > 0) {
      const sample = catalog[0];
      logger.info(
        `[SkinAnalysis] Sample product attributes — type:${sample.type} | tags:${JSON.stringify(sample.tags)} | oilFree:${sample.oilFree} | hydrating:${sample.hydrating} | spf:${sample.spf} | finish:${sample.finish}`
      );
    }

    const engineInput: AnalysisInput = {
      skinType: vision.skinType,
      hydrationPct: vision.hydrationPct,
      oilinessPct: vision.oilinessPct,
      concerns: vision.concerns,
      weather,
    };

    logger.info(
      `[SkinAnalysis] Scoring input — skinType:${engineInput.skinType} | hydration:${engineInput.hydrationPct}% | oiliness:${engineInput.oilinessPct}% | concerns:[${engineInput.concerns.join(", ")}]`
    );

    const ranked = rankProducts(engineInput, catalog as ProductForScoring[]);

    logger.info(
      `[SkinAnalysis] Scoring result — ${catalog.length} products scored, ${ranked.length} passed MIN_SCORE threshold`
    );
    if (ranked.length === 0 && catalog.length > 0) {
      logger.warn(
        "[SkinAnalysis] All products scored below MIN_SCORE=25 — check that products have type, tags, oilFree, hydrating, spf, or finish set in the DB"
      );
    }
    if (ranked.length > 0) {
      logger.info(
        `[SkinAnalysis] Top ranked: ${ranked
          .slice(0, 3)
          .map((r) => `score:${r.score} id:${r.productId}`)
          .join(" | ")}`
      );
    }

    // 5. Persist analysis + recommendations atomically
    const created = await SkinAnalysisRepo.createWithRecommendations(
      {
        fileId: file.id,
        skinType: vision.skinType,
        skinTone: vision.skinTone ?? null,
        hydrationPct: clampPct(vision.hydrationPct),
        oilinessPct: clampPct(vision.oilinessPct),
        concerns: vision.concerns,
        routineTip: vision.routineTip,
        weatherSnapshotId: weather ? input.weatherSnapshotId : null,
        rawSignals: {
          vision,
          weather: weather ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          perfectCorp: (vision as any).rawScores ?? null,
          chatWonderSuggestion: chatWonderSuggestion ?? null,
        },
      },
      ranked.map((r) => ({
        cosmeticProductId: r.productId,
        score: r.score,
        rank: r.rank,
        reason: r.reason.join(", "),
        signals: r.signals,
      }))
    );

    // 6. Push result to FE via Socket.io before any further DB work
    if (userId) {
      notifyCompanion(userId, "skin_analysis_complete", created);
    }

    // 7. Link this SkinAnalysis to the user's active/latest UserOutline (if user is logged in)
    if (userId) {
      let outline = await prisma.userOutline.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      if (!outline) {
        outline = await prisma.userOutline.create({
          data: {
            userId,
            userPrompt: ["Kiosk Scan Session"],
            location: "Kiosk",
          },
        });
      }

      await prisma.userOutline.update({
        where: { id: outline.id },
        data: { skinAnalysisId: created.id },
      });
    }

    return created;
  }

  static async getById(id: string, userId: string) {
    const analysis = await SkinAnalysisRepo.findById(id);
    if (!analysis) throw notFound();

    // Verify ownership by checking if this skin analysis is linked to any outline belonging to this user
    const ownsScan = await prisma.userOutline.findFirst({
      where: {
        skinAnalysisId: id,
        userId,
      },
    });
    if (!ownsScan) throw notFound();

    return analysis;
  }

  static async listForUser(userId: string, query: PaginationQuery = {}) {
    const { page, limit, sortBy, sortOrder, search, filters } = parsePagination(query);
    const result = await SkinAnalysisRepo.findByUser(userId, page, limit);
    return { ...result, sortBy, sortOrder, search, filters };
  }

  static async destroy(id: string, userId: string) {
    await this.getById(id, userId); // ownership check
    await SkinAnalysisRepo.delete(id);
    return { message: "Skin analysis deleted successfully" };
  }
}

function clampPct(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
