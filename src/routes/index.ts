import express from 'express';

// Remote Routes (Mobile Web)
import remoteAuthRoute from './remote/auth.route';
import remoteUserRoute from './shared/user.route';
import remoteKioskRoute from './remote/kiosk.route';

// Mirror Routes (Kiosk Web)
import mirrorTryOnRoute from './mirror/tryOn.route';
import mirrorGarmentRoute from './shared/garment.route';
import mirrorOutfitRoute from './shared/outfit.route';
import mirrorFileUploadRoute from './shared/fileUpload.route';
import mirrorMapRoute from './mirror/map.route';
import mirrorWeatherRoute from './mirror/weather.route';
import mirrorVoiceRoute from './mirror/voice.route';
import devTokenHandler from "../controllers/mirror/dev.controller";
import mirrorGenerationRoute from './shared/generation.route';
import chatWonderRoute from './shared/chat-wonder.route';

const router = express.Router();

router.get("/mirror/dev/token", devTokenHandler);

router.get('/', (_, res) => {
  res.json({
    message: 'Welcome to mirror-api',
  });
});

// TOP PRIORITY: Explicit route for companion app directions
import MapController from "../controllers/mirror/map.controller";
router.post("/companion/map/directions", MapController.directions);

// Remote endpoints
router.use('/remote/auth', remoteAuthRoute);
router.use('/remote/users', remoteUserRoute);
router.use('/remote/kiosks', remoteKioskRoute);
router.use('/remote/generation', mirrorGenerationRoute);
router.use('/remote/file-uploads', mirrorFileUploadRoute);
router.use('/remote/garments', mirrorGarmentRoute);
router.use('/remote/outfits', mirrorOutfitRoute);

// Mirror endpoints
router.use('/mirror/try-on', mirrorTryOnRoute);
router.use('/mirror/garments', mirrorGarmentRoute);
router.use('/mirror/outfits', mirrorOutfitRoute);
router.use("/mirror/file-uploads", mirrorFileUploadRoute);
router.use("/mirror/map", mirrorMapRoute);
router.use("/mirror/weather", mirrorWeatherRoute);
router.use("/mirror/voice", mirrorVoiceRoute);
router.use('/mirror/chat-wonder', chatWonderRoute);

export default router;
