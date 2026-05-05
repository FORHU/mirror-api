import { prisma } from "../utils/prisma";

export default class AuthRepo {
  static async findUserByEmailOrUsername(email: string, username: string) {
    return prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        isDeleted: false,
      },
    });
  }

  static async createUser(data: {
    email: string;
    password?: string;
    username: string;
  }) {
    return prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        username: data.username,
      },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  static async findUserByEmail(email: string) {
    return prisma.user.findFirst({
      where: {
        email,
        isDeleted: false,
      },
      include: {
        avatar: {
          select: {
            fileUrl: true,
          },
        },
      },
    });
  }

  static async findUserById(userId: string) {
    return prisma.user.findFirst({
      where: {
        id: userId,
        isDeleted: false,
      },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        updatedAt: true,
        avatarId: true,
        isDeleted: true,
        avatar: {
          select: {
            fileUrl: true,
          },
        },
      },
    });
  }

  static async findUserByUsername(username: string) {
    return prisma.user.findFirst({
      where: {
        username,
        isDeleted: false,
      },
    });
  }

  static async createSession(data: {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    platform: string;
  }) {
    return prisma.session.create({
      data,
    });
  }

  static async findValidSession(refreshToken: string) {
    return prisma.session.findFirst({
      where: {
        refreshToken,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });
  }

  static async deleteSession(refreshToken: string) {
    return prisma.session.deleteMany({
      where: {
        refreshToken,
      },
    });
  }

  static async updateUser(userId: string, data: any) {
    return prisma.user.update({
      where: {
        id: userId,
      },
      data: data,
    });
  }

  static async getAuthUser(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: {
          select: { fileUrl: true },
        },
      },
    });
  }
}
