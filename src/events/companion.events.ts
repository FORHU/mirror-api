import { Socket } from "socket.io";
import logger from "../utils/logger";
import { emitToKiosk } from "../utils/socket.util";

export const registerCompanionEvents = (socket: Socket) => {
  /**
   * Companion joins its personal user room so the backend can push
   * notifications back via notifyCompanion(userId, event, data).
   */
  socket.on("register_user", (data: { userId: string }) => {
    if (!data?.userId) {
      logger.warn(`register_user called without userId from socket ${socket.id}`);
      return;
    }
    const room = `user:${data.userId}`;
    socket.join(room);
    logger.info(`Socket ${socket.id} joined user room ${room}`);
  });

  /**
   * Companion sends an action to a paired kiosk (e.g. outfit selection, try-on trigger).
   */
  socket.on("companion_action", async (payload: { kioskId: string; data: any }) => {
    const { kioskId, data } = payload;
    if (!kioskId) {
      logger.warn(`companion_action received without kioskId from socket ${socket.id}`);
      return;
    }
    try {
      emitToKiosk(kioskId, "kiosk_notification", data);
      logger.info(`Companion action forwarded to kiosk ${kioskId}`);
    } catch (err) {
      logger.error(`Failed to forward companion action to kiosk ${kioskId}:`, err);
    }
  });
};
