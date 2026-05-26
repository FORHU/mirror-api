import express from "express";
import ExternalGarmentController from "../../controllers/external/garment.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/", authenticate, ExternalGarmentController.index);
router.get("/:id", authenticate, ExternalGarmentController.show);

export default router;
