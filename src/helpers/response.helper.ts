import { Response } from "express";

/**
 * Two-function response helper. Every controller should send either
 * `responseSuccess` (any 2xx) or `responseError` (any 4xx/5xx). Service-layer
 * code should keep using `throwResponse` from utils/throw-response so the
 * error middleware handles it.
 *
 * ── Success ─────────────────────────────────────────────────────────────
 *   responseSuccess(res, 200, garment);
 *   responseSuccess(res, 201, garment, "Garment created");
 *   responseSuccess(res, 202, { fileId }, "Upload received");
 *   responseSuccess(res, 200, pageFromRepo(result));   // paginated lists
 *
 *   Shape: { status, statusCode, data, message? }
 *
 * ── Error ───────────────────────────────────────────────────────────────
 *   responseError(res, 400, "Invalid input");
 *   responseError(res, 404, "Garment not found");
 *   responseError(res, 409, "Already exists", { code: "OUTFIT_DUP", details: { existingId } });
 *
 *   Shape: { status, statusCode, message, code?, details? }
 */

export type SuccessStatus = 200 | 201 | 202 | 204;
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

export type ApiResponse<T> = {
  status: "success";
  statusCode: SuccessStatus;
  data: T;
  message?: string;
};

export type ApiError = {
  status: "error";
  statusCode: ErrorStatus;
  message: string;
  code?: string;
  details?: unknown;
};

export function responseSuccess<T>(
  res: Response,
  statusCode: SuccessStatus,
  data: T,
  message?: string,
) {
  const body: ApiResponse<T> = {
    status: "success",
    statusCode,
    data,
    ...(message && { message }),
  };
  return res.status(statusCode).json(body);
}

export function responseError(
  res: Response,
  statusCode: ErrorStatus,
  message: string,
  extra?: { code?: string; details?: unknown },
) {
  const body: ApiError = {
    status: "error",
    statusCode,
    message,
    ...(extra || {}),
  };
  return res.status(statusCode).json(body);
}
