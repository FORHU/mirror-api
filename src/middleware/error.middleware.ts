import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { isDev } from "../config";

export const errorHandler = (
  err: { status?: number; message?: string; stack?: string },
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error(
    `${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`
  );

  const status = err.status || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({
    status: "error",
    statusCode: status,
    message,
    ...(isDev && { stack: err.stack }),
  });
};
