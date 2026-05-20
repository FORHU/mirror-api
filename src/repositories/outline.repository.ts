import { prisma } from "../utils/prisma";

export default class OutlineRepo {
  static async findById(id: string) {
    return prisma.userOutline.findUnique({
      where: { id },
      include: {
        outfits: true,
      },
    });
  }

  static async findByUserId(userId: string) {
    return prisma.userOutline.findMany({
      where: { userId },
      include: {
        outfits: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async create(data: {
    userId?: string;
    userPrompt: string[];
    location?: string;
    latitude?: number;
    longitude?: number;
    startTime?: Date;
  }) {
    return prisma.userOutline.create({
      data: {
        userId: data.userId,
        userPrompt: data.userPrompt,
        location: data.location,
        latitude: data.latitude,
        longitude: data.longitude,
        startTime: data.startTime,
      },
    });
  }

  static async update(id: string, data: {
    userPrompt?: string[];
    location?: string;
    latitude?: number;
    longitude?: number;
    startTime?: Date;
  }) {
    return prisma.userOutline.update({
      where: { id },
      data,
    });
  }

  static async delete(id: string) {
    return prisma.userOutline.delete({
      where: { id },
    });
  }
}
