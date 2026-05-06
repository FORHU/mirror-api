import express from "express";
import KioskController from "../../controllers/remote/kiosk.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.use(authenticate); // Only logged-in users can control kiosks

router.post("/connect", KioskController.connect);
router.post("/disconnect", KioskController.disconnect);
router.post("/command", KioskController.sendCommand);

export default router;
