import express from "express";
import { upload } from "../middleware/upload.middleware";
import FileUploadController from "../controllers/fileUpload.controller";

const router = express.Router();

router.post("/upload", upload.single("file"), FileUploadController.upload);

export default router;
