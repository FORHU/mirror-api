import { Socket } from "socket.io";
import TryOnService from "../services/mirror/tryOn.service";
import CacheUtil from "../utils/cache.util";
import logger from "../utils/logger";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_SECRET } from "../config";

export const registerTryOnEvents = (socket: Socket) => {
  /**
   * Remote triggers a try-on
   * Payload: {
   *   type: 'garment' | 'outfit',
   *   id: string,
   *   modelImage?: string,
   *   kioskId: string,
   *   token: string // Auth token from mobile app
   * }
   */
  socket.on(
    "tryon_request",
    async (data: {
      type: string;
      id: string;
      modelImage?: string;
      kioskId: string;
      token: string;
    }) => {
      try {
        const { type, id, modelImage, kioskId, token } = data;

        if (!type || !id || !kioskId || !token) {
          socket.emit("tryon_failed", {
            error: "Missing required fields: type, id, kioskId, or token",
          });
          return;
        }

        // 1. Verify Authentication
        let userId: string;
        try {
          const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as { userId: string };
          userId = decoded.userId;
        } catch {
          socket.emit("tryon_failed", { error: "Invalid authentication token" });
          return;
        }

        // 2. Verify Pairing
        const kioskStateKey = `kiosk_state:${kioskId}`;
        const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
          kioskStateKey
        );

        if (!state || state.status !== "in_use" || state.userId !== userId) {
          socket.emit("tryon_failed", { error: "Not paired with this kiosk or kiosk is offline" });
          return;
        }

        logger.info(
          `[Socket] User ${userId} requested try-on for ${type} ${id} on kiosk ${kioskId}`
        );

        // 3. Trigger Try-On
        let result;
        if (type === "garment") {
          result = await TryOnService.runByGarment(userId, id, modelImage, kioskId);
        } else if (type === "outfit") {
          result = await TryOnService.runByOutfit(userId, id, modelImage, kioskId);
        } else {
          socket.emit("tryon_failed", {
            error: "Invalid try-on type. Must be 'garment' or 'outfit'",
          });
          return;
        }

        // 4. Notify requester of success (optional, as they will also get tryon_progress via the room)
        socket.emit("tryon_requested", { predictionId: result.predictionId });
      } catch {
        logger.error(`[Socket] Try-on request failed: ${(err as Error).message}`);
        socket.emit("tryon_failed", {
          error: (err as Error).message || "Failed to start try-on process",
        });
      }
    }
  );
};
