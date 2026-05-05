import { Request, Response, NextFunction } from "express";
import FileUploadService from "../services/fileUpload.service";

export default class FileUploadController {
  /**
   * Upload a single file (field name: "file")
   */
  static async upload(req: Request, res: Response, next: NextFunction) {
    if (!req.file) return next({ status: 400, message: "No file uploaded" });

    try {
      const data = await FileUploadService.upload(req.file);
      return res.json({
        status: "success",
        data,
        message: "File uploaded successfully",
      });
    } catch (err) {
      next(err);
    }
  }
}
