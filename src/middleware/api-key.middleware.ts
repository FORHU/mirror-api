import { Request, Response, NextFunction } from "express";
import { THIRD_PARTY_API_KEY } from "../config";
import { responseError } from "../helpers/response.helper";
import logger from "../utils/logger";

export const authenticateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    logger.warn(`[ApiKeyAuth] Missing API key for request to ${req.path}`);
    return responseError(res, 401, "API key is required");
  }

  if (apiKey !== THIRD_PARTY_API_KEY || THIRD_PARTY_API_KEY === "") {
    logger.warn(`[ApiKeyAuth] Invalid API key used for request to ${req.path}`);
    return responseError(res, 403, "Invalid API key");
  }

  // Optional: If valid, you can attach an indicator to the request object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).isThirdParty = true;

  next();
};
