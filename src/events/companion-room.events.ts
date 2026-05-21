import { Socket } from "socket.io";
import logger from "../utils/logger";

/**
 * Registers the `register_user` socket event.
 * The companion app emits this after connecting to join its personal room (`user:${userId}`).
 * This room is used by notifyCompanion() to push events to the companion.
 */
export const registerCompanionRoomEvents = (socket: Socket) => {
  socket.on("register_user", (data: { userId: string }) => {
    if (!data?.userId) {
      logger.warn(`register_user called without userId from socket ${socket.id}`);
      return;
    }
    const room = `user:${data.userId}`;
    socket.join(room);
    logger.info(`Socket ${socket.id} joined user room ${room}`);
  });
};
