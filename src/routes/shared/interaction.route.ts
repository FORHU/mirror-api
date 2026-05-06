import express from "express";
import InteractionController from "../../controllers/shared/interaction.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.use(authenticate); // Protect interactions

router.get("/", InteractionController.index);
router.post("/", InteractionController.create);

export default router;
