import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import CosmeticRecommendationController from "../../controllers/shared/cosmetic-recommendation.controller";

const router = Router();

router.get(   "/",     authenticate, CosmeticRecommendationController.index);
router.get(   "/:id",  authenticate, CosmeticRecommendationController.show);
router.post(  "/",     authenticate, CosmeticRecommendationController.create);
router.patch( "/:id",  authenticate, CosmeticRecommendationController.update);
router.delete("/:id",  authenticate, CosmeticRecommendationController.destroy);

export default router;
