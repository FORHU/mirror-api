import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import UserService from "../../services/shared/user.service";
import { responseSuccess } from "../../helpers/response.helper";
import { buildPage } from "../../helpers/pagination.helper";

const updateSchema = Joi.object({
  username: Joi.string().optional(),
  email: Joi.string().email().optional(),
  gender: Joi.string().valid("MALE", "FEMALE").optional(),
  userMeasurement: Joi.object().optional().allow(null),
});

export default class UserController {
  /**
   * Get current user
   */
  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const user = await UserService.getUser(userId);
      return responseSuccess(res, 200, user);
    } catch (error) {
      next(error);
    }
  }

  /**
   * List users
   */
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await UserService.listUsers(req.query as Record<string, string | undefined>);
      return responseSuccess(
        res,
        200,
        buildPage(result.users, result.total, { page: result.page, limit: result.limit })
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user
   */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const { error, value } = updateSchema.validate(req.body);
      if (error) {
        throw { status: 400, message: error.message };
      }

      const user = await UserService.updateUser(userId, value);
      return responseSuccess(res, 200, user);
    } catch (error) {
      next(error);
    }
  }
}
