import express from "express";
import VoiceController from "../../controllers/mirror/voice.controller";

const router = express.Router();

router.post(
  "/process",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  VoiceController.process
);

router.post("/tts", express.json(), VoiceController.tts);

export default router;
