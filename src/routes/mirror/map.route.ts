import express from "express";
import MapController from "../../controllers/mirror/map.controller";

const router = express.Router();

router.get("/search", MapController.search);
router.get("/directions", MapController.getDirections);

export default router;
