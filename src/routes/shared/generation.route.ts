import express from "express";
import GenerationController from "../../controllers/shared/generation.controller";
// import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.post("/", GenerationController.generate);

export default router;
