import { prisma } from "../utils/prisma";

export default class OutlineRepo {
  static async findById(id: string) {
    return prisma.userOutline.findUnique({
      where: { id },
    });
  }

  static async findByUserId(userId: string) {
    return prisma.userOutline.findMany({
      where: { userId },
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

  static async update(
    id: string,
    data: {
      userPrompt?: string[];
      location?: string;
      latitude?: number;
      longitude?: number;
      startTime?: Date;
    }
  ) {
    return prisma.userOutline.update({
      where: { id },
      data,
    });
  }

  static async updateStatusByConversationId(conversationId: string, status: string) {
    return prisma.userOutline.update({
      where: { conversationId },
      data: { status },
    });
  }

  static async delete(id: string) {
    return prisma.userOutline.delete({
      where: { id },
    });
  }
}
