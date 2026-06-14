import { Router } from "express";
import CosmeticProductController from "../../controllers/shared/cosmetic-product.controller";
import { handleSingleUpload } from "../../middleware/upload.middleware";

const router = Router();

// Catalog endpoints, publicly accessible for administration — same pattern as
// the garment routes. Add `authenticate` inline to any route that needs to be
// gated (see garment.route.ts "/evaluate").
router.get("/", CosmeticProductController.index);
router.post("/batch", CosmeticProductController.batchGet);
router.get("/:id", CosmeticProductController.show);
router.post("/", handleSingleUpload, CosmeticProductController.create);
router.patch("/:id", handleSingleUpload, CosmeticProductController.update);
router.delete("/:id", CosmeticProductController.destroy);

export default router;
