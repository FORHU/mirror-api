import express from "express";
import OutfitController from "../../controllers/shared/outfit.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { upload } from "../../middleware/upload.middleware";

const router = express.Router();

router.get("/", authenticate, OutfitController.index);
router.get("/:id", authenticate, OutfitController.show);

router.post("/", authenticate, upload.single("file"), OutfitController.create);
router.post("/system", OutfitController.create); // JSON only, no auth
router.patch("/:id", authenticate, upload.single("file"), OutfitController.update);
router.delete("/:id", authenticate, OutfitController.destroy);

export default router;
