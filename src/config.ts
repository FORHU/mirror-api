import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 3007;
export const NODE_ENV = process.env.NODE_ENV || "development";

export const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "access-secret";
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "refresh-secret";
export const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || "1d";
export const REFRESH_TOKEN_EXPIRY = "7d";

export const DATABASE_URL = process.env.DATABASE_URL;

export const REDIS_HOST = process.env.REDIS_HOST || "localhost";
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6377");
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
export const REDIS_TTL_SECONDS = parseInt(process.env.REDIS_TTL_SECONDS || "3600");

export const AWS_REGION = process.env.AWS_REGION || "ap-southeast-1";
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";
export const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET_NAME || "";
export const S3_CDN_URL = process.env.S3_CDN_URL || "";

export const FASHN_API_KEY = process.env.FASHN_API_KEY || "";
export const FASHN_BASE_URL = process.env.FASHN_BASE_URL || "https://api.fashn.ai/v1";

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const CHAT_WONDER_API_URL = process.env.CHAT_WONDER_API_URL || "";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

export const isDev = NODE_ENV === "development";
