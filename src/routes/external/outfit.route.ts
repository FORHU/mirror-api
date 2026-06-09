import express from "express";
import ExternalOutfitController from "../../controllers/external/outfit.controller";

const router = express.Router();

router.get("/", ExternalOutfitController.metaFields); // distinct metaData keys + deduped values for search facets

export default router;
