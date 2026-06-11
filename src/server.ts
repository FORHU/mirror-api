import dotenv from "dotenv";
dotenv.config({ override: true });

import http from "http";
import app from "./app";
import logger from "./utils/logger";
import setup from "./setup";
import { PORT, NODE_ENV, S3_CDN_URL, S3_BUCKET_NAME } from "./config";
import { initSocketServer } from "./utils/socket.util";

async function start() {
  await setup();

  const server = http.createServer(app);
  await initSocketServer(server);

  server.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT} in ${NODE_ENV} mode`);
    logger.info(
      `[boot] S3_BUCKET_NAME=${S3_BUCKET_NAME || "(empty)"}  S3_CDN_URL=${S3_CDN_URL || "(empty)"}`
    );
  });
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err?.message || err}`);
  process.exit(1);
});
