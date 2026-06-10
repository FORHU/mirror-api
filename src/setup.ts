import logger from "./utils/logger";
import RedisUtil from "./utils/redis.util";

/**
 * Initial setup logic for the application
 */
export default async function setup() {
  logger.info("Running initial application setup...");

  // Initialize Redis — non-blocking: server starts even if Redis is unavailable
  await RedisUtil.initialize().catch((err: Error) =>
    logger.warn(`[Redis] Unavailable, caching and rate-limiting disabled: ${err.message}`)
  );

  logger.info("Setup completed.");
}
