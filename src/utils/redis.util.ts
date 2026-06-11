import { createClient, RedisClientType } from "redis";
import { REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_TLS } from "../config";
import logger from "./logger";

export default class RedisUtil {
  static client: RedisClientType;

  static async initialize() {
    this.client = createClient({
      ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        ...(REDIS_TLS ? { tls: true as const } : {}),
      },
    }) as RedisClientType;

    this.client.on("error", (err) => logger.error(`Redis Client Error: ${(err as Error).message}`));

    await this.client.connect();
    logger.info(`[Redis] Connected to ${REDIS_HOST}:${REDIS_PORT}`);
  }

  /**
   * Get duplicate clients for Socket.IO Redis Adapter
   */
  static getAdapterClients() {
    const pubClient = createClient({
      ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        ...(REDIS_TLS ? { tls: true as const } : {}),
      },
    });
    const subClient = pubClient.duplicate();
    return { pubClient, subClient };
  }

  /**
   * Simple fixed-window rate limiter
   */
  static async isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const count = await this.client.incr(`ratelimit:${key}`);
    if (count === 1) await this.client.expire(`ratelimit:${key}`, windowSeconds);
    return count > limit;
  }
}
