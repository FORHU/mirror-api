import express from "express";
import OutfitController from "../../controllers/shared/outfit.controller";
import { handleSingleUpload } from "../../middleware/upload.middleware";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/", OutfitController.index);
router.get("/needs-image", OutfitController.indexNeedingImage); // outfits still on the placeholder file — need a real upload via PATCH
router.get("/complete", OutfitController.indexComplete); // outfits with a real uploaded image (non-EXTERNAL provider)
router.get("/:id", OutfitController.show);

// Publicly accessible for administration — mirrors garment.route.ts
router.post("/", handleSingleUpload, OutfitController.create);
// Personalized / AI routes require a real user so req.user.id is set
router.post("/evaluate", authenticate, handleSingleUpload, OutfitController.evaluate); // has AI evaluation but no generation
router.post("/compose", authenticate, OutfitController.compose); // composes outfits from the user's wardrobe via AI
router.post("/evaluate-hybrid", authenticate, handleSingleUpload, OutfitController.evaluateHybrid); // AI evaluation + wardrobe matching
router.post("/recommend", authenticate, OutfitController.recommend); // rule-based composer by CATEGORY (no AI, no file) — still needs userId for ownership
router.patch("/:id", handleSingleUpload, OutfitController.update); // update can also handle file uploads for updating the outfit image
router.delete("/:id", OutfitController.destroy);

export default router;
