import { Request, Response, NextFunction } from "express";
import UserService from "../services/user.service";

export default class UserController {
  /**
   * Get current user
   */
  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await UserService.getUser(userId);
      return res.json({ status: "success", data: user });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List users
   */
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const data = await UserService.listUsers(page, limit);
      return res.json({ status: "success", data });
    } catch (error) {
      next(error);
    }
  }
}
