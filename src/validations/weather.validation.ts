import Joi from "joi";
import type { WeatherObservation } from "../utils/weather.util";

// The shape `WeatherSnapshotService.ingestObservation` expects.
// Whoever wires chat-wonder (or any other future writer) validates against
// this before calling the service — keeps service contract clean.
//
// Bounds defend against malformed upstream payloads; ranges are intentionally
// loose (the recorded extremes for each metric, not "comfortable" ranges).
// Anything outside these almost certainly indicates a bad payload, not weather.
export const observationSchema = Joi.object<WeatherObservation>({
  temperature: Joi.number().integer().min(-40).max(60).required(),
  humidity: Joi.number().integer().min(0).max(100).required(),
  uvIndex: Joi.number().integer().min(0).max(15).required(),
  precipitationProb: Joi.number().integer().min(0).max(100).required(),
  windSpeed: Joi.number().integer().min(0).max(300).required(),
});
