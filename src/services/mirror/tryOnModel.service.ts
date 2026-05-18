import { prisma } from "../../utils/prisma";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../../utils/s3";
import FileService from "../shared/file.service";
import FileRepo from "../../repositories/file.repository";
import logger from "../../utils/logger";

export default class TryOnModelService {
  /**
   * Uploads the model image via the backend (multipart), creates a File row,
   * and attaches it as the user's avatar (their try-on model image).
   * If the user already had an avatar, the old File row and S3 object are
   * deleted so model photos don't accumulate.
   */
  static async uploadModel(userId: string, file: any) {
    if (!file) throw { status: 400, message: "file is required" };

    const existing = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      include: { avatar: true },
    });
    if (!existing) throw { status: 404, message: "User not found" };

    const oldFile = existing.avatar;

    const fileRecord = await FileService.uploadFile(file, { purpose: "tryon-model" });

    await prisma.user.update({
      where: { id: userId },
      data: { avatarId: fileRecord.id },
    });

    // Best-effort cleanup of the previous model image
    if (oldFile) {
      try {
        if (oldFile.provider === "S3" && oldFile.path && oldFile.bucket) {
          await s3Client.send(
            new DeleteObjectCommand({ Bucket: oldFile.bucket, Key: oldFile.path }),
          );
        }
        await FileRepo.softDelete(oldFile.id);
        logger.info(`[TryOnModel] Replaced model for user ${userId}, deleted old fileId=${oldFile.id}`);
      } catch (err: any) {
        logger.error(`[TryOnModel] Failed to delete old model file ${oldFile.id}: ${err.message}`);
      }
    }

    logger.info(`[TryOnModel] Uploaded model for user ${userId}, fileId=${fileRecord.id}`);

    return FileService.uploadFile(fileRecord);
  }

  /**
   * Returns the user's current model image with a fresh presigned GET URL.
   */
  static async getUserModel(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      include: { avatar: true },
    });

    if (!user) throw { status: 404, message: "User not found" };
    if (!user.avatar) throw { status: 404, message: "No model image set for this user" };

    return FileService.uploadFile(user.avatar);
  }
}
