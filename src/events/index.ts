import { Socket } from "socket.io";
import { registerKioskEvents } from "./kiosk.events";
import { registerTryOnEvents } from "./tryon.events";

export const registerAllEvents = (socket: Socket) => {
  registerKioskEvents(socket);
  registerTryOnEvents(socket);
};
