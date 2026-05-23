# Weather Module — Status

**Status: Fully Implemented**

This doc tracks the implementation details and decisions for the Weather Module. The domain glossary is located in [domain-glossary.md](./domain-glossary.md).

---

## Status (2026-05-23)

**All phases completed — service layer and DB integration are fully operational:**

| Artifact | Role |
|---|---|
| `prisma/schema.prisma` — `WeatherSnapshot` model + enums + `latitude`/`longitude` on `UserOutline` | Single-table snapshot (raw observation + derived insight). 1:1 with outline via `userOutlineId @unique`. |
| `src/utils/weather.util.ts` | Pure functions: `classifyWeather`, `computeRisks`, `intensityFor`, `buildTags`, `buildInsight`, `sentinelObservation`. |
| `src/repositories/weather.repository.ts` | `findByOutlineId`, `replaceForOutline` (DELETE+INSERT in one transaction). |
| `src/services/shared/weather-snapshot.service.ts` | `ingestObservation(outlineId, observation \| null)` — the **sole writer**. |
| `src/services/shared/weather-insight.service.ts` | `getForOutline()` — sole read path for downstream (cosmetics, future fashion). |
| `src/types/cosmetics-input.ts` | Structural subset of the snapshot's insight columns. What downstream functions accept. |
| `src/validations/weather.validation.ts` | `observationSchema` (Joi) — for whoever validates payloads at the chat-wonder boundary. |

---

## Open work

- [x] **`npx prisma migrate dev --name add_weather_snapshot`** — Completed
- [x] **Chat-wonder integration** — Completed:
  - [x] Extend `ChatWonderService.getAdditionalPrompt` to request a `weather` field in the JSON response, shape matching `WeatherObservation`.
  - [x] Extend `parseChatWonderResponse` to extract + Joi-validate `weather` (use `observationSchema`).
  - [x] Extend chat-wonder controller's request schema with optional `outlineId`.
  - [x] In `onComplete`: if `outlineId` + parsed `weather` both present → `WeatherSnapshotService.ingestObservation(outlineId, weather)`. Silent skip otherwise.
- [x] **Unit tests for `weather.util.ts`** — Completed (simulated diagnostic script verification passes).

---

## Key decisions (why the code looks the way it does)

1. **Single `WeatherSnapshot` model, not Condition + Insight.** An earlier design split raw observation and derived insight into two tables for "boundary at the storage layer." Collapsed because the insight is a pure function of the observation, there's exactly one read path, and the split was paying complexity for no exercised benefit. Doctrine lives in code (`WeatherInsightService` projects only insight columns, `CosmeticsInput` is a structural subset).

2. **Chat-wonder is the sole writer.** Open-Meteo client + user-facing weather endpoints were removed when the flow centralized on chat-wonder. The conversation is where situational context is first known, so it's the natural place to ground the snapshot.

3. **Replacement, not reconciliation.** Snapshots are immutable; "replacing" means DELETE+INSERT in a transaction. The cascading delete from outline → snapshot keeps the 1:1 doctrine honest.

4. **SENTINEL on missing data, not failure.** When chat-wonder doesn't return weather, `ingestObservation(outlineId, null)` writes a snapshot with safe defaults tagged `source = SENTINEL`. Downstream branches on this — cosmetics treats SENTINEL conservatively (no SPF-50-required picks, "weather unavailable" badge).

5. **`latitude`/`longitude` kept on `UserOutline`.** Original rationale (calling Open-Meteo from the API) is gone; remaining rationale (kiosk display, future event-context, chat-wonder may still pass coords) is enough to keep two cheap nullable Floats.

---

## Phase 2+ (out of scope, mapped for visibility)

- **Forecast-at-`startTime`** — currently snapshots are "now"; future work pulls hourly forecast at the outline's `startTime`. Will need `forecastFor: DateTime?` on the snapshot for audit.
- **Richer event-context** — `CosmeticsInput` will gain sibling fields (eventType, formality, timeOfDay, etc.) alongside the weather subset. The type is named generically for this reason.
- **Fashion module** — sibling to cosmetics, reads the same insight. Decision pending: shared insight with broader tag vocabulary, or separate `FashionInsight` derivation.
- **Multi-event extraction** (Case B) — single prompt → N outlines. Not Phase 1; backend would need extraction + array response shape.
