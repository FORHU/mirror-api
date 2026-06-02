import { prisma } from "../utils/prisma";
import { Prisma } from "@prisma/client";

export default class UserRepository {
  /**
   * Find a user by ID
   */
  static async findById(id: string) {
    return prisma.user.findFirst({
      where: { id, isDeleted: false },
    });
  }

  /**
   * Find user gender by ID
   */
  static async findGenderById(id: string) {
    return prisma.user.findFirst({
      where: { id, isDeleted: false },
      select: { gender: true },
    });
  }

  /**
   * Find a user by email
   */
  static async findByEmail(email: string) {
    return prisma.user.findFirst({
      where: { email, isDeleted: false },
    });
  }

  /**
   * Create a new user
   */
  static async create(data: Prisma.UserCreateInput) {
    return prisma.user.create({
      data,
    });
  }

  /**
   * Update user details
   */
  static async update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  /**
   * Soft delete a user
   */
  static async softDelete(id: string) {
    return prisma.user.update({
      where: { id },
      data: { isDeleted: true },
    });
  }

  /**
   * List all users (paginated)
   */
  static async findAll(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: { isDeleted: false },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where: { isDeleted: false } }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
