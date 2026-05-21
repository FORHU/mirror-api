import { Socket } from "socket.io";
import logger from "../utils/logger";

export const registerNotification = (socket: Socket) => {
  // Client should emit this after authenticating to receive personal notifications
  socket.on("register_user", async (data: { userId: string }) => {
    if (!data?.userId) {
      logger.warn(`register_user called without userId from socket ${socket.id}`);
      return;
    }
    const room = `user:${data.userId}`;
    socket.join(room);
    logger.info(`Socket ${socket.id} joined user room ${room}`);
  });
};
