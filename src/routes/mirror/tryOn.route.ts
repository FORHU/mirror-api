import express from "express";
import TryOnController from "../../controllers/mirror/tryOn.controller";
import TryOnModelController from "../../controllers/mirror/tryOnModel.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

// Model image (the person photo FASHN swaps garments onto)
router.post("/model/presign", authenticate, TryOnModelController.presign);
router.post("/model/confirm", authenticate, TryOnModelController.confirm);
router.get("/model", authenticate, TryOnModelController.get);

// Try-on runs
router.post("/run", authenticate, TryOnController.run);
router.post("/garment", authenticate, TryOnController.runByGarment);
router.get("/:predictionId/status", authenticate, TryOnController.status);

export default router;
