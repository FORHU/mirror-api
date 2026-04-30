import express from 'express';
import authRoute from './auth.route';
import userRoute from './user.route';
import fileUploadRoute from './fileUpload.route';

const router = express.Router();

router.get('/v1', (_, res) => {
  res.json({
    message: 'Welcome to node-postg-template API',
  });
});

router.use('/v1/auth', authRoute);
router.use('/v1/users', userRoute);
router.use('/v1/file-uploads', fileUploadRoute);

export default router;
