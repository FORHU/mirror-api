import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    status: 'error',
    statusCode: status,
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
