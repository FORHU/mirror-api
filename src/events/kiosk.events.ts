import { Socket } from "socket.io";
import logger from "../utils/logger";
import CacheUtil from "../utils/cache.util";
import { KIOSK_DEVICE_SECRET, ACCESS_TOKEN_SECRET } from "../config";
import jwt from "jsonwebtoken";

// Long enough to outlast any realistic session, short enough that crashed
// processes can't leak locks forever. Refreshed every time the kiosk re-registers.
const KIOSK_STATE_TTL_SECONDS = 60 * 60 * 24; // 24h

export const registerKioskEvents = (socket: Socket) => {
  // Kiosk connects and registers its ID
  socket.on("register_kiosk", async (data: { kioskId: string; name?: string; secret?: string }) => {
    if (!data.kioskId) return;

    // Reject unverified devices — prevents arbitrary sockets from claiming kiosk rooms.
    if (!KIOSK_DEVICE_SECRET) {
      logger.error(
        `[register_kiosk] KIOSK_DEVICE_SECRET not configured — rejecting ${data.kioskId}`
      );
      socket.emit("kiosk_registered", { status: "error", message: "Server misconfigured" });
      return;
    }
    if (data.secret !== KIOSK_DEVICE_SECRET) {
      logger.warn(
        `[register_kiosk] Rejected unauthorized registration for ${data.kioskId} (socket ${socket.id})`
      );
      socket.emit("kiosk_registered", { status: "error", message: "Invalid kiosk secret" });
      socket.disconnect(true);
      return;
    }

    socket.join(data.kioskId);
    logger.info(`Kiosk ${data.kioskId} registered with socket ${socket.id}`);

    // Check if there is an existing state (to preserve names/data)
    const existingState = await CacheUtil.get<{
      status: string;
      userId: string;
      kioskName: string;
    }>(`kiosk_state:${data.kioskId}`);

    // Set state in Redis with a bounded TTL — if disconnect ever fails to fire
    // (process crash, network partition), the lock auto-releases instead of leaking.
    await CacheUtil.set(
      `kiosk_state:${data.kioskId}`,
      {
        status: existingState?.status === "in_use" ? "in_use" : "available",
        userId: existingState?.userId || null,
        kioskName: data.name || existingState?.kioskName || data.kioskId,
        socketId: socket.id,
        lastRegisteredAt: new Date(),
      },
      KIOSK_STATE_TTL_SECONDS
    );

    // Map socket.id to kioskId so we can clean up on disconnect
    await CacheUtil.set(`socket_to_kiosk:${socket.id}`, data.kioskId, KIOSK_STATE_TTL_SECONDS);

    socket.emit("kiosk_registered", {
      status: "success",
      kioskId: data.kioskId,
      kioskName: data.name || existingState?.kioskName || data.kioskId,
    });
  });

  /**
   * Remote app joins a kiosk room to receive real-time updates.
   * Call this after pairing via REST.
   */
  socket.on("join_kiosk_room", async (data: { kioskId: string; token: string }) => {
    try {
      const { kioskId, token } = data;
      if (!kioskId || !token) return;

      // Verify token
      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as { userId: string };
      const userId = decoded.userId;

      // Verify pairing state in Redis
      const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
        `kiosk_state:${kioskId}`
      );
      if (state && state.userId === userId) {
        socket.join(kioskId);
        logger.info(`Socket ${socket.id} (User ${userId}) joined room ${kioskId}`);
        socket.emit("room_joined", { kioskId, status: "success" });
      } else {
        socket.emit("room_joined", { status: "error", message: "Not paired with this kiosk" });
      }
    } catch (err) {
      socket.emit("room_joined", { status: "error", message: "Authentication failed" });
    }
  });

  // Handle Kiosk disconnect
  socket.on("disconnect", async () => {
    logger.info(`Socket disconnected: ${socket.id}`);

    // Find which kiosk this socket belonged to
    const kioskId = await CacheUtil.get<string>(`socket_to_kiosk:${socket.id}`);

    if (kioskId) {
      logger.info(`Cleaning up Redis state for Kiosk ${kioskId}`);
      await CacheUtil.del(`kiosk_state:${kioskId}`);
      await CacheUtil.del(`socket_to_kiosk:${socket.id}`);
    }
  });
};
