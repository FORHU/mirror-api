/**
 * Throws an error shaped for the global error middleware, which renders
 * it as `{ status: "error", statusCode, message, ...extra }`.
 *
 * Usage:
 *   throwResponse(400, "Invalid input");
 *   throwResponse(409, "Already exists", { existingId: "abc" });
 */
export function throwResponse(
  status: number,
  message: string,
  extra?: Record<string, unknown>
): never {
  throw { status, message, ...(extra || {}) };
}
