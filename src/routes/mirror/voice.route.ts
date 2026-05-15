import express from "express";
import VoiceController from "../../controllers/mirror/voice.controller";

const router = express.Router();

router.post(
  "/process",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  VoiceController.process
);

export default router;
