import { Socket } from "socket.io";
import { registerTryOnEvents } from "./tryon.events";

import { registerCompanionEvents } from "./companion.events";

export const registerAllEvents = (socket: Socket) => {
  registerTryOnEvents(socket);

  registerCompanionEvents(socket);
};
