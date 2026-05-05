import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import logger from "./utils/logger";
import setup from "./setup";
import { PORT, NODE_ENV } from "./config";

async function start() {
  await setup();
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT} in ${NODE_ENV} mode`);
  });
}

start().catch((err) => {
  logger.error(`Failed to start server: ${err?.message || err}`);
  process.exit(1);
});
