import express from "express";
import ExternalGarmentController from "../../controllers/external/garment.controller";

const router = express.Router();

router.get("/", ExternalGarmentController.index);
router.get("/:id", ExternalGarmentController.show);

export default router;
