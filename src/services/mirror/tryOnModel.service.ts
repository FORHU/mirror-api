import crypto from "crypto";
import path from "path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "../../utils/s3";
import FileRepo from "../../repositories/file.repository";
import { prisma } from "../../utils/prisma";
import FileService from "../shared/file.service";
import { S3_BUCKET_NAME, S3_CDN_URL } from "../../config";
import logger from "../../utils/logger";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

export default class TryOnModelService {
  /**
   * Generates a presigned PUT URL the client uses to upload the model image
   * directly to S3. The key is namespaced by user so we can audit later.
   */
  static async presignModelUpload(userId: string, filename: string, mimetype: string) {
    if (!ALLOWED_MIME.includes(mimetype)) {
      throw { status: 400, message: `mimetype ${mimetype} not allowed` };
    }

    const uniqueSuffix = crypto.randomBytes(12).toString("hex");
    const ext = path.extname(filename);
    const key = `tryon-models/${userId}/${Date.now()}-${uniqueSuffix}${ext}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      ContentType: mimetype,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    logger.info(`[TryOnModel] Presign for user ${userId}, key=${key}`);

    return {
      uploadUrl,
      key,
      expiresInSeconds: 300,
      method: "PUT",
      headers: { "Content-Type": mimetype },
    };
  }

  /**
   * Creates the File record after the client has PUT to S3, then attaches it
   * as the user's avatar (= their try-on model image).
   */
  static async confirmModelUpload(
    userId: string,
    payload: { key: string; filename: string; size: number; mimetype: string },
  ) {
    const { key, filename, size, mimetype } = payload;

    const file = await FileRepo.create({
      filename: filename || key,
      originalName: filename,
      fileUrl: S3_CDN_URL ? `${S3_CDN_URL}/${key}` : `https://${S3_BUCKET_NAME}.s3.amazonaws.com/${key}`,
      mimeType: mimetype,
      extension: path.extname(filename).replace(".", ""),
      size,
      provider: "S3",
      bucket: S3_BUCKET_NAME,
      path: key,
      metaData: { purpose: "tryon-model" },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { avatarId: file.id },
    });

    return FileService.attachPresignedUrls(file);
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

    return FileService.attachPresignedUrls(user.avatar);
  }
}
