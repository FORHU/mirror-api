import { createClient, RedisClientType } from "redis";
import { REDIS_HOST, REDIS_PASSWORD, REDIS_PORT } from "../config";

export default class RedisUtil {
  static client: RedisClientType;

  static async initialize() {
    this.client = createClient({
      password: REDIS_PASSWORD,
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
      },
    }) as RedisClientType;

    this.client.on("error", (err) => console.error("Redis Client Error", err));

    await this.client.connect();
    console.log(`[Redis] Connected to ${REDIS_HOST}:${REDIS_PORT}`);
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
