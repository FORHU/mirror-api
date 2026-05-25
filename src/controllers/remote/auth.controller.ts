import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import AuthSvc from "../../services/remote/auth.service";
import { emitToKiosk } from "../../utils/socket.util";
import { responseSuccess, responseError } from "../../helpers/response.helper";
import CacheUtil from "../../utils/cache.util";

const validationError = (message: string) => ({ status: 400, message });

export default class AuthController {
  /**
   * Login/Register with email only
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      username: Joi.string().optional(),
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const platform = req.headers["x-platform"] as string;

      if (value.kioskId) {
        const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
          `kiosk_state:${value.kioskId}`
        );

        if (!state) {
          return responseError(res, 404, "Kiosk not found or offline");
        }

        if (state.status === "in_use") {
          return responseError(res, 409, "Kiosk is already in use by another person");
        }
      }

      const data = await AuthSvc.login(value.email, platform, value.username);

      if (value.kioskId) {
        const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
          `kiosk_state:${value.kioskId}`
        );

        // Lock it
        if (state) {
          await CacheUtil.set(`kiosk_state:${value.kioskId}`, {
            ...state,
            status: "in_use",
            userId: data.user?.id || (data as any).id,
          });
        }

        emitToKiosk(value.kioskId, "kiosk_login", data);
        // Also fire setup_complete so the mirror knows to navigate into the app
      }

      return responseSuccess(res, 200, data, "Login successful");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Google SSO Authentication
   */
  static async googleAuthSSO(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      idToken: Joi.string().required(),
      kioskId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      if (value.kioskId) {
        const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
          `kiosk_state:${value.kioskId}`
        );

        if (!state) {
          return responseError(res, 404, "Kiosk not found or offline");
        }

        if (state.status === "in_use") {
          return responseError(res, 409, "Kiosk is already in use by another person");
        }
      }

      const data = await AuthSvc.googleAuthSSO(value.idToken);

      // If a kioskId was provided during Google login, notify that Kiosk
      if (value.kioskId) {
        const state = await CacheUtil.get<{ status: string; userId: string; kioskName: string }>(
          `kiosk_state:${value.kioskId}`
        );

        // Lock it
        if (state) {
          await CacheUtil.set(`kiosk_state:${value.kioskId}`, {
            ...state,
            status: "in_use",
            userId: data.user?.id || (data as any).id,
          });
        }

        emitToKiosk(value.kioskId, "kiosk_login", data);
      }

      return responseSuccess(res, 200, data, "Google login successful");
    } catch (err) {
      next(err);
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      refreshToken: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await AuthSvc.refreshToken(value.refreshToken);
      return responseSuccess(res, 200, data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Logout
   */
  static async logout(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      refreshToken: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const data = await AuthSvc.logout(userId as string, value.refreshToken);
      return responseSuccess(res, 200, data, "Logged out successfully");
    } catch (err) {
      next(err);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      data: Joi.object().required(),
      kioskId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      const data = await AuthSvc.updateProfile(userId as string, value.data);

      if (value.kioskId) {
        emitToKiosk(value.kioskId, "kiosk_notification", { action: "profile_updated" });
      }

      return responseSuccess(res, 200, data, "Profile updated successfully");
    } catch (err) {
      next(err);
    }
  }
}
