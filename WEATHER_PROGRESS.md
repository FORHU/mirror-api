# Weather Module — Implementation Plan

## Status (2026-05-20)

**Done — service layer is chat-wonder-ready:**
- Prisma schema: **single `WeatherSnapshot` model** (raw observation + derived insight in one row), enums + `latitude`/`longitude` on `UserOutline`. The earlier `WeatherCondition` + `WeatherInsight` two-table split was collapsed — over-engineered for one read path. Pending `prisma migrate dev`.
- Pure utils: `weather.util.ts` (classify, risks, intensity, tags, insight, sentinel).
- Repo: `weather.repository.ts` — `findByOutlineId`, `replaceForOutline` (DELETE+INSERT in one transaction).
- Snapshot service: `ingestObservation(outlineId, observation | null)` — sole write path.
- Insight service: `getForOutline()` — projects insight columns out of `WeatherSnapshot`; sole read path for downstream.
- Type alias: `CosmeticsInput` — structural subset of the snapshot's insight columns. Soft type boundary, not a wall.
- Joi validator: `observationSchema` — for whoever wires chat-wonder.

**Pending:**
1. `npx prisma migrate dev --name add_weather_module` — your call (DB side-effect).
2. Chat-wonder integration — deferred; explicit follow-up by whoever owns that surface.
3. Unit tests — deferred until a test runner is configured.
4. Phase 2: forecast-at-`startTime`, richer event-context, fashion module as a sibling.

> **Flow doctrine:** Open-Meteo is gone; **chat-wonder is the sole writer** of `WeatherCondition`. The snapshot service exposes a single internal entry point — `WeatherSnapshotService.ingestObservation(outlineId, observation)` — called from chat-wonder's response handler when it produces a weather observation alongside its AI reply. No user-facing weather endpoints. Cosmetics reads via `WeatherInsightService`.

---

Two-layer design: raw snapshot (`WeatherCondition`) + derived insight (`WeatherInsight`). Insight is computed synchronously on every snapshot write. Cosmetics engine (Phase 2) reads `WeatherInsight` only — never the raw fields.

> Read [CONTEXT.md](./CONTEXT.md) first if any term is unclear — `UserOutline`, `WeatherCondition`, `WeatherInsight`, "snapshot vs series", and the failure-mode rules are all defined there.

**Phase 1 scope caveat**: the system records the **current** weather at the **current** location at the moment a snapshot is taken. Forecast-at-`startTime` (which would be the architecturally correct read for forward-planned outlines) is **future work**, not Phase 1.

Work top-down. Don't start cosmetics until the foundation lands.

---

## Phase 1 — Foundation

### Critical — Schema

**Status (2026-05-20):** Initial pass staged — models, base fields, and enums exist but five doctrine-breaking gaps remain. Fix list below before `prisma migrate dev`.

- [ ] **Add `latitude` + `longitude` to `UserOutline`.** *(not yet in staged schema)*
  - [ ] `latitude  Float?`
  - [ ] `longitude Float?`
  - [ ] Keep the existing free-text `location: String?` — it's a human-readable label, not coords. Don't unify.

- [x] **Replace `weather Json?` on `UserOutline` with a 1:1 relation.** *(partially done — relation added but cardinality is wrong)*
  - [x] Drop `weather Json?` from the existing schema.
  - [ ] **FIX:** staged schema declares `weather WeatherCondition[]`. Must be `weather WeatherCondition?` (zero-or-one). A `[]` relation invites the accumulation the design forbids — see CONTEXT.md "Snapshots are immutable / 1:1 with UserOutline".
  - [ ] No FK on the UserOutline side. The FK lives on `WeatherCondition.userOutlineId` with `@unique`.

- [x] **Add `WeatherCondition` model.** *(partially done — missing `@unique` and `source`)*
  - [x] `id String @id @default(cuid())`
  - [ ] **FIX:** `userOutlineId` is missing `@unique`. Without it the DB does not enforce the 1:1 — paired with the `[]` above, two rows per outline is legal. Add `@unique`.
  - [x] `userOutline UserOutline @relation(fields: [userOutlineId], references: [id], onDelete: Cascade)`.
  - [x] `temperature: Int`, `humidity: Int`, `uvIndex: Int`, `precipitationProb: Int`, `windSpeed: Int`.
  - [ ] **FIX:** add `source: WeatherSource`. Sentinel/failure-mode handling is load-bearing (CONTEXT.md "Provenance / failure-mode") — every row must carry it.
  - [x] `recordedAt: DateTime @default(now())`.
  - [x] `insight WeatherInsight?`.

- [x] **Add `WeatherInsight` model.** *(partially done — missing `source` mirror)*
  - [x] `id`, `weatherId String @unique`, cascade relation.
  - [x] Denormalized `userOutlineId String` + `@@index([userOutlineId])`.
  - [x] `conditionType: WeatherType`, `intensity: WeatherIntensity`.
  - [ ] **FIX:** add `source: WeatherSource` mirrored from the snapshot so cosmetics can branch without joining through `WeatherCondition`.
  - [x] Risk fields: `oilRisk`, `drynessRisk`, `uvRisk`, `smudgeRisk`, `sweatRisk`.
  - [x] `tags: String[]` (Postgres native, not `Json`). Additive only — don't duplicate values from `WeatherType` / `conditionType`.

- [x] **Enums.** *(partially done — `COLD_WET` and `WeatherSource` missing)*
  - [ ] **FIX:** `WeatherType` is missing `COLD_WET`. `classifyWeather` explicitly returns it for `precip ≥ 50 && temp ≤ 20`; schema currently can't store that classification.
  - [x] `WeatherIntensity { LOW, MEDIUM, HIGH }`.
  - [ ] **FIX:** add `enum WeatherSource { API, SENTINEL }`.

- [ ] **Run `npx prisma format`** before migrating — verify the schema parses. (Will also normalize the missing blank line + `@@index` placement.)
- [ ] **`npx prisma migrate dev --name add_weather_module`** — verify in dev DB. *(Hold until the five FIX items above land — don't migrate a broken cardinality.)*

---

### High — Computation engine (pure functions)

- [x] **Create `src/utils/weather.util.ts`** with pure functions (easy to unit test). *(landed)*
  - [x] `classifyWeather(input) → WeatherType` — priority order (first match wins):
    ```
    precip ≥ 50 && temp ≤ 20   → COLD_WET
    precip ≥ 50                → RAINY
    temp ≥ 30 && humidity ≥ 70 → HOT_HUMID
    temp ≥ 30 && humidity < 50 → HOT_DRY
    temp ≤ 20 && humidity ≤ 40 → COLD_DRY
    otherwise                  → MILD
    ```
  - [ ] `computeRisks(input) → { oilRisk, drynessRisk, uvRisk, smudgeRisk, sweatRisk }` — all clamped 0–100:
    ```
    oilRisk     = clamp(humidity * 0.7 + temperature * 1.2)
    drynessRisk = clamp((100 - humidity) + (20 - temperature))
    uvRisk      = clamp(uvIndex * 10)
    smudgeRisk  = clamp((humidity + precipitationProb) / 2)
    sweatRisk   = clamp(temperature * 2 + humidity * 0.5)
    ```
  - [ ] `intensityFor(risks) → WeatherIntensity`:
    ```
    maxRisk ≥ 80 → HIGH
    maxRisk ≥ 50 → MEDIUM
    otherwise    → LOW
    ```
  - [ ] `buildTags(input) → string[]` — additive descriptors only. **Do not duplicate `WeatherType` values in tags.**
  - [ ] `buildInsight(input) → { conditionType, intensity, ...risks, tags }` — composes the above.
  - [ ] `sentinelObservation() → input` — returns a canonical "we don't know" reading (e.g. mild defaults). Used by the snapshot service when Open-Meteo fails. Lets `buildInsight` still produce *something* the engine can consume, paired with `source: SENTINEL`.

- [ ] **Unit tests for `weather.util.ts`.** *(deferred — project has no test runner configured. Adding one is out of scope for this PR; tests should land in a follow-up that sets up the runner.)* Pure functions = easy targets:
  - [ ] Each `WeatherType` branch + boundary cases (temp = 20, humidity = 70, etc.).
  - [ ] Priority order verified (HOT_HUMID + RAINY input → RAINY).
  - [ ] Risk clamping (verify nothing escapes 0–100).
  - [ ] Intensity tier transitions at 49/50/79/80.
  - [ ] Tag set determinism for canonical inputs.
  - [ ] `sentinelObservation()` produces a stable, conservative reading (intensity = LOW, no risky tags).

---

### ~~High — Open-Meteo integration~~ — **REMOVED**

Chat-wonder owns the observation now. `src/utils/open-meteo.util.ts` was deleted along with the user-facing endpoints + Joi validation. The original Open-Meteo plan kept here struck-through for history; do not implement.

- [x] ~~**Create `src/utils/open-meteo.util.ts`.**~~ *(deleted in flow refactor)*
  - [ ] `fetchCurrentWeather(lat, lng) → observation | null` — calls `https://api.open-meteo.com/v1/forecast` with:
    - `current=temperature_2m,relative_humidity_2m,wind_speed_10m`
    - `hourly=precipitation_probability,uv_index` (current-hour values; Open-Meteo's `current` block doesn't expose these)
    - Pass `&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm` explicitly.
  - [ ] Pluck the **hourly value at the current hour** for `precipitation_probability` and `uv_index` — find the index in `hourly.time[]` matching `current.time`.
  - [ ] Use `axios` (already a dep) and the existing `logger`.
  - [ ] **Failure handling: never throw to caller.** On non-200, timeout, or malformed response → `logger.warn(...)` + return `null`. The snapshot service handles `null` by writing a `SENTINEL` row. (Plan-wide reminder: callers must never be blocked by a weather outage.)
  - [ ] No API key needed for free tier; placeholder `OPEN_METEO_API_KEY` config if traffic ever needs the commercial tier.

- [ ] **Open-Meteo → schema mapping**:
  | Open-Meteo                              | `WeatherCondition`   | Unit                     |
  |---|---|---|
  | `current.temperature_2m`                | `temperature`        | °C (Int, round)          |
  | `current.relative_humidity_2m`          | `humidity`           | % (Int)                  |
  | `hourly.uv_index[i]`                    | `uvIndex`            | 0–11+ (Int, round)       |
  | `hourly.precipitation_probability[i]`   | `precipitationProb`  | % (Int)                  |
  | `current.wind_speed_10m`                | `windSpeed`          | km/h (Int, round)        |

  The schema field is named **`precipitationProb`** specifically so this can't be confused with `current.precipitation` (mm of rain). Never wire that field — the formulas assume %.

---

### High — Services (with boundary enforcement)

Two services. **Cosmetics imports only the second.** Imports are the boundary.

- [x] **`src/services/shared/weather-snapshot.service.ts`** — handles raw snapshot lifecycle. Cosmetics never imports this. *(landed, refactored to chat-wonder flow)*

  Current signature: `ingestObservation(outlineId, observation | null) → { weather, insight }`. The old `snapshotForOutline` / `snapshotWithCoords` (Open-Meteo callers) are gone.
  - [ ] `snapshotForOutline(outlineId: string) → { weather, insight }` — the **single entry point** for taking a snapshot.
    1. Load outline → read `latitude`, `longitude`. If either missing → throw `{ status: 422, message: "Outline has no coordinates set" }`.
    2. Call `fetchCurrentWeather(lat, lng)` — returns observation or `null`.
    3. `observation = result ?? sentinelObservation()`; `source = result ? "API" : "SENTINEL"`.
    4. In a **single transaction**: DELETE any existing `WeatherCondition` for this outline (cascades to insight), then CREATE the new `WeatherCondition` + nested `insight` with `buildInsight(observation)`. Both rows carry `source`.
    5. Return the new pair.
  - [ ] `snapshotWithCoords(outlineId, lat, lng) → { weather, insight }` — variant for client-push case. Updates `UserOutline.latitude`/`longitude` first, then calls `snapshotForOutline`.

- [x] **`src/services/shared/weather-insight.service.ts`** — the only API cosmetics imports. *(landed)*
  - [x] `getForOutline(outlineId: string) → CosmeticsInput | null`.
  - [x] If no snapshot exists yet → returns `null`.

- [x] **`CosmeticsInput` type** — `src/types/cosmetics-input.ts`. *(landed)*
  - [x] Shape: `{ conditionType, intensity, oilRisk, drynessRisk, uvRisk, smudgeRisk, sweatRisk, tags, source }`.
  - [x] Cosmetics functions will accept `CosmeticsInput`, not `WeatherInsight`.

---

### ~~Medium — API surface~~ — **REMOVED**

Endpoints were deleted in the flow refactor. Chat-wonder is the sole writer; downstream services read via `WeatherInsightService`. There is no user-facing weather route.

### Medium — Chat-wonder integration *(deferred to next phase — service layer is ready)*

**Service-layer ready check (done):**
- `WeatherSnapshotService.ingestObservation(outlineId, observation | null)` is the single entry point.
- `src/validations/weather.validation.ts` exports `observationSchema` — Joi validator chat-wonder will use to validate its parsed payload before calling the service.
- `WeatherInsightService.getForOutline()` is unchanged — downstream readers continue to use it.
- Build compiles clean.

**Remaining work (whoever wires chat-wonder picks up here):**
- [ ] **Extend the chat-wonder prompt** (`ChatWonderService.getAdditionalPrompt`) to ask for a `weather` field in the response JSON:
  ```json
  { "message": "...", "outfit_suggestion": "...", "mood": "...",
    "weather": { "temperature": 28, "humidity": 75, "uvIndex": 6,
                 "precipitationProb": 20, "windSpeed": 10 } }
  ```
  Match `WeatherObservation` shape exactly.
- [ ] **Extend `parseChatWonderResponse`** to extract the `weather` field, validate with Joi against `WeatherObservation`, and return `null` if malformed.
- [ ] **Resolve `outlineId` from `conversationId`** in the chat-wonder `onComplete` callback. The schema already has `Conversation.userOutline UserOutline?` (1:1 via `UserOutline.conversationId @unique`). If no outline exists yet, decide: auto-create or skip the snapshot for this turn.
- [ ] **Call `WeatherSnapshotService.ingestObservation(outlineId, parsedWeather)`** in `onComplete`. Pass `null` if chat-wonder didn't return weather — SENTINEL handles the rest.
- [ ] **Open question: hallucination risk.** Chat-wonder is an LLM. Asking it to *generate* weather numbers gets you confabulation, not real weather. Resolve before wiring: does chat-wonder's backend have a real weather provider it consults (Open-Meteo, WeatherAPI, etc.), or does the user feed weather into the prompt some other way? If neither, the observation is fake — and SENTINEL is the honest label for *every* row.

---

### Medium — Operational

- [x] **No raw-weather TTL needed** — confirmed by design (1:1 + cascade).
- [ ] **Formula change path.** If `buildInsight` changes: write a one-off migration that re-derives every insight from its `WeatherCondition`. Document in the formula-change PR. *(deferred — no formula churn yet.)*
- [x] **`SENTINEL` rate monitoring** — `logger.warn` fires on every SENTINEL write in `WeatherSnapshotService`. Metrics dashboard is out of scope.
- [x] **Cache** — skipped, per plan.

---

### Minor

- [ ] **Joi validation on observation input** (if a test/admin endpoint ever accepts raw observations):
  - [ ] `temperature: integer().min(-40).max(60)` °C
  - [ ] `humidity: integer().min(0).max(100)`
  - [ ] `uvIndex: integer().min(0).max(15)`
  - [ ] `precipitationProb: integer().min(0).max(100)`
  - [ ] `windSpeed: integer().min(0).max(300)`
- [ ] **Drop the stale comment.** The old `// Cached weather data for that time` makes no sense on a real FK.
- [ ] **PII**: latitude/longitude are sensitive. A retention policy (scrub coords from old outlines after N months) is a future concern, not Phase 1.

---

## Phase 2 — Cosmetics Engine (out of scope here — mapped for visibility)

> Don't start until Phase 1 is merged and tested. Lives in `src/services/shared/cosmetics.service.ts` and imports **only** `WeatherInsightService` (`CosmeticsInput` type).

| `conditionType` | tag hints | recommend |
|---|---|---|
| HOT_HUMID | HIGH_UV | matte foundation, SPF 50+, waterproof mascara |
| RAINY     | WET     | transfer-proof lip, waterproof eyeliner |
| COLD_WET  | —       | water-resistant + hydrating |
| COLD_DRY  | DRY     | hydrating primer, dewy finish, lip balm |
| HOT_DRY   | HIGH_UV | hydrating mist, SPF 50+, oil-free |
| MILD      | —       | flexible — defer to user preference |

**Sentinel handling**: cosmetics must check `input.source === "SENTINEL"` and behave conservatively (skip product picks that hinge on accurate weather, or surface a "weather unavailable" badge).

Engine takes `CosmeticsInput` and returns a sorted list of `Cosmetics`. The rule table above probably becomes a `recommendationRule` table once rules stabilize.

---

## Verification (Phase 1)

Walk through end-to-end before merging:

- [ ] `npx prisma migrate dev` runs cleanly.
- [ ] `snapshotForOutline(outlineId)` writes one `WeatherCondition` + one `WeatherInsight` transactionally; both have `source: API` when Open-Meteo is healthy.
- [ ] Open-Meteo failure (simulate by hitting a bad URL) → row still written, `source: SENTINEL`, no exception propagated to caller.
- [ ] Calling `snapshotForOutline(outlineId)` a second time deletes the old row and writes a new one (different `id`, new `recordedAt`).
- [ ] `WeatherCondition.userOutlineId` is `@unique`; trying to write two rows for the same outline manually fails the constraint.
- [ ] `WeatherInsight.tags` is a real Postgres array, not stringified JSON.
- [ ] Unit tests for `weather.util.ts` pass; no risk escapes 0–100; conflict inputs (HOT_HUMID + RAINY) classify as RAINY.
- [ ] `WeatherInsightService.getForOutline` returns only the insight fields (`CosmeticsInput` shape); a TypeScript test confirms `cosmeticsFn(condition)` doesn't compile when passed a raw `WeatherCondition`.
- [ ] Cosmetics service (when Phase 2 lands) imports `WeatherInsightService` only — `grep -r "WeatherSnapshotService" src/services/.../cosmetics` returns nothing.
- [ ] `POST /api/remote/outlines/:id/weather` with no coords on the outline and no body → 422.
- [ ] `POST /api/remote/outlines/:id/weather` with `{ latitude, longitude }` → updates outline coords + writes snapshot.
- [ ] `GET /api/remote/outlines/:id/weather` returns the standard envelope `{ status: "success", statusCode: 200, data: { ... } }`.
- [ ] Auth: a user can only read/write weather for outlines they own.
