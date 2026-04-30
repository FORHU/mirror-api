import express from "express";
import AuthController from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = express.Router();

router.post("/register", AuthController.register);
router.post("/login", AuthController.login);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/logout", authenticate, AuthController.logout);

export default router;
