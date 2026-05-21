import logger from "../../utils/logger";
import FileRepo from "../../repositories/file.repository";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import path from "path";
import { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME } from "../../config";

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

export default class FileUploadService {
  /**
   * Generates a temporary, secure URL for the frontend to upload directly to S3
   */
  static async generatePresignedUrl(filename: string, mimetype: string) {
    const uniqueSuffix = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(filename);
    const key = `uploads/${Date.now()}-${uniqueSuffix}${ext}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      ContentType: mimetype,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes

    logger.info(`Generated presigned URL for key: ${key}`);

    return {
      uploadUrl: presignedUrl,
      key,
      fileUrl: `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`,
    };
  }

  /**
   * Called by the frontend AFTER a successful upload to save it to the database
   */
  static async confirmUpload(
    filename: string,
    fileUrl: string,
    key: string,
    size: number,
    mimetype: string
  ) {
    logger.info(`Confirming upload for S3 key: ${key}`);

    const savedFile = await FileRepo.create({
      filename,
      fileUrl,
      metaData: {
        size,
        mimetype,
        s3Key: key,
      },
    });

    return savedFile;
  }
}
