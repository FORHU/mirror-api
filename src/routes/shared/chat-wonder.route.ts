import express from "express";
import ChatWonderController from "../../controllers/shared/chat-wonder.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

/**
 * @route GET /api/v1/chat-wonder/session-id
 * @desc Get a ChatWonder session ID for the user
 * @access Private
 */
router.get("/session-id", authenticate, ChatWonderController.getSessionId);

/**
 * @route POST /api/v1/chat-wonder/stream
 * @desc Stream chat responses using SSE
 * @access Private
 */
router.post("/stream", authenticate, ChatWonderController.streamChat);

export default router;
