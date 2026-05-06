import express from 'express';

// Remote Routes (Mobile Web)
import remoteAuthRoute from './remote/auth.route';
import remoteUserRoute from './shared/user.route';
import remoteKioskRoute from './remote/kiosk.route';

// Mirror Routes (Kiosk Web)
import mirrorTryOnRoute from './mirror/tryOn.route';
import mirrorGarmentRoute from './shared/garment.route';
import mirrorOutfitRoute from './shared/outfit.route';
import mirrorInteractionRoute from './shared/interaction.route';
import mirrorFileUploadRoute from './shared/fileUpload.route';

const router = express.Router();

router.get('/', (_, res) => {
  res.json({
    message: 'Welcome to mirror-api',
  });
});

// Remote endpoints
router.use('/remote/auth', remoteAuthRoute);
router.use('/remote/users', remoteUserRoute);
router.use('/remote/kiosks', remoteKioskRoute);

// Mirror endpoints
router.use('/mirror/try-on', mirrorTryOnRoute);
router.use('/mirror/garments', mirrorGarmentRoute);
router.use('/mirror/outfits', mirrorOutfitRoute);
router.use('/mirror/interactions', mirrorInteractionRoute);
router.use('/mirror/file-uploads', mirrorFileUploadRoute);

export default router;
