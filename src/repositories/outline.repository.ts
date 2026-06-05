import { prisma } from "../utils/prisma";
import { OUTLINE_STATUS } from "@prisma/client";

export default class OutlineRepo {
  static async findById(id: string) {
    return prisma.userOutline.findUnique({
      where: { id },
    });
  }

  static async findByIdWithEvents(id: string) {
    return prisma.userOutline.findUnique({
      where: { id },
      include: { events: true },
    });
  }

  static async findByUserId(userId: string) {
    return prisma.userOutline.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  static async findActiveWithOverview(userId: string) {
    return prisma.userOutline.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        events: {
          orderBy: { createdAt: "asc" },
          include: {
            outfits: {
              include: {
                file: true,
                items: {
                  include: {
                    garment: {
                      include: {
                        file: true,
                      },
                    },
                  },
                },
              },
            },
            cosmeticRecommendations: {
              include: {
                cosmeticProduct: {
                  include: {
                    fileUrl: true,
                  },
                },
              },
            },
          },
        },
        weather: true,
        skinAnalysis: {
          include: {
            file: true,
          },
        },
      },
    });
  }

  static async findActiveWithEvents(userId: string) {
    return prisma.userOutline.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { events: true },
    });
  }

  static async findByConversationId(conversationId: string) {
    return prisma.userOutline.findUnique({
      where: { conversationId },
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
      status?: OUTLINE_STATUS;
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

  static async updateStatusByConversationId(conversationId: string, status: OUTLINE_STATUS) {
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

  /**
   * Soft-deletes all of a user's active (non-deleted) outlines by stamping
   * `deletedAt`. After this, `getActive` (which filters on `!deletedAt`) returns
   * null — i.e. the itinerary is reset. Returns the number of outlines cleared.
   */
  static async softDeleteAllByUserId(userId: string) {
    return prisma.userOutline.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
