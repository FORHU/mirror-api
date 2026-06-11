import express from "express";
import TryOnController from "../../controllers/mirror/tryOn.controller";
import TryOnModelController from "../../controllers/mirror/tryOnModel.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { upload } from "../../middleware/upload.middleware";

const router = express.Router();

// Model image (the person photo FASHN swaps garments onto)
router.post("/model", authenticate, upload.single("file"), TryOnModelController.upload);
router.get("/model", authenticate, TryOnModelController.get);

// Try-on runs (image)
router.post("/run", authenticate, TryOnController.run);
router.post("/upload-and-run", authenticate, upload.single("file"), TryOnController.uploadAndRun);
router.post("/garment", authenticate, TryOnController.runByGarment);
router.post("/outfit", authenticate, TryOnController.runByOutfit);

// Try-on runs (video) — model id configured via FASHN_VIDEO_MODEL env var
router.post("/video/garment", authenticate, TryOnController.runVideoByGarment);
router.post("/video/outfit", authenticate, TryOnController.runVideoByOutfit);

// Status polling (works for both image and video predictions)
router.get("/:predictionId/status", authenticate, TryOnController.status);

export default router;
