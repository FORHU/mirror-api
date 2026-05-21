import express from "express";
import ExternalOutfitController from "../../controllers/external/outfit.controller";

const router = express.Router();

router.get("/", ExternalOutfitController.index);
router.get("/:id", ExternalOutfitController.show);

export default router;
