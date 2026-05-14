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
import mirrorGenerationRoute from './shared/generation.route';
import chatWonderRoute from './shared/chat-wonder.route';

// --- Proposed renames (delete the originals above, then uncomment these) ---
// import sharedUserRoute from './shared/user.route';
// import sharedGarmentRoute from './shared/garment.route';
// import sharedOutfitRoute from './shared/outfit.route';
// import sharedFileUploadRoute from './shared/fileUpload.route';
// import sharedGenerationRoute from './shared/generation.route';
// import sharedChatWonderRoute from './shared/chat-wonder.route';

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
router.use('/remote/generation', mirrorGenerationRoute);
router.use('/remote/file-uploads', mirrorFileUploadRoute);
router.use('/remote/garments', mirrorGarmentRoute);
router.use('/remote/outfits', mirrorOutfitRoute);

// --- Proposed: same mounts, but using the renamed `shared*Route` imports ---
// router.use('/remote/users', sharedUserRoute);
// router.use('/remote/generation', sharedGenerationRoute);
// router.use('/remote/file-uploads', sharedFileUploadRoute);
// router.use('/remote/garments', sharedGarmentRoute);
// router.use('/remote/outfits', sharedOutfitRoute);

// --- Proposed: chat-wonder is phone-facing, move from /mirror to /remote ---
// router.use('/remote/chat-wonder', sharedChatWonderRoute);

// --- Proposed: try-on is called by the phone; mount at /remote too ---
// router.use('/remote/try-on', mirrorTryOnRoute);

// Mirror endpoints
// router.use('/mirror/garments', mirrorGarmentRoute);
// router.use('/mirror/outfits', mirrorOutfitRoute);
router.use('/mirror/try-on', mirrorTryOnRoute);
router.use('/mirror/chat-wonder', chatWonderRoute);

export default router;
