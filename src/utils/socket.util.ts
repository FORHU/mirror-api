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
 */
export const emitToKiosk = (kioskId: string, event: string, data: any) => {
  if (io) {
    io.to(kioskId).emit(event, data);
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
