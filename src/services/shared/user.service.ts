import UserRepository from "../../repositories/user.repository";
import { Prisma } from "@prisma/client";

import { parsePagination } from "../../helpers/pagination.helper";

export default class UserService {
  /**
   * Get user by ID
   */
  static async getUser(id: string) {
    const user = await UserRepository.findById(id);
    if (!user) {
      throw { status: 404, message: "User not found" };
    }
    return user;
  }

  /**
   * List users hehe
   */
  static async listUsers(query: Record<string, string | undefined> = {}) {
    const { page, limit, sortBy, sortOrder, search, filters } = parsePagination(query);
    const result = await UserRepository.findAll(page, limit);
    return { ...result, sortBy, sortOrder, search, filters };
  }

  /**
   * Update user
   */
  static async updateUser(id: string, data: Prisma.UserUpdateInput) {
    const user = await this.getUser(id);
    return UserRepository.update(user.id, data);
  }
}
