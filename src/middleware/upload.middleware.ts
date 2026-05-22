import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import path from "path";
import { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME } from "../config";

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const storageS3 = multerS3({
  s3: s3,
  bucket: S3_BUCKET_NAME || "default-bucket",
  // Bucket has Object Ownership = "Bucket owner enforced" (ACLs disabled,
  // AWS recommended default). multer-s3 v3 defaults to `acl: 'private'` when
  // omitted, which the bucket rejects with `AccessControlListNotSupported`.
  // Returning undefined from the acl callback makes multer-s3 pass
  // `ACL: undefined`, which the AWS SDK then drops from the request entirely.
  // Public read access is granted via bucket policy instead.
  acl: function (
    _req: Request,
    _file: Express.Multer.File,
    cb: (error: Error | null, acl?: string) => void
  ) {
    cb(null, undefined);
  } as unknown as string,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: function (req, file, cb) {
    cb(null, { fieldName: file.fieldname });
  },
  key: function (req, file, cb) {
    const uniqueSuffix = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(file.originalname);
    cb(null, `uploads/${Date.now()}-${uniqueSuffix}${ext}`);
  },
});

if (!S3_BUCKET_NAME || !AWS_ACCESS_KEY_ID) {
  throw new Error(
    "S3 upload requires S3_BUCKET_NAME and AWS_ACCESS_KEY_ID — local disk storage has been removed."
  );
}

const storage = storageS3;

// File filter
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allow common file types
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/mpeg",
    "video/mkv",
    "video/mov",
    "audio/mpeg",
    "audio/mp3",
    "audio/m4a",
    "audio/wav",
    "audio/ogg",
    "audio/aac",
    "audio/x-wav",
    "audio/mpeg3",
    "application/json",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true); // Accept file
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`));
  }
};

// Multer upload middleware
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max
  },
});

/**
 * Flexible middleware that accepts any single file field name (e.g., "file", "image", "avatar")
 * and extracts it to req.file to support varying client implementations without throwing Multer errors.
 */
export const handleSingleUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.any()(req, res, (err) => {
    if (err) return next(err);
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};
