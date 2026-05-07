import { Socket } from "socket.io";
import logger from "../utils/logger";
import CacheUtil from "../utils/cache.util";

export const registerKioskEvents = (socket: Socket) => {
  // Kiosk connects and registers its ID
  socket.on("register_kiosk", async (data: { kioskId: string, name?: string }) => {
    if (!data.kioskId) return;

    socket.join(data.kioskId);
    logger.info(`Kiosk ${data.kioskId} registered with socket ${socket.id}`);

    // Check if there is an existing state (to preserve names/data)
    const existingState = await CacheUtil.get<any>(`kiosk_state:${data.kioskId}`);

    // Set state in Redis
    await CacheUtil.set(`kiosk_state:${data.kioskId}`, {
      status: existingState?.status === "in_use" ? "in_use" : "available",
      userId: existingState?.userId || null,
      kioskName: data.name || existingState?.kioskName || data.kioskId,
      socketId: socket.id,
      lastRegisteredAt: new Date(),
    });
    
    // Map socket.id to kioskId so we can clean up on disconnect
    await CacheUtil.set(`socket_to_kiosk:${socket.id}`, data.kioskId);

    socket.emit("kiosk_registered", { 
      status: "success", 
      kioskId: data.kioskId,
      kioskName: data.name || existingState?.kioskName || data.kioskId
    });
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
