import express from "express";
import GarmentController from "../../controllers/shared/garment.controller";
import { handleSingleUpload } from "../../middleware/upload.middleware";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/", authenticate, GarmentController.index);
router.get("/:id", authenticate, GarmentController.show);

// Publicly accessible for administration
router.post("/", authenticate, handleSingleUpload, GarmentController.create);
router.post("/evaluate", authenticate, handleSingleUpload, GarmentController.evaluate);
router.patch("/:id", authenticate, handleSingleUpload, GarmentController.update);
router.delete("/:id", authenticate, GarmentController.destroy);

export default router;
