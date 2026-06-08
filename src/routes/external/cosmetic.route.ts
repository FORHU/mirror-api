import express from "express";
import ExternalCosmeticController from "../../controllers/external/cosmetic.controller";

const router = express.Router();

router.get("/", ExternalCosmeticController.index);

export default router;
