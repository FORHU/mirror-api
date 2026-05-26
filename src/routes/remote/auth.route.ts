import express from "express";
import AuthController from "../../controllers/remote/auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
const router = express.Router();

router.post("/login", AuthController.login);
router.post("/google", AuthController.googleAuthSSO);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/logout", authenticate, AuthController.logout);
router.post("/update", authenticate, AuthController.updateProfile);
router.get("/me", authenticate, AuthController.getCurrentUser);

export default router;
