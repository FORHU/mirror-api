import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import OutlineController from "../../controllers/shared/outline.controller";

const router = Router();

router.post("/", authenticate, OutlineController.create);
router.post("/reset", authenticate, OutlineController.reset);
router.post("/map-stops", authenticate, OutlineController.saveMapStops);
router.get("/active", authenticate, OutlineController.getActive);
router.get("/", authenticate, OutlineController.list);
router.get("/:id", authenticate, OutlineController.getById);

export default router;
