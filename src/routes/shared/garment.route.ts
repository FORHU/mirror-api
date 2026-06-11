import express from "express";
import GarmentController from "../../controllers/shared/garment.controller";
import { handleSingleUpload } from "../../middleware/upload.middleware";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/", GarmentController.index);
router.get("/:id", GarmentController.show);

// Publicly accessible for administration
router.post("/", handleSingleUpload, GarmentController.create);
router.post("/evaluate", authenticate, handleSingleUpload, GarmentController.evaluate);
router.patch("/:id", handleSingleUpload, GarmentController.update);
router.delete("/:id", GarmentController.destroy);

export default router;
