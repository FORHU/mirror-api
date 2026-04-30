import UserRepository from "../repositories/user.repository";
import logger from "../utils/logger";

export default class UserService {
  /**
   * Get user by ID
   */
  static async getUser(id: string) {
    const user = await UserRepository.findById(id);
    if (!user) {
      throw { status: 404, message: "User not found" };
    }
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * List users hehe
   */
  static async listUsers(page?: number, limit?: number) {
    return UserRepository.findAll(page, limit);
  }
}
