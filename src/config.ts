import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 3002;
export const NODE_ENV = process.env.NODE_ENV || "development";

export const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "access-secret";
export const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || "refresh-secret";
export const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRY || "1d";
export const REFRESH_TOKEN_EXPIRY = "7d";

export const DATABASE_URL = process.env.DATABASE_URL;

export const REDIS_HOST = process.env.REDIS_HOST || "localhost";
export const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379");
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
export const REDIS_TTL_SECONDS = parseInt(process.env.REDIS_TTL_SECONDS || "3600");

export const isDev = NODE_ENV === "development";
