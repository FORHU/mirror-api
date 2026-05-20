import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import CosmeticProductController from "../../controllers/shared/cosmetic-product.controller";

const router = Router();

// Catalog endpoints. Listing/show are authenticated by default so we don't
// repeat the outfit-leak pattern; a future kiosk-only public catalog path
// can branch from here.
router.get(   "/",      authenticate, CosmeticProductController.index);
router.get(   "/:id",   authenticate, CosmeticProductController.show);
router.post(  "/",      authenticate, CosmeticProductController.create);
router.patch( "/:id",   authenticate, CosmeticProductController.update);
router.delete("/:id",   authenticate, CosmeticProductController.destroy);

export default router;
