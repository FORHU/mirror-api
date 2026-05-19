import { prisma } from "../utils/prisma";

export default class FileRepo {
  static async create(data: {
    filename: string;
    originalName?: string;
    fileUrl: string;
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
      },
    });
  }

  /**
   * Fetch a File along with markers for every model that could be holding
   * onto it. Used by `discardIfUnreferenced` to decide whether the row is
   * safe to delete.
   */
  static async findByIdWithRelations(id: string) {
    return prisma.file.findUnique({
      where: { id },
      include: {
        garment: { select: { id: true } },
        outfitDisplay: { select: { id: true } },
        userAvatar: { select: { id: true } },
      },
    });
  }

  static async softDelete(id: string) {
    return prisma.file.delete({
      where: { id },
    });
  }
}
