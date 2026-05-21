import { Socket } from "socket.io";
import logger from "../utils/logger";
import { emitToKiosk } from "../utils/socket.util";


export const registerCompanionEvents = (socket: Socket) => {
  // Companion (e.g., mobile app) notifies the Mirror about an action.
  socket.on("companion_action", async (payload: { kioskId: string; data: any }) => {
    const { kioskId, data } = payload;
    if (!kioskId) {
      logger.warn(`companion_action received without kioskId from socket ${socket.id}`);
      return;
    }
    try {
      await emitToKiosk(kioskId, "kiosk_notification", data);
      logger.info(`Companion action forwarded to kiosk ${kioskId}`);
    } catch (err) {
      logger.error(`Failed to forward companion action to kiosk ${kioskId}:`, err);
    }
  });
};
