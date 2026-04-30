import { prisma } from '../utils/prisma';
import { UserRole } from '@prisma/client';

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
  static async create(data: any) {
    return prisma.user.create({
      data,
    });
  }

  /**
   * Update user details
   */
  static async update(id: string, data: any) {
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
      data: { isDeleted: true, isActive: false },
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
        orderBy: { createdAt: 'desc' },
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
