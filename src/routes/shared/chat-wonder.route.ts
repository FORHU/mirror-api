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
 * @route POST /api/mirror/chat-wonder/restart
 * @desc Full restart: null the user's gender + force a new ChatWonder session.
 *       Does not clear the itinerary (see POST /api/mirror/outlines/reset).
 * @access Private
 */
router.post("/restart", authenticate, ChatWonderController.restart);

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

/**
 * @route POST /api/mirror/chat-wonder/message
 * @desc Buffered, non-streaming twin of /stream. Same behavior (persistence,
 *       finalization, kiosk emits, session recovery, gender + weather) but
 *       returns a single JSON payload with the full parsed response instead
 *       of SSE.
 * @access Private
 */
router.post("/message", authenticate, ChatWonderController.chat);

export default router;
