import express from "express";
import OutfitController from "../../controllers/shared/outfit.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/", OutfitController.index);
router.get("/:id", OutfitController.show);

router.post("/", authenticate, OutfitController.create);
router.delete("/:id", authenticate, OutfitController.destroy);

export default router;
