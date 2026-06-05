import { Router } from "express";
import OutlineController from "../../controllers/shared/outline.controller";

const router = Router();

router.get("/:id", OutlineController.externalGetById);

export default router;
