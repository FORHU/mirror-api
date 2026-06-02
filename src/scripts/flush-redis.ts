import CacheUtil from "../utils/cache.util";
import RedisUtil from "../utils/redis.util";

async function run() {
  await RedisUtil.initialize();
  await CacheUtil.flushAll();
  console.log("Redis cache flushed successfully!");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
