import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import CacheUtil from "../../utils/cache.util";
import { emitToKiosk, disconnectAll } from "../../utils/socket.util";
import logger from "../../utils/logger";
import { isDev } from "../../config";

const validationError = (message: string) => ({ status: 400, message });

export default class KioskController {
  /**
   * Phone connects to Kiosk
   */
  static async connect(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      kioskId: Joi.string().required(),
      kioskName: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const kioskStateKey = `kiosk_state:${value.kioskId}`;
      let state = await CacheUtil.get<any>(kioskStateKey);

      if (!state) {
        if (isDev) {
          // In development, if the kiosk isn't online, create a dummy state so pairing can proceed
          logger.info(`[DevMode] Creating dummy state for kiosk ${value.kioskId}`);
          state = {
            status: "available",
            userId: null,
            kioskName: value.kioskName || value.kioskId,
            socketId: null, // No active socket
          };
        } else {
          return res.status(404).json({ status: "error", message: "Kiosk not found or offline" });
        }
      }

      if (state.status === "in_use" && state.userId !== userId) {
        return res.status(409).json({ status: "error", message: "Kiosk not currently available" });
      }

      // Lock it for this user
      await CacheUtil.set(kioskStateKey, {
        ...state,
        status: "in_use",
        userId,
        kioskName: value.kioskName || state.kioskName, // Persist the name if provided
      });

      // Notify the Kiosk that it has been paired
      emitToKiosk(value.kioskId, "kiosk_paired", { 
        userId, 
        kioskName: value.kioskName || state.kioskName 
      });

      logger.info(`User ${userId} paired with Kiosk ${value.kioskId}`);

      return res.json({
        status: "success",
        message: "Successfully paired with kiosk",
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phone disconnects from Kiosk
   */
  static async disconnect(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      kioskId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const kioskStateKey = `kiosk_state:${value.kioskId}`;
      const state = await CacheUtil.get<any>(kioskStateKey);

      if (state && state.userId === userId) {
        // Unlock it
        await CacheUtil.set(kioskStateKey, {
          ...state,
          status: "available",
          userId: null,
        });

        // Notify Kiosk
        emitToKiosk(value.kioskId, "kiosk_unpaired", { userId });
      }

      return res.json({
        status: "success",
        message: "Disconnected from kiosk",
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phone sends a command to the Kiosk
   */
  static async sendCommand(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      kioskId: Joi.string().required(),
      action: Joi.string().required(),
      payload: Joi.any().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const state = await CacheUtil.get<any>(`kiosk_state:${value.kioskId}`);

      // Ensure the user actually owns the lock
      if (!state || state.userId !== userId) {
        return res.status(403).json({ status: "error", message: "Not paired with this kiosk" });
      }

      // Forward command via WebSocket
      emitToKiosk(value.kioskId, "kiosk_command", {
        action: value.action,
        payload: value.payload,
      });

      return res.json({
        status: "success",
        message: "Command sent to kiosk",
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Phone notifies Kiosk that it has been scanned
   */
  static async notifyScanning(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      kioskId: Joi.string().required(),
      kioskName: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      let state = await CacheUtil.get<any>(`kiosk_state:${value.kioskId}`);

      if (!state) {
        if (isDev) {
          logger.info(`[DevMode] Creating dummy state for notifyScanning: ${value.kioskId}`);
          state = {
            status: "available",
            userId: null,
            kioskName: value.kioskName || value.kioskId,
            socketId: null,
          };
        } else {
          return res.status(404).json({ status: "error", message: "Kiosk not found or offline" });
        }
      }

      // Save the name to state for the rest of the session
      await CacheUtil.set(`kiosk_state:${value.kioskId}`, {
        ...state,
        kioskName: value.kioskName || state.kioskName || value.kioskId,
        lastScannedAt: new Date(),
      });

      // Notify the Kiosk that it has been scanned
      emitToKiosk(value.kioskId, "kiosk_scanning", { 
        status: "pending_login",
        kioskName: value.kioskName || state.kioskName || value.kioskId 
      });

      logger.info(`Kiosk ${value.kioskId} notified of scan`);

      return res.json({
        status: "success",
        message: "Kiosk notified of scan",
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Reset everything: Clear Redis states and disconnect all sockets
   */
  static async clearAll(req: Request, res: Response, next: NextFunction) {
    try {
      await CacheUtil.delByPattern("kiosk_state:*");
      await CacheUtil.delByPattern("socket_to_kiosk:*");
      disconnectAll();

      return res.json({
        status: "success",
        message: "All kiosk states cleared and sockets disconnected",
      });
    } catch (err) {
      next(err);
    }
  }
}
