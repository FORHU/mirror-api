import { prisma } from "../utils/prisma";
import { OUTLINE_STATUS } from "@prisma/client";

export interface MapStop {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  eventType?: string;
  timeBlock?: string;
}

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
        // The outline's own cosmetics master list (refreshed each ChatWonder
        // turn by persistOutlineCosmetics). This is what /overview hydrates from.
        cosmeticRecommendations: {
          orderBy: { rank: "asc" },
          include: {
            cosmeticProduct: {
              include: {
                fileUrl: true,
              },
            },
          },
        },
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
            recommendations: {
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
  static async saveMapStops(outlineId: string, stops: MapStop[]) {
    // Wipe previous map-sourced events, then write fresh ones
    await prisma.itineraryEvent.deleteMany({ where: { userOutlineId: outlineId } });
    if (stops.length === 0) return;
    await prisma.itineraryEvent.createMany({
      data: stops.map((s) => ({
        userOutlineId: outlineId,
        type: s.eventType ?? "location",
        timeBlock: s.timeBlock ?? "anytime",
        routeDestination: s.name,
        routeOrigin: null,
      })),
    });
  }

  static async softDeleteAllByUserId(userId: string) {
    return prisma.userOutline.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * SCOPED RESET — deletes only one feature's contribution to an outline, used by
   * the per-screen **Reset** command (see ADR 0001). Each clears the persisted
   * rows linked either directly to the outline or via one of its events.
   */
  static async clearFashionByOutlineId(outlineId: string) {
    return prisma.outfit.deleteMany({
      where: {
        OR: [{ userOutlineId: outlineId }, { itineraryEvent: { userOutlineId: outlineId } }],
      },
    });
  }

  static async clearCosmeticsByOutlineId(outlineId: string) {
    const deleted = await prisma.cosmeticRecommendation.deleteMany({
      where: {
        OR: [{ userOutlineId: outlineId }, { itineraryEvent: { userOutlineId: outlineId } }],
      },
    });
    // Unlink the skin analysis so the cosmetics tile reads empty.
    await prisma.userOutline.update({
      where: { id: outlineId },
      data: { skinAnalysisId: null },
    });
    return deleted;
  }

  static async clearItineraryByOutlineId(outlineId: string) {
    return prisma.itineraryEvent.deleteMany({
      where: { userOutlineId: outlineId },
    });
  }
}
