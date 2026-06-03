import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import logger from "./logger";
import { registerAllEvents } from "../events";
import RedisUtil from "./redis.util";

export let io: SocketIOServer;

export const initSocketServer = async (httpServer: HttpServer) => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Initialize Redis Adapter for horizontal scaling
  const { pubClient, subClient } = RedisUtil.getAdapterClients();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  logger.info("Redis adapter initialized for Socket.IO");

  io.on("connection", (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Register all socket event handlers
    registerAllEvents(socket);
  });

  logger.info("Socket.io server initialized");
  return io;
};

/**
 * Helper to emit events to a specific kiosk room
 *
 * TEMP (kiosk removed 2026-06-03): kiosk frontend is gone and the companion
 * app does not use websockets, so these emits go to nobody. Disabled for now
 * rather than deleted — restore the body if kiosk/websocket delivery returns.
 */
export const emitToKiosk = (_kioskId: string, _event: string, _data: unknown) => {
  // if (io) {
  //   io.to(kioskId).emit(event, data);
  // }
};

/**
 * Helper to emit events to a specific companion (mobile app) via user room.
 * Companion must join `user:${userId}` room on connect via `register_user` event.
 */
export const notifyCompanion = (userId: string, event: string, data: unknown) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

/**
 * Disconnect all active sockets
 */
export const disconnectAll = () => {
  if (io) {
    io.disconnectSockets(true);
    logger.info("All active sockets have been forcefully disconnected");
  }
};
