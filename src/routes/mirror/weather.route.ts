import express from "express";
import WeatherController from "../../controllers/mirror/weather.controller";

const router = express.Router();

router.get("/", WeatherController.getWeather);

export default router;
