import express from "express";
import ExternalCosmeticProductController from "../../controllers/external/cosmetic-product.controller";

const router = express.Router();

router.get("/", ExternalCosmeticProductController.index);
router.get("/:id", ExternalCosmeticProductController.show);

export default router;
