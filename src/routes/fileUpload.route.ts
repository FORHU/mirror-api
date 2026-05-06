import express from "express";
import { upload } from "../middleware/upload.middleware";
import FileUploadController from "../controllers/fileUpload.controller";

import { authenticate } from "../middleware/auth.middleware";

const router = express.Router();

router.post("/upload", authenticate, upload.single("file"), FileUploadController.upload);

export default router;
