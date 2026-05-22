import express from "express";
import MapController from "../../controllers/mirror/map.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

// Legacy GET endpoints (mirror-app compatibility)
router.get("/search", MapController.search);
router.get("/directions", MapController.getDirections);

// Geocode + Directions — auth optional (dev bypass: no auth required)
router.post("/geocode", MapController.geocode);
router.post("/directions", MapController.directions);

// Foursquare nearby POIs + venue photos — no auth required
router.get("/nearby-pois",            MapController.nearbyPOIs);
router.get("/venue-photos/:fsqId",    MapController.venuePhotos);

// Home Location — auth required
router.get("/home-location", authenticate, MapController.getHomeLocation);
router.patch("/home-location", authenticate, MapController.updateHomeLocation);

export default router;
