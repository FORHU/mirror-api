import express from "express";
import FileUploadController from "../../controllers/shared/fileUpload.controller";
import { authenticate } from "../../middleware/auth.middleware";

const router = express.Router();

router.get("/presign", authenticate, FileUploadController.presign);
router.post("/confirm", authenticate, FileUploadController.confirm);

export default router;
