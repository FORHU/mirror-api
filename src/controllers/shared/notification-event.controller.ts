import { Request, Response, NextFunction } from "express";
import { io } from "../../utils/socket.util";
import { responseError, responseSuccess } from "helpers/response.helper";

export default class NotificationEventController {

    static async sendNotification(req: Request, res: Response, next: NextFunction) {
        try {
            const { data } = req.body;
            const userId = req.params.userId;
            if (io) {
                // Assuming each user joins a room named `user:${userId}`
                io.to(`user:${userId}`).emit("profile_updated", data);
            }
            return responseSuccess(res, 200, data, "Profile updated successfully");
        } catch (emitErr: any) {
            // Log but do not fail the request
            console.error("Failed to emit profile_updated event", emitErr);
            return responseError(res, emitErr.status || 500, emitErr.message || "Failed to emit profile_updated event");
        }
    }

};