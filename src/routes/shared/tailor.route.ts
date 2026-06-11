import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";
import { authenticate } from "../../middleware/auth.middleware";
import { CHAT_WONDER_API_URL } from "../../config";

const router = Router();
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(authenticate);

router.post(
  "/generate",
  memUpload.single("image"),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) {
      return res.status(400).json({ detail: "image file is required" });
    }
    const { gender } = req.body as { gender?: string };
    if (!gender || !["MALE", "FEMALE"].includes(gender.toUpperCase())) {
      return res.status(400).json({ detail: "gender must be MALE or FEMALE" });
    }

    try {
      const form = new FormData();
      form.append("image", req.file.buffer, {
        filename: req.file.originalname || "outfit.png",
        contentType: req.file.mimetype || "image/png",
      });
      form.append("gender", gender.toUpperCase());

      const response = await axios.post(`${CHAT_WONDER_API_URL}/api/tailor/generate`, form, {
        headers: form.getHeaders(),
        timeout: 120_000,
      });

      return res.status(200).json(response.data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
