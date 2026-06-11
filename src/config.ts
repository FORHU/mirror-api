import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 3007;
export const NODE_ENV = process.env.NODE_ENV || "development";

export const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "access-secret";
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "refresh-secret";
export const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || "120d";
export const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || "240d";

export const DATABASE_URL = process.env.DATABASE_URL;

export const REDIS_HOST = process.env.REDIS_HOST || "localhost";
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6380");
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
export const REDIS_TLS = process.env.REDIS_TLS === "true";
export const REDIS_TTL_SECONDS = parseInt(process.env.REDIS_TTL_SECONDS || "3600");

export const AWS_REGION = process.env.AWS_REGION || "ap-southeast-1";
export const AWS_VOICE_REGION = process.env.AWS_VOICE_REGION || AWS_REGION;
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";
export const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET_NAME || "";
export const S3_CDN_URL = process.env.S3_CDN_URL || "";

export const FASHN_API_KEY = process.env.FASHN_API_KEY || "";
export const FASHN_BASE_URL = process.env.FASHN_BASE_URL || "https://api.fashn.ai/v1";
// FASHN model identifier for image try-on. Defaults to "tryon-max" for Try-On Max.
export const FASHN_MODEL = process.env.FASHN_MODEL || "tryon-max";
// FASHN model identifier for video try-on. Set from your FASHN dashboard;
export const FASHN_VIDEO_MODEL = process.env.FASHN_VIDEO_MODEL || "";

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const CHAT_WONDER_API_URL = process.env.CHAT_WONDER_API_URL || "";

export const YOUCAM_API_KEY = process.env.YOUCAM_API_KEY || "";
export const YOUCAM_API_URL =
  process.env.YOUCAM_API_URL || "https://api.perfectcorp.com/s2b/v1.0/image/async/eai";

// Shared secret kiosk devices must present when calling `register_kiosk` over the socket.
export const KIOSK_DEVICE_SECRET = process.env.KIOSK_DEVICE_SECRET || "";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

export const MAPBOX_SECRET_TOKEN = process.env.MAPBOX_SECRET_TOKEN || "";
export const ORS_API_KEY = process.env.ORS_API_KEY || "";

export const THIRD_PARTY_API_KEY = process.env.THIRD_PARTY_API_KEY || "";

export const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

export const isDev = NODE_ENV === "development";

// Toggle: false = use mock skin-analysis data + ChatWonder suggestions
//         true  = call real PerfectCorp/YouCam skin-analysis API + ChatWonder suggestions
export const SKIN_ANALYSIS_ENABLED = process.env.SKIN_ANALYSIS_ENABLED === "true";

export type SkinType = "OILY" | "DRY" | "COMBINATION" | "NORMAL" | "SENSITIVE";

// Shape consumed by the skin-analysis service (mirrors parsePerfectCorpEntry output).
// Declared as a type alias (not an interface) so it carries an implicit index
// signature and stays assignable to Prisma's JSON input types.
export type SkinVision = {
  skinType: SkinType;
  skinTone: string;
  hydrationPct: number;
  oilinessPct: number;
  concerns: string[];
  routineTip: string;
  overallScore: number;
  skinAge: number | null;
  rawScores: Record<string, number>;
};

// Pre-built mock skin-analysis results used when SKIN_ANALYSIS_ENABLED=false
// (or as a fallback when the real YouCam call fails). Kept as an in-memory
// constant — the service picks a random entry per scan, so no file I/O or
// parsing is needed for mock data.
export const SKIN_ANALYSIS_MOCK_DATA: SkinVision[] = [
  {
    skinType: "OILY",
    skinTone: "Natural",
    hydrationPct: 55,
    oilinessPct: 78,
    concerns: ["Oiliness", "Enlarged pores"],
    routineTip:
      "Use oil-free, mattifying products. Add a BHA toner to minimise pores and control shine.",
    overallScore: 72,
    skinAge: 26,
    rawScores: { oiliness: 78, pore: 64, acne: 45, moisture: 45, redness: 30, wrinkle: 20 },
  },
  {
    skinType: "DRY",
    skinTone: "Natural",
    hydrationPct: 38,
    oilinessPct: 22,
    concerns: ["Mild dehydration", "Fine lines / wrinkles"],
    routineTip:
      "Focus on ceramide-rich moisturisers and hydrating serums. Avoid harsh stripping cleansers.",
    overallScore: 70,
    skinAge: 31,
    rawScores: { oiliness: 22, moisture: 62, wrinkle: 61, redness: 25, pore: 30 },
  },
  {
    skinType: "COMBINATION",
    skinTone: "Natural",
    hydrationPct: 48,
    oilinessPct: 58,
    concerns: ["Oiliness", "Mild dehydration"],
    routineTip:
      "Apply a lightweight gel moisturiser on the T-zone and a richer formula on dry patches.",
    overallScore: 75,
    skinAge: 28,
    rawScores: { oiliness: 58, moisture: 52, pore: 50, acne: 40 },
  },
  {
    skinType: "NORMAL",
    skinTone: "Natural",
    hydrationPct: 62,
    oilinessPct: 45,
    concerns: ["General maintenance"],
    routineTip: "Maintain your routine with a gentle cleanser, daily SPF, and a hydrating serum.",
    overallScore: 84,
    skinAge: 24,
    rawScores: { oiliness: 45, moisture: 38, redness: 20, pore: 28 },
  },
  {
    skinType: "SENSITIVE",
    skinTone: "Natural",
    hydrationPct: 50,
    oilinessPct: 40,
    concerns: ["Redness / sensitivity"],
    routineTip:
      "Choose fragrance-free, calming formulas with centella or oat extract to ease redness.",
    overallScore: 68,
    skinAge: 29,
    rawScores: { redness: 74, oiliness: 40, moisture: 50, acne: 35 },
  },
];

// PostgreSQL (raw pg client — used by chatwonder-map script)
export const PG_HOST = process.env.PG_HOST || "localhost";
export const PG_PORT = Number(process.env.PG_PORT || 5440);
export const PG_USER = process.env.PG_USER || "admin";
export const PG_PASSWORD = process.env.PG_PASSWORD || "mypassword";
export const PG_DB = process.env.PG_DB || "mirror_db";

// Server reload triggered to pick up new ORS_API_KEY
