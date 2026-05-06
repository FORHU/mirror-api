import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import CacheUtil from "../utils/cache.util";
import { emitToKiosk } from "../utils/socket.util";
import logger from "../utils/logger";

const validationError = (message: string) => ({ status: 400, message });

export default class KioskController {
  /**
   * Phone connects to Kiosk
   */
  static async connect(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      kioskId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as any).user.id;
      const kioskStateKey = `kiosk_state:${value.kioskId}`;
      const state = await CacheUtil.get<any>(kioskStateKey);

      if (!state) {
        return res.status(404).json({ status: "error", message: "Kiosk not found or offline" });
      }

      if (state.status === "in_use" && state.userId !== userId) {
        return res.status(409).json({ status: "error", message: "Kiosk not currently available" });
      }

      // Lock it for this user
      await CacheUtil.set(kioskStateKey, {
        ...state,
        status: "in_use",
        userId,
      });

      // Notify the Kiosk that it has been paired
      emitToKiosk(value.kioskId, "kiosk_paired", { userId });

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
}
