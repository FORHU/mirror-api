# Domain Glossary

The canonical vocabulary for the mirror-api domain. Implementation details belong elsewhere — this file is for terms only.

---

## UserOutline

A **situational context container** for a specific user scenario or session. Not the user themselves, and not a persisted "event" or "plan" — closer to a *situational AI profile* that captures what the user is doing, where, when, and in what context.

Aggregates the inputs that downstream features (outfit, cosmetics, weather, recommendations) need to be aware of: free-text prompt, location, start time, weather observations, calendar links, generated outfits, cosmetics suggestions.

**Not to be confused with**:
- `User` — the persistent identity. A `User` has many `UserOutline`s over time.
- `Outfit` — the visual/clothing result. Belongs to an outline, not the other way around.

**Example**: User "John Doe" → `UserOutline` "John Doe going to a mall on Sunday at 6PM with a planned outfit + weather context". The outline is the *situation*, not the person — it lets the system answer "what should John wear **for this specific situation**" rather than the much vaguer "what should John wear".

**Lifecycle**:
- **Forward-planned (conceptually)**: an outline can describe a *future* situation. `startTime` is the moment the situation actually happens.
- **Concurrent**: a user can have many outlines in flight at once.
- **Persistent**: outlines are not deleted when `startTime` passes — they stay as history.

**Current scope (Phase 1 caveat)**:
The system currently treats weather + location as **"now"** — the present-time observation at the user's present-time location — not the forecast at `startTime`. This works for outlines that describe imminent situations ("I'm about to go to the mall") and is wrong-but-good-enough for ones that describe future ones ("Sunday at the mall"). True forecast-for-startTime is a deliberate **future** capability, not Phase 1.

---

## WeatherSnapshot

**Weather is not history data — it is input to a decision engine.**

A `WeatherSnapshot` is a single row capturing the weather at the moment a decision is being made for a `UserOutline`. It carries both the **raw observation** (temperature, humidity, uvIndex, precipitationProb, windSpeed) and the **derived insight** (conditionType, intensity, risk fields, tags). One row, two roles — written together, read by whichever consumer needs which.

**1:1 with `UserOutline`.** Enforced at the DB by `userOutlineId @unique`. Not a time-series; we are modeling **decision context**.

**Snapshots are immutable.** "Replacing" means DELETE the existing row + INSERT a new one in a single transaction. We never UPDATE in place — that would silently shift `recordedAt` and break any reference to the snapshot id as "what the system saw at moment X."

**Provenance / failure-mode**: `source: WeatherSource` is either `API` (real data from chat-wonder's upstream) or `SENTINEL` (chat-wonder didn't provide weather; we wrote conservative defaults so the decision pipeline isn't blocked). Cosmetics (and any other consumer) should treat `SENTINEL` rows conservatively — skip picks that hinge on accurate weather, or surface a "weather unavailable" badge.

**Trigger**: **chat-wonder is the sole writer.** As chat-wonder processes a user conversation, it produces a weather observation alongside its AI response. The chat-wonder response handler calls `WeatherSnapshotService.ingestObservation(outlineId, observation)`. There is no user-facing weather endpoint. Downstream services (cosmetics, fashion) read via `WeatherInsightService.getForOutline()` — they never write.

**Why centralize on chat-wonder**: the conversation is where situational context is first known. By the time chat-wonder has parsed "I'm going to the mall at 6PM," it already needs weather to give a useful answer — so it's the natural place to ground the snapshot.

**Raw vs insight, one table**: an earlier design kept these in two tables (`WeatherCondition` + `WeatherInsight`). Collapsed because the insight is a pure function of the observation, there is exactly one read path, and the two-table split was paying complexity for an abstraction nothing exercised. The doctrinal separation lives in code instead — `WeatherInsightService` projects only the insight columns, and the `CosmeticsInput` type exposes only that subset so downstream consumers can't silently start reading raw fields.

**Location**: `UserOutline` carries `latitude` + `longitude` (in addition to its existing free-text `location` for display). Coords are not stored on the snapshot itself — single source of truth is the outline. Snapshots get replaced when context changes, so "what coords did this snapshot use" is always "the outline's current coords."

**PII note**: latitude/longitude are sensitive. A retention policy (when to scrub coords from old outlines) is a future concern, not Phase 1.

---

## CosmeticProduct

A **catalog entry** for a real-world cosmetic product. Exists independently of any `UserOutline` — products live in a shared catalog, get recommended N times across N outlines, and don't get duplicated per recommendation.

**Carries the attributes the engine matches against**: `tags: String[]` (shared vocabulary with `WeatherSnapshot.tags` — HOT, HUMID, HIGH_UV, …), plus structured fields the rules need to query (`finish`, `spf`, `waterproof`, `transferProof`, `hydrating`, `oilFree`). Display fields (`name`, `brand`, `imageUrl`, `hexColor`) are for UI only — the engine doesn't read them.

**Not to be confused with**:
- `CosmeticRecommendation` — the *decision* that a product fits a specific outline. A product is a thing; a recommendation is a verb's worth of state.

---

## CosmeticRecommendation

A single **decision row**: "for this outline, with this insight, we picked this product, with this score, for these reasons." 1:many with `UserOutline` (an outline gets several recommendations, ranked).

**Provenance**: each recommendation references the `WeatherSnapshot` it was derived from. This is the audit trail — if a user asks "why was this picked," the system can point to the snapshot (which carries `source`, so `SENTINEL`-derived recommendations are distinguishable from real ones).

**Re-decision**: when an outline's snapshot is replaced, recommendations for that outline should be wiped and regenerated. Same doctrine as weather: replacement is a wholesale DELETE + INSERT, not an UPDATE. We don't try to reconcile old recommendations against a new snapshot.

**Boundary**: recommendations are output, not input. Nothing downstream of the engine writes them; the engine is the sole writer.

---

## Cosmetics Engine

The function `cosmeticsEngine(input: CosmeticsInput) → CosmeticRecommendation[]`. Pure transformation of insight → ranked recommendations.

**Reads only the insight columns** via `WeatherInsightService.getForOutline()`, which returns the `CosmeticsInput` shape. Does not read the raw observation fields. Does not read GPS coords.

**Rules live in code** (Phase 1) — a hardcoded table mapping `conditionType` + tag presence → product-attribute predicates. Each product gets a score per outline; the top-N by score become `CosmeticRecommendation` rows. A `RecommendationRule` table is a Phase 2+ concern, deferred until rules stabilize or non-engineers need to edit them.

**Sentinel handling**: if `input.source === "SENTINEL"`, the engine behaves conservatively — skip recommendations that hinge on accurate weather (e.g. don't insist on SPF 50+ when UV reading is fabricated), or surface a "weather unavailable" flag on the output.

---

## Pipeline

The decision pipeline. Each arrow is the *only* legal transformation between layers:

```
UserOutline              (context  — who, where, when, why)
   ↓
WeatherSnapshot          (raw observation + derived insight, one row)
   ↓
Cosmetics Engine         (pure function — reads insight columns, queries product catalog)
   ↓
CosmeticRecommendation[] (output  — ranked decisions, audit-linked to the snapshot)
```

`CosmeticProduct` sits *beside* this pipeline, not in it — the engine queries the catalog as a lookup, the catalog is not transformed.

Each layer is conceptually distinct, even when 1:1 in cardinality. Don't blur them.
