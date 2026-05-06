import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import logger from "./utils/logger";
import setup from "./setup";
import { PORT, NODE_ENV } from "./config";
import { initSocketServer } from "./utils/socket.util";

async function start() {
  await setup();
  
  const server = http.createServer(app);
  await initSocketServer(server);

  server.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT} in ${NODE_ENV} mode`);
  });
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err?.message || err}`);
  process.exit(1);
});
