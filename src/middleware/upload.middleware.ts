import multer from "multer";
import { Request } from "express";

// Store file in memory (not disk)
const storage = multer.memoryStorage();

// File filter
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
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
