import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import AuthSvc from "../services/auth.service";

const validationError = (message: string) => ({ status: 400, message });

export default class AuthController {
  /**
   * Register a new user
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      username: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await AuthSvc.register(value);
      return res.status(201).json({
        status: "success",
        data,
        message: "User created successfully",
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Login with email/password
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return next(validationError(error.message));

    try {
      const data = await AuthSvc.login(value);
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
