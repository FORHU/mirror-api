import express from "express";
import TryOnController from "../../controllers/mirror/tryOn.controller";
import TryOnModelController from "../../controllers/mirror/tryOnModel.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { upload } from "../../middleware/upload.middleware";

const router = express.Router();

// Model image (the person photo FASHN swaps garments onto)
router.post("/model", authenticate, upload.single("file"), TryOnModelController.upload);
router.get("/model", authenticate, TryOnModelController.get);

// Try-on runs
router.post("/run", authenticate, TryOnController.run);
router.post("/garment", authenticate, TryOnController.runByGarment);
router.post("/outfit", authenticate, TryOnController.runByOutfit);
router.get("/:predictionId/status", authenticate, TryOnController.status);

export default router;
