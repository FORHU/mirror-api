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
   * Companion sends a generic notification to a paired kiosk (e.g. route change, trigger action).
   */
  socket.on(
    "send_kiosk_notification",
    async (payload: { kioskId: string; [key: string]: any }) => {
      const { kioskId } = payload;
      if (!kioskId) {
        logger.warn(`send_kiosk_notification received without kioskId from socket ${socket.id}`);
        return;
      }
      try {
        emitToKiosk(kioskId, "kiosk_notification", payload);
        logger.info(`Companion notification forwarded to kiosk ${kioskId}`);
      } catch (err) {
        logger.error(`Failed to forward companion notification to kiosk ${kioskId}:`, err);
      }
    }
  );
};
