import express from "express";
import TryOnController from "../controllers/tryOn.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = express.Router();

router.post("/run", authenticate, TryOnController.run);

export default router;
