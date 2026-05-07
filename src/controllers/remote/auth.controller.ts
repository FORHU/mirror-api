import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import AuthSvc from "../../services/remote/auth.service";
import { emitToKiosk } from "utils/socket.util";

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
      const data = await AuthSvc.login(value.email, platform, value.username);
 
      // If a kioskId was provided during login, notify that Kiosk
      if (!value.kioskId) return res.json({
        status: "failed",
        data,
        message: "Kiosk not found",
      });
      
      emitToKiosk(value.kioskId, "kiosk_login", data);

      return res.json({
        status: "success",
        data,
        message: "Login successful",
      });
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
      return res.json({ status: "success", data });
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
      const userId = (req as any).user?.id;
      const data = await AuthSvc.logout(userId, value.refreshToken);
      return res.json({
        status: "success",
        data,
        message: "Logged out successfully",
      });
    } catch (err) {
      next(err);
    }
  }
}
