import express from "express";
import GarmentController from "../controllers/garment.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = express.Router();

router.get("/", GarmentController.index);
router.get("/:id", GarmentController.show);

router.post("/", authenticate, GarmentController.create);
router.patch("/:id", authenticate, GarmentController.update);
router.delete("/:id", authenticate, GarmentController.destroy);

export default router;
