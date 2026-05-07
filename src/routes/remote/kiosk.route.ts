import express from "express";
import KioskController from "../../controllers/remote/kiosk.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.post("/notify-scanning", KioskController.notifyScanning);
router.post("/clear-all", KioskController.clearAll);

router.use(authenticate); // Only logged-in users can control kiosks

router.post("/connect", KioskController.connect);
router.post("/disconnect", KioskController.disconnect);
router.post("/command", KioskController.sendCommand);

export default router;
