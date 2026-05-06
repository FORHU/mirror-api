import { Socket } from "socket.io";
import { registerKioskEvents } from "./kiosk.events";

export const registerAllEvents = (socket: Socket) => {
  registerKioskEvents(socket);
  
  // You can register more event handlers here later (e.g., chat.events.ts, tryon.events.ts)
};
