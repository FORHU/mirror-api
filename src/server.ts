import dotenv from 'dotenv';
import app from './app';
import logger from './utils/logger';
import { PORT, NODE_ENV } from './config';

dotenv.config();

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT} in ${NODE_ENV} mode`);
});
