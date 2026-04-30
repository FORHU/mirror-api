import logger from "./utils/logger";
import RedisUtil from "./utils/redis.util";

/**
 * Initial setup logic for the application
 */
export default async function setup() {
  logger.info("Running initial application setup...");
  
  // Initialize Redis
  await RedisUtil.initialize();
  
  logger.info("Setup completed.");
}
