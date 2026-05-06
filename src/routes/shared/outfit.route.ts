import express from "express";
import OutfitController from "../../controllers/shared/outfit.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.use(authenticate); // Protect all outfit routes

router.get("/", OutfitController.index);
router.get("/:id", OutfitController.show);
router.post("/", OutfitController.create);
router.delete("/:id", OutfitController.destroy);

export default router;
