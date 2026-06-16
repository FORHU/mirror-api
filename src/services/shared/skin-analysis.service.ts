import { prisma } from "../../utils/prisma";
import SkinAnalysisRepo from "../../repositories/skin-analysis.repository";
import FileRepo from "../../repositories/file.repository";
import {
  rankProducts,
  type ProductForScoring,
  type WeatherContext,
} from "../../utils/cosmetics.util";
import axios from "axios";
import {
  SKIN_ANALYSIS_ENABLED,
  YOUCAM_API_KEY,
  YOUCAM_API_BASE,
  SKIN_ANALYSIS_MOCK_DATA,
  type SkinVision,
} from "../../config";
import logger from "../../utils/logger";
import { parsePagination } from "../../helpers/pagination.helper";
import { notifyCompanion } from "../../utils/socket.util";
import { mapService } from "./map.service";
import { weatherService } from "./weather.service";
import { computeRisks, buildTags } from "../../utils/weather.util";

// ─── Mock skin-analysis loader (dev) ────────────────────────────────────────

type PerfectCorpEntry = {
  success: boolean;
  overallScore?: number;
  skinAge?: number;
  // Matches PerfectCorp's format:"json" result — data.results.output[].
  output: Array<{
    type: string;
    region?: string;
    ui_score?: number;
    raw_score?: number;
    score?: number;
    skin_type?: string; // only on type:"skin_type" entries (e.g. "Normal", "Oily")
  }>;
};

// Pick a random pre-built mock vision (from config) so each scan feels different.
// No file I/O or parsing — the data is an in-memory constant.
function pickMockVision(): SkinVision {
  return SKIN_ANALYSIS_MOCK_DATA[Math.floor(Math.random() * SKIN_ANALYSIS_MOCK_DATA.length)];
}

function parsePerfectCorpEntry(entry: PerfectCorpEntry): SkinVision {
  // PerfectCorp ui_scores are SKIN-HEALTH scores: 1–100, HIGHER = HEALTHIER
  // (e.g. acne:84 = clear skin, redness:90 = calm). Verified against real API
  // output 2026-06-16. We therefore read `health` directly and derive a
  // `severity = 100 - health` for concern/skin-type thresholds.
  const health: Record<string, number> = {};
  let apiSkinType: string | undefined; // PerfectCorp's own classification ("Normal", "Oily"…)
  let overallScore = entry.overallScore;
  let skinAge = entry.skinAge ?? null;

  for (const item of entry.output ?? []) {
    if (item.type === "skin_type") {
      // Prefer the whole-face classification; fall back to the first seen.
      if (item.region === "whole" || apiSkinType === undefined) apiSkinType = item.skin_type;
      continue;
    }
    if (item.type === "all") {
      overallScore = item.score ?? item.ui_score ?? overallScore;
      continue;
    }
    if (item.type === "skin_age") {
      skinAge = item.score ?? skinAge;
      continue;
    }
    if (item.type === "resize_image") continue;
    const v = item.ui_score ?? item.score ?? item.raw_score;
    if (typeof v === "number") health[item.type] = v;
  }

  // severity(k): how bad the concern is (0 = perfect, 100 = severe). Defaults to
  // `def` severity when the metric is absent.
  const sev = (k: string, def = 50) => 100 - (k in health ? health[k] : 100 - def);

  // Hydration tracks moisture health directly; oiliness tracks oil severity.
  const hydrationPct = Math.round("moisture" in health ? health["moisture"] : 50);
  const oilinessPct = Math.round(sev("oiliness"));

  // Skin type: trust PerfectCorp's classification when present, else derive.
  const TYPE_MAP: Record<string, SkinVision["skinType"]> = {
    normal: "NORMAL",
    oily: "OILY",
    dry: "DRY",
    combination: "COMBINATION",
    redness: "SENSITIVE",
    "dry & redness": "SENSITIVE",
    "oily & redness": "SENSITIVE",
    "combination & redness": "SENSITIVE",
  };
  let skinType: SkinVision["skinType"];
  const mapped = apiSkinType ? TYPE_MAP[apiSkinType.toLowerCase()] : undefined;
  if (mapped) skinType = mapped;
  else if (oilinessPct >= 70 && hydrationPct >= 50) skinType = "OILY";
  else if (oilinessPct < 30 && hydrationPct < 45) skinType = "DRY";
  else if (oilinessPct >= 55) skinType = "COMBINATION";
  else if (sev("redness") >= 70) skinType = "SENSITIVE";
  else skinType = "NORMAL";

  // Concerns surface where severity (100 - health) is high.
  const concerns: string[] = [];
  if (sev("oiliness") >= 65) concerns.push("Oiliness");
  if (sev("moisture") >= 55) concerns.push("Dehydration");
  if (sev("acne") >= 50) concerns.push("Acne");
  if (sev("wrinkle") >= 50) concerns.push("Fine lines / wrinkles");
  if (sev("dark_circle_v2") >= 50) concerns.push("Dark circles");
  if (sev("age_spot") >= 50) concerns.push("Age spots / hyperpigmentation");
  if (sev("pore") >= 50) concerns.push("Enlarged pores");
  if (sev("redness") >= 55) concerns.push("Redness / sensitivity");
  if (sev("droopy_lower_eyelid") >= 60 || sev("eye_bag") >= 55)
    concerns.push("Under-eye puffiness");
  if (sev("radiance") >= 55) concerns.push("Dullness");
  if (sev("firmness") >= 55) concerns.push("Loss of firmness");
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
    overallScore: overallScore ?? 75,
    skinAge: skinAge ?? null,
    rawScores: health,
  };
}

// ─── YouCam / PerfectCorp real API call ─────────────────────────────────────
// Docs: https://docs.perfectcorp.com/reference/ai_skin_analysis
// Flow: register file → PUT bytes to presigned URL → create task → poll → scores.
// Auth is a plain `Bearer YOUCAM_API_KEY` header (no secret / RSA token).

// Full SD ("standard definition") skincare metric set — we request everything so
// ChatWonder gets the richest profile. HD and SD metrics CANNOT be mixed in one
// task, and our 1280×720 captures satisfy the SD short-side ≥ 480px requirement.
const SKIN_ANALYSIS_ACTIONS = [
  "oiliness",
  "moisture",
  "acne",
  "wrinkle",
  "pore",
  "texture",
  "redness",
  "age_spot",
  "dark_circle_v2",
  "eye_bag",
  "radiance",
  "firmness",
  "droopy_upper_eyelid",
  "droopy_lower_eyelid",
  "tear_trough",
  "skin_type",
];

async function callYouCamApi(
  imageUrl: string
): Promise<ReturnType<typeof parsePerfectCorpEntry> | null> {
  if (!YOUCAM_API_KEY) {
    logger.warn("[SkinAnalysis] YOUCAM_API_KEY not set — cannot call real API");
    return null;
  }

  const auth = { Authorization: `Bearer ${YOUCAM_API_KEY}` };

  try {
    // Step 0: pull the captured image bytes (already persisted on our CDN/S3).
    const imgRes = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15_000,
    });
    const buffer = Buffer.from(imgRes.data);
    const rawCt = imgRes.headers["content-type"];
    const contentType = typeof rawCt === "string" && rawCt ? rawCt.split(";")[0] : "image/jpeg";
    const fileName = `skin-capture.${contentType.split("/")[1] || "jpg"}`;

    // Step 1: register the file → get file_id + a presigned PUT request.
    const fileRes = await axios.post(
      `${YOUCAM_API_BASE}/s2s/v2.0/file/skin-analysis`,
      { files: [{ content_type: contentType, file_name: fileName, file_size: buffer.byteLength }] },
      { headers: { ...auth, "Content-Type": "application/json" }, timeout: 15_000 }
    );

    const fileEntry = fileRes.data?.data?.files?.[0] ?? fileRes.data?.result?.files?.[0];
    const fileId: string | undefined = fileEntry?.file_id;
    const uploadReq = fileEntry?.requests?.[0];
    if (!fileId || !uploadReq?.url) {
      logger.warn("[SkinAnalysis] YouCam File API did not return file_id / upload url");
      return null;
    }

    // Step 2: upload the bytes to the presigned URL using the headers it dictated.
    await axios.put(uploadReq.url, buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.byteLength),
        ...(uploadReq.headers ?? {}),
      },
      maxBodyLength: Infinity,
      timeout: 30_000,
    });

    // Step 3: create the task. format:"json" returns scores inline (no ZIP to unzip).
    const taskRes = await axios.post(
      `${YOUCAM_API_BASE}/s2s/v2.0/task/skin-analysis`,
      { src_file_id: fileId, dst_actions: SKIN_ANALYSIS_ACTIONS, format: "json" },
      { headers: { ...auth, "Content-Type": "application/json" }, timeout: 15_000 }
    );

    const taskId: string | undefined =
      taskRes.data?.data?.task_id ?? taskRes.data?.result?.task_id ?? taskRes.data?.task_id;
    if (!taskId) {
      logger.warn("[SkinAnalysis] YouCam did not return a task_id");
      return null;
    }
    logger.info(`[SkinAnalysis] YouCam task submitted: ${taskId}`);

    // Step 4: poll until success/error (≤ ~60s).
    const pollUrl = `${YOUCAM_API_BASE}/s2s/v2.0/task/skin-analysis/${taskId}`;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((r) => setTimeout(r, 2_000));
      const pollRes = await axios.get(pollUrl, { headers: auth, timeout: 10_000 });
      const data = pollRes.data?.data ?? pollRes.data;
      const status: string = data?.task_status ?? "running";

      if (status === "running" || status === "queued") continue;
      if (status !== "success") {
        logger.warn(
          `[SkinAnalysis] YouCam task ${taskId} failed: status=${status} ` +
            `error=${data?.error ?? ""} ${data?.error_message ?? ""}`
        );
        return null;
      }

      // Step 5: inline JSON scores → existing parser (output[].type matches our keys).
      const output = (data?.results?.output ?? data?.result?.output ?? []) as PerfectCorpEntry["output"];
      // NOTE: PerfectCorp ui_scores run 1–100; verify their direction against the
      // first real run (high score = more vs. less of the concern) and flip the
      // thresholds in parsePerfectCorpEntry if the skinType/concerns look inverted.
      logger.info(
        `[SkinAnalysis] YouCam result for task ${taskId}: ${output.length} metrics — ` +
          output.map((o) => `${o.type}:${o.ui_score ?? o.score ?? o.raw_score}`).join(" ")
      );
      return parsePerfectCorpEntry({ success: true, output } as PerfectCorpEntry);
    }

    logger.warn(`[SkinAnalysis] YouCam task ${taskId} timed out after 60s`);
    return null;
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    logger.warn(
      `[SkinAnalysis] YouCam API call failed: ${ax.message ?? ""}` +
        (ax.response ? ` (status ${ax.response.status}: ${JSON.stringify(ax.response.data)})` : "")
    );
    return null;
  }
}

// ─── ChatWonder skin-analysis prompt ────────────────────────────────────────

export async function buildSkinCatalogContext(): Promise<string> {
  try {
    const catalog = await prisma.cosmeticProduct.findMany({
      where: { fileUrl: { is: { fileUrl: { not: "" } } } },
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
      where: { fileUrl: { is: { fileUrl: { not: "" } } } },
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
    //    false (default) → random mock data from SKIN_ANALYSIS_MOCK_DATA (config)
    //    true            → real PerfectCorp/YouCam API call
    let vision: SkinVision;

    if (SKIN_ANALYSIS_ENABLED) {
      const youCamResult = await callYouCamApi(file.fileUrl);
      if (youCamResult) {
        vision = youCamResult;
      } else {
        logger.warn("[SkinAnalysis] YouCam call failed — falling back to mock");
        vision = pickMockVision();
      }
    } else {
      vision = pickMockVision();
    }

    logger.info(
      `[SkinAnalysis] vision source=${SKIN_ANALYSIS_ENABLED ? "api" : "mock"} ` +
        `skinType=${vision.skinType} oiliness=${vision.oilinessPct} ` +
        `hydration=${vision.hydrationPct} concerns=[${vision.concerns.join(", ")}]`
    );

    // 4. Product selection is delegated entirely to ChatWonder (the LLM). The
    //    frontend, on skin_analysis_complete, kicks a cosmetics ChatWonder turn
    //    with this analysis profile and ChatWonder writes its own picks against
    //    the UserOutline. So we persist the SkinAnalysis WITHOUT rule-engine
    //    recommendations — the vision profile (skinType / scores / concerns) is
    //    all the frontend needs to drive ChatWonder.

    // 5. Persist analysis (recommendations come from ChatWonder, not here)
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
        },
      },
      []
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
