import express from 'express';
import authRoute from './auth.route';
import userRoute from './user.route';
import fileUploadRoute from './fileUpload.route';
import garmentRoute from './garment.route';
import outfitRoute from './outfit.route';
import interactionRoute from './interaction.route';
import kioskRoute from './kiosk.route';
import tryOnRoute from './tryOn.route';

const router = express.Router();

router.get('/v1', (_, res) => {
  res.json({
    message: 'Welcome to mirror-api',
  });
});

router.use('/v1/auth', authRoute);
router.use('/v1/users', userRoute);
router.use('/v1/file-uploads', fileUploadRoute);
router.use('/v1/garments', garmentRoute);
router.use('/v1/outfits', outfitRoute);
router.use('/v1/interactions', interactionRoute);
router.use('/v1/kiosks', kioskRoute);
router.use('/v1/try-on', tryOnRoute);

export default router;
