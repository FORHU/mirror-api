import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";
import { isDev } from "../config";

export const errorHandler = (
  err: { status?: number; message?: string; stack?: string; field?: string; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = err.status || (err.code?.startsWith("LIMIT_") ? 400 : 500);
  const message = err.field
    ? `${err.message} (field: "${err.field}")`
    : err.message || "Internal Server Error";

  logger.error(`${status} - ${message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);

  res.status(status).json({
    status: "error",
    statusCode: status,
    message,
    ...(isDev && { stack: err.stack }),
  });
};
