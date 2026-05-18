import express from "express";
import ChatWonderController from "../../controllers/shared/chat-wonder.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

/**
 * @route POST /api/v1/chat-wonder/stream
 * @desc Stream chat responses using SSE
 * @access Private
 */
router.post("/stream", authenticate, ChatWonderController.streamChat);

export default router;
