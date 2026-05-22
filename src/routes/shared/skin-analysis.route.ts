import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import SkinAnalysisController from "../../controllers/shared/skin-analysis.controller";

const router = Router();

// Per-user skin analyses. POST runs vision + recommendation engine and
// returns the analysis with its recommended products in one payload.
// Update isn't exposed — analyses are immutable; re-run create to refresh.
router.get("/", authenticate, SkinAnalysisController.index);
router.get("/:id", authenticate, SkinAnalysisController.show);
router.post("/", authenticate, SkinAnalysisController.create);
router.delete("/:id", authenticate, SkinAnalysisController.destroy);

export default router;
