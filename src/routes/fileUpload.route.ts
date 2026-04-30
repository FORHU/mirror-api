import express from "express";
import { upload } from "../middleware/upload.middleware";
import logger from "../utils/logger";

const router = express.Router();

router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  logger.info(`File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);

  res.json({
    message: "File uploaded successfully",
    file: {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    },
  });
});

export default router;
