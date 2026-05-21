import express from "express";
import FileUploadController from "../../controllers/shared/fileUpload.controller";
import FileController from "../../controllers/shared/file.controller";

import { upload } from "../../middleware/upload.middleware";

const router = express.Router();

// Direct multipart uploads (with Sharp processing)
router.post("/upload", upload.single("file"), FileController.upload);
router.post("/upload-many", upload.array("files", 10), FileController.uploadMany);

// S3 Presigned URL flow (legacy/client-side)
router.get("/presign", FileUploadController.presign);
router.post("/confirm", FileUploadController.confirm);

export default router;
