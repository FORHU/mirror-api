import express from "express";

// Mirror Routes (Kiosk Web)
import mirrorAuthRoute from "./remote/auth.route";
import mirrorUserRoute from "./shared/user.route";
import mirrorTryOnRoute from "./mirror/tryOn.route";
import mirrorGarmentRoute from "./shared/garment.route";
import mirrorOutfitRoute from "./shared/outfit.route";
import mirrorFileUploadRoute from "./shared/fileUpload.route";
import mirrorMapRoute from "./mirror/map.route";
import mirrorWeatherRoute from "./mirror/weather.route";
import mirrorVoiceRoute from "./mirror/voice.route";
import devTokenHandler from "../controllers/mirror/dev.controller";
import mirrorGenerationRoute from "./shared/generation.route";
import chatWonderRoute from "./shared/chat-wonder.route";
import outlineRoute from "./shared/outline.route";
import cosmeticProductRoute from "./shared/cosmetic-product.route";
import cosmeticRecommendationRoute from "./shared/cosmetic-recommendation.route";
import skinAnalysisRoute from "./shared/skin-analysis.route";
import sharedGeocodeRoute from "./shared/geocode.route";

// External Routes (3rd Party)
import externalGarmentRoute from "./external/garment.route";
import externalOutfitRoute from "./external/outfit.route";
import externalCosmeticRoute from "./external/cosmetic.route";
import { authenticateApiKey } from "../middleware/api-key.middleware";

const router = express.Router();

router.get("/mirror/dev/token", devTokenHandler);

router.get("/", (_, res) => {
  res.json({
    message: "Welcome to mirror-api",
  });
});

// TOP PRIORITY: Explicit route for companion app directions removed

// Mirror endpoints
router.use("/mirror/try-on", mirrorTryOnRoute);
router.use("/mirror/garments", mirrorGarmentRoute);
router.use("/mirror/outfits", mirrorOutfitRoute);
router.use("/mirror/file-uploads", mirrorFileUploadRoute);
router.use("/mirror/map", mirrorMapRoute);
router.use("/mirror/weather", mirrorWeatherRoute);
router.use("/mirror/voice", mirrorVoiceRoute);
router.use("/mirror/chat-wonder", chatWonderRoute);
router.use("/mirror/outlines", outlineRoute);
router.use("/mirror/cosmetic-products", cosmeticProductRoute);
router.use("/mirror/cosmetic-recommendations", cosmeticRecommendationRoute);
router.use("/mirror/skin-analyses", skinAnalysisRoute);
router.use("/mirror/geocode", sharedGeocodeRoute);
router.use("/mirror/auth", mirrorAuthRoute);
router.use("/mirror/users", mirrorUserRoute);
router.use("/mirror/generation", mirrorGenerationRoute);

// External endpoints (3rd party access)
router.use("/external/garments", authenticateApiKey, externalGarmentRoute);
router.use("/external/outfits", authenticateApiKey, externalOutfitRoute);
router.use("/external/cosmetics", authenticateApiKey, externalCosmeticRoute);
router.use("/external/cosmetic-products", authenticateApiKey, externalCosmeticRoute);

export default router;
