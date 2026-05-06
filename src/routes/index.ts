import express from 'express';

// Remote Routes (Mobile Web)
import remoteAuthRoute from './remote/auth.route';
import remoteUserRoute from './shared/user.route';

// Mirror Routes (Kiosk Web)
import mirrorKioskRoute from './mirror/kiosk.route';
import mirrorTryOnRoute from './mirror/tryOn.route';
import mirrorGarmentRoute from './shared/garment.route';
import mirrorOutfitRoute from './shared/outfit.route';
import mirrorInteractionRoute from './shared/interaction.route';
import mirrorFileUploadRoute from './shared/fileUpload.route';

const router = express.Router();

router.get('/v1', (_, res) => {
  res.json({
    message: 'Welcome to mirror-api',
  });
});

// Remote endpoints
router.use('/v1/remote/auth', remoteAuthRoute);
router.use('/v1/remote/users', remoteUserRoute);

// Mirror endpoints
router.use('/v1/mirror/kiosks', mirrorKioskRoute);
router.use('/v1/mirror/try-on', mirrorTryOnRoute);
router.use('/v1/mirror/garments', mirrorGarmentRoute);
router.use('/v1/mirror/outfits', mirrorOutfitRoute);
router.use('/v1/mirror/interactions', mirrorInteractionRoute);
router.use('/v1/mirror/file-uploads', mirrorFileUploadRoute);

export default router;
