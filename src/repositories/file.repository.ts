import { prisma } from "../utils/prisma";

export default class FileRepo {
  static async create(data: {
    filename?: string;
    originalName?: string;
    fileUrl?: string;
    thumbnailUrl?: string;
    mimeType?: string;
    extension?: string;
    size?: number;
    provider?: string;
    bucket?: string;
    path?: string;
    metaData?: any;
  }) {
    return prisma.file.create({
      data,
    });
  }

  static async findById(id: string) {
    return prisma.file.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  static async softDelete(id: string) {
    return prisma.file.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
