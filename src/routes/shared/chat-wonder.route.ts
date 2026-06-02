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

/**
 * @route POST /api/mirror/chat-wonder/raw
 * @desc Raw passthrough — returns ChatWonder's response exactly as received,
 *       with no persona prompt, parsing, resolver, events, or persistence.
 * @access Private
 */
router.post("/raw", authenticate, ChatWonderController.streamRaw);

export default router;
