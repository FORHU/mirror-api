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
   * Companion joins the kiosk room so it can receive companion_notification
   * broadcasts that originate from the Mirror (send_companion_notification).
   * Must be called after the user has paired with the kiosk.
   */
  socket.on("join_kiosk_room", (data: { kioskId: string }) => {
    if (!data?.kioskId) {
      logger.warn(`join_kiosk_room called without kioskId from socket ${socket.id}`);
      return;
    }
    socket.join(data.kioskId);
    logger.info(`Companion socket ${socket.id} joined kiosk room ${data.kioskId}`);
    socket.emit("kiosk_room_joined", { kioskId: data.kioskId, status: "success" });
  });

  /**
   * Companion sends a generic notification to a paired kiosk (e.g. route change, trigger action).
   */
  socket.on(
    "send_kiosk_notification",
    async (payload: { kioskId: string; [key: string]: unknown }) => {
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
