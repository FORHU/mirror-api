import { prisma } from "../utils/prisma";
import { Prisma } from "@prisma/client";

export default class AuthRepo {
  static async findUserByEmailOrUsername(email: string, username: string) {
    return prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        isDeleted: false,
      },
    });
  }

  static async createUser(data: { email: string; username: string; gender?: "MALE" | "FEMALE" }) {
    return prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        gender: data.gender ?? "MALE",
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
    provider?: string;
    providerUserId?: string;
    providerAvatarUrl?: string;
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

  static async updateUser(userId: string, data: Prisma.UserUpdateInput) {
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

  static async findOrCreateGoogleUser(data: {
    email: string;
    username: string;
    avatarUrl?: string;
  }) {
    // Try to find existing user by email
    const existingUser = await this.findUserByEmail(data.email);

    if (existingUser) {
      // If they have an avatar URL from Google and don't have one set, or we want to sync it
      if (data.avatarUrl && !existingUser.avatarId) {
        // Create a File record for the avatar
        const avatarFile = await prisma.file.create({
          data: {
            filename: `google_avatar_${Date.now()}.jpg`,
            fileUrl: data.avatarUrl,
          },
        });

        return prisma.user.update({
          where: { id: existingUser.id },
          data: { avatarId: avatarFile.id },
          include: {
            avatar: { select: { fileUrl: true } },
          },
        });
      }
      return existingUser;
    }

    // Create new user
    let avatarId: string | undefined;
    if (data.avatarUrl) {
      const avatarFile = await prisma.file.create({
        data: {
          filename: `google_avatar_${Date.now()}.jpg`,
          fileUrl: data.avatarUrl,
        },
      });
      avatarId = avatarFile.id;
    }

    const createData: Prisma.UserCreateInput = {
      email: data.email,
      username: data.username,
      gender: "MALE",
    };
    if (avatarId) {
      createData.avatar = { connect: { id: avatarId } };
    }
    return prisma.user.create({
      data: createData,
      include: {
        avatar: { select: { fileUrl: true } },
      },
    });
  }
}
