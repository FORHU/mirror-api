import { Request, Response } from "express";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import RedisUtil from "../utils/redis.util";
import { prisma } from "../utils/prisma";
import { s3Client } from "../utils/s3";
import {
  S3_BUCKET_NAME,
  FASHN_BASE_URL,
  FASHN_API_KEY,
  CHAT_WONDER_API_URL,
} from "../config";

type ServiceStatus = "ok" | "degraded" | "unavailable";

interface ServiceCheck {
  status: ServiceStatus;
  latencyMs?: number;
  error?: string;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function checkRedis(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    if (!RedisUtil.client?.isReady) throw new Error("Client not connected");
    await withTimeout(RedisUtil.client.ping(), 2000);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "unavailable", error: (err as Error).message };
  }
}

async function checkDatabase(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 3000);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "unavailable", error: (err as Error).message };
  }
}

async function checkS3(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    if (!S3_BUCKET_NAME) throw new Error("S3_BUCKET_NAME not configured");
    await withTimeout(
      s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET_NAME })),
      3000
    );
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "unavailable", error: (err as Error).message };
  }
}

async function checkFashn(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    if (!FASHN_API_KEY) throw new Error("FASHN_API_KEY not configured");
    const res = await withTimeout(
      fetch(`${FASHN_BASE_URL}/account`, {
        headers: { Authorization: `Bearer ${FASHN_API_KEY}` },
      }),
      3000
    );
    if (!res.ok && res.status !== 401)
      throw new Error(`HTTP ${res.status}`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "unavailable", error: (err as Error).message };
  }
}

async function checkChatWonder(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    if (!CHAT_WONDER_API_URL) throw new Error("CHAT_WONDER_API_URL not configured");
    const res = await withTimeout(
      fetch(`${CHAT_WONDER_API_URL}/health`, { method: "GET" }),
      3000
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "degraded", error: (err as Error).message };
  }
}

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const [redis, database, s3, fashn, chatWonder] = await Promise.all([
    checkRedis(),
    checkDatabase(),
    checkS3(),
    checkFashn(),
    checkChatWonder(),
  ]);

  const services = { redis, database, s3, fashn, chatWonder };

  const isCriticalDown = [redis, database, s3].some(
    (s) => s.status === "unavailable"
  );

  res.status(isCriticalDown ? 503 : 200).json({
    status: isCriticalDown ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    services,
  });
}
