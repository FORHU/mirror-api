import { Socket } from "socket.io";
// TEMP (kiosk removed 2026-06-03): kiosk socket handlers disabled — no kiosk client connects.
// import { registerKioskEvents } from "./kiosk.events";
import { registerTryOnEvents } from "./tryon.events";
import { registerCompanionEvents } from "./companion.events";

export const registerAllEvents = (socket: Socket) => {
  // registerKioskEvents(socket);
  registerTryOnEvents(socket);
  registerCompanionEvents(socket);
};
