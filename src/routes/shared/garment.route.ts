import express from "express";
import GarmentController from "../../controllers/shared/garment.controller";
import { upload } from "../../middleware/upload.middleware";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/", GarmentController.index);
router.get("/:id", GarmentController.show);

// Publicly accessible for administration
router.post("/", upload.single("file"), GarmentController.create);
router.post("/evaluate", authenticate, upload.single("file"), GarmentController.evaluate);
router.patch("/:id", upload.single("file"), GarmentController.update);
router.delete("/:id", GarmentController.destroy);

export default router;
