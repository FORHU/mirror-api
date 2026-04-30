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
    name?: string;
  }) {
    return prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        username: data.username,
        name: data.name,
        isEmailVerified: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        isEmailVerified: true,
        onboardingCompleted: true,
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

  static async updateUserLoginStatus(userId: string) {
    return prisma.user.update({
      where: {
        id: userId,
        isDeleted: false,
      },
      data: {
        isActive: true,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        isActive: true,
        avatar: {
          select: {
            fileUrl: true,
          },
        },
        lastLoginAt: true,
        onboardingCompleted: true,
      },
    });
  }

  static async findUserById(userId: string) {
    return prisma.user.findFirst({
      where: {
        id: userId,
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
    refreshToken: string;
    expiresAt: Date;
    provider?: string;
    providerUserId?: string;
    providerAvatarUrl?: string;
  }) {
    return prisma.session.create({
      data: {
        ...data,
      },
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
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        avatar: true,
        username: true,
        role: true,
        onboardingCompleted: true,
      },
    });
  }
}
