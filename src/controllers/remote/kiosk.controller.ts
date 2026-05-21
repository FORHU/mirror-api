import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import CacheUtil from "../../utils/cache.util";
import { emitToKiosk, disconnectAll } from "../../utils/socket.util";
import logger from "../../utils/logger";
import { responseSuccess, responseError } from "../../helpers/response.helper";

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
      const userId = (req as Request & { user: { id: string } }).user.id;
      const kioskStateKey = `kiosk_state:${value.kioskId}`;
      const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
        kioskStateKey
      );

      if (!state) {
        return responseError(res, 404, "Kiosk not found or offline");
      }

      if (state.status === "in_use" && state.userId !== userId) {
        return responseError(res, 409, "Kiosk not currently available");
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
        kioskName: value.kioskName || state.kioskName,
      });

      logger.info(`User ${userId} paired with Kiosk ${value.kioskId}`);

      return responseSuccess(res, 200, null, "Successfully paired with kiosk");
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
      const userId = (req as Request & { user: { id: string } }).user.id;
      const kioskStateKey = `kiosk_state:${value.kioskId}`;
      const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
        kioskStateKey
      );

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

      return responseSuccess(res, 200, null, "Disconnected from kiosk");
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
      const userId = (req as Request & { user: { id: string } }).user.id;
      const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
        `kiosk_state:${value.kioskId}`
      );

      // Ensure the user actually owns the lock
      if (!state || state.userId !== userId) {
        return responseError(res, 403, "Not paired with this kiosk");
      }

      // Forward command via WebSocket
      emitToKiosk(value.kioskId, "kiosk_command", {
        action: value.action,
        payload: value.payload,
      });

      return responseSuccess(res, 200, null, "Command sent to kiosk");
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
      const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
        `kiosk_state:${value.kioskId}`
      );

      if (!state) {
        return responseError(res, 404, "Kiosk not found or offline");
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
        kioskName: value.kioskName || state.kioskName || value.kioskId,
      });

      logger.info(`Kiosk ${value.kioskId} notified of scan`);

      return responseSuccess(res, 200, null, "Kiosk notified of scan");
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

      return responseSuccess(res, 200, null, "All kiosk states cleared and sockets disconnected");
    } catch (err) {
      next(err);
    }
  }
}
