import express from "express";
import MapController from "../../controllers/mirror/map.controller";

const router = express.Router();

/**
 * @route POST /
 * @desc Get geocode exact coordinates for a given query
 * @access Public (or protected depending on usage)
 */
router.post("/", MapController.geocode);

export default router;
