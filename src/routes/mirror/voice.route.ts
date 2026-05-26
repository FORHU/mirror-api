import express from "express";
import VoiceController from "../../controllers/mirror/voice.controller";

const router = express.Router();

router.post(
  "/transcribe",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  VoiceController.transcribe
);

router.post("/ask", express.json(), VoiceController.ask);

router.post("/tts", express.json(), VoiceController.tts);

router.post("/suggest", express.json(), VoiceController.suggest);

export default router;
