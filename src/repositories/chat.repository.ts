import { prisma } from "../utils/prisma";
import { ChatMessageRole } from "@prisma/client";

export default class ChatRepository {
  static async createConversation(data: { userId: string; title: string }) {
    return prisma.conversation.create({
      data: {
        userId: data.userId,
        title: data.title,
      },
    });
  }

  static async getConversationById(id: string) {
    return prisma.conversation.findUnique({
      where: { id },
      include: {
        chatMessages: {
          orderBy: { createdAt: "asc" },
          take: 50,
        },
      },
    });
  }

  static async createMessage(data: {
    userId: string;
    conversationId: string;
    message: string;
    role: ChatMessageRole;
  }) {
    return prisma.chatMessage.create({
      data: {
        userId: data.userId,
        conversationId: data.conversationId,
        message: data.message,
        role: data.role,
      },
    });
  }

  static async getHistory(conversationId: string, limit = 10) {
    return prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
