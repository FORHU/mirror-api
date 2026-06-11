import express from "express";
import ExternalOutfitController from "../../controllers/external/outfit.controller";

const router = express.Router();

router.get("/", ExternalOutfitController.index);

export default router;
