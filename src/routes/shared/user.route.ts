import express from 'express';
import UserController from '../../controllers/shared/user.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.get('/me', authenticate, UserController.getMe);
router.get('/', UserController.index);

export default router;
