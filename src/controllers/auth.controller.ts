import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import AuthSvc from "../services/auth.service";

export default class AuthController {
  /**
   * Register a new user
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      username: Joi.string().required(),
      name: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ message: error.message });

    try {
      const data = await AuthSvc.register(value);
      return res.status(201).json({ message: "User created successfully", data });
    } catch (error) {
      next(error);
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
    if (error) return res.status(400).json({ message: error.message });

    try {
      const data = await AuthSvc.login(value);
      return res.json({ message: "Login successful", data });
    } catch (error) {
      next(error);
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
    if (error) return res.status(400).json({ message: error.message });

    try {
      const data = await AuthSvc.refreshToken(value.refreshToken);
      return res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout
   */
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const userId = (req as any).user?.id;
      const result = await AuthSvc.logout(userId, refreshToken);
      return res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
