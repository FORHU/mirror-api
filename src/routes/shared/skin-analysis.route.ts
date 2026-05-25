import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import SkinAnalysisController from "../../controllers/shared/skin-analysis.controller";

const router = Router();
router.use(authenticate);

// Per-user skin analyses. POST runs vision + recommendation engine and
// returns the analysis with its recommended products in one payload.
// Update isn't exposed — analyses are immutable; re-run create to refresh.
router.get("/", SkinAnalysisController.index);
router.get("/:id", SkinAnalysisController.show);
router.post("/", SkinAnalysisController.create);
router.delete("/:id", SkinAnalysisController.destroy);

export default router;
