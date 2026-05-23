# Cosmetics Module — Implementation Plan

**Status: Fully Implemented**

This document tracks the implementation plan and decisions for the Cosmetics Module.

---

## Status (2026-05-23) — Per-user skin-analysis flow completed

**Done today** (pivot from outline-anchored to per-user, driven by the kiosk Skin Analysis screen):
- `CosmeticProduct` extended: `category` (FACE/EYES/LIPS), `priceAmount`/`priceUnit`, `tags[]`, `benefits[]`, `spf`, `waterproof`, `transferProof`, `hydrating`, `oilFree`, `finish`.
- `COSMETIC_TYPE` enum extended with skincare values: `SUNSCREEN, MOISTURIZER, EXFOLIANT, SERUM, CLEANSER, TONER, ESSENCE`.
- New enums: `COSMETIC_CATEGORY`, `COSMETIC_FINISH`, `SKIN_TYPE`.
- New model `SkinAnalysis` (per-user, links optional `WeatherSnapshot`, owns recommendations).
- `CosmeticRecommendation`: `userOutlineId` made nullable, added `skinAnalysisId` (Cascade) so recs anchor on either an outline (legacy) or a skin analysis (new).
- Rule engine `src/utils/cosmetics.util.ts` (`scoreProduct`, `rankProducts`) — pure function, weather-aware, concern-keyword based.
- Vision integration: `OpenAIService.analyzeFaceImage(imageUrl)` returns structured `SkinVisionResult` (gpt-4o, JSON response_format).
- New layers: `skin-analysis.repository.ts`, `skin-analysis.service.ts` (vision → engine → atomic persist), `skin-analysis.controller.ts`, `skin-analysis.route.ts`.
- Routes mounted at `/api/remote/skin-analyses` and `/api/mirror/skin-analyses`.

**Endpoints now live:**
- `POST   /api/remote/skin-analyses`        body `{ fileId, weatherSnapshotId? }` — runs the pipeline, returns analysis + recommendations
- `GET    /api/remote/skin-analyses`        paginated, current user's history
- `GET    /api/remote/skin-analyses/:id`    full analysis with `file`, `weatherSnapshot`, `recommendations.cosmeticProduct.fileUrl`
- `DELETE /api/remote/skin-analyses/:id`

**Frontend contract:** two-step upload — UI calls `POST /file-uploads` first, then passes the returned `fileId` (and optional `weatherSnapshotId`) here.

**Checklist:**
- [x] Run migration: `npx prisma migrate dev --name add_skin_analysis`
- [x] Seed catalog data (skincare products covering the rule matrix populated with tags, spf, hydrating, etc.)
- [x] Companion-app dashboard adapter updated

---

## Status (2026-05-20) — Original plan (kept for reference)

**Done:**
- Plan written; glossary entries in `CONTEXT.md`.
- Upstream dependency (`WeatherInsightService.getForOutline()`) is implemented and chat-wonder-ready — cosmetics can read insights as soon as the weather migration lands.

**Pending — nothing implemented yet:**
1. Schema changes (rename `Cosmetics` → `CosmeticProduct`, add `CosmeticRecommendation`, `CosmeticFinish` enum). See "Critical — Schema" below.
2. Engine (`cosmetics.util.ts`) — pure rule application.
3. Services: `cosmetics-recommendation.service.ts`, `cosmetic-product.service.ts`.
4. API surface (admin catalog routes + outline-scoped recommendation routes).
5. Seed data (6–10 products covering the rule matrix).

**Recommendation:** bundle the cosmetics schema changes with the weather migration into a single `add_weather_and_cosmetics` migration — one DB touch, less chance of leaving the schema half-done. Holds only if `Cosmetics.userOutlineId` has no production data to preserve (open question below).

---

Mirrors the weather pattern: **catalog** (`CosmeticProduct`) + **decision** (`CosmeticRecommendation`). The engine is a pure function `insight → ranked recommendations`. Cosmetics imports `WeatherInsightService` only — never raw `WeatherCondition`.

> Read [domain-glossary.md](./domain-glossary.md) first — `CosmeticProduct`, `CosmeticRecommendation`, "Cosmetics Engine", and the boundary rules are all defined there.

> Read [weather-progress.md](./weather-progress.md) — this plan assumes the weather schema has landed and migrated. Don't start cosmetics work before that.

---

## Decisions (override before writing code)

1. **Rules live in code, not a `RecommendationRule` table.** Hardcoded in `cosmetics.engine.ts` as a typed rule list. Reason: rules are unstable, edited by engineers, and changing them via SQL would skip code review. Revisit when non-engineers need to edit rules or rules stabilize.
2. **No `source` mirror on `CosmeticRecommendation`.** It references `insightId`; provenance is one join away. Mirroring would duplicate state for no query-cost win.
3. **`CosmeticProduct` is the rename target for the existing `Cosmetics` model.** `Cosmetics.userOutlineId` gets dropped — it doesn't belong on a catalog entry. Open question: any production data in `Cosmetics.userOutlineId` worth preserving? (Assumed empty — confirm before migrating.)
4. **Replacement, not reconciliation.** When an outline's insight changes, the engine wipes existing `CosmeticRecommendation` rows for that outline and writes a new set. No diffing, no UPDATE.

---

## Phase 1 — Foundation

### Critical — Schema

- [ ] **Rename `Cosmetics` → `CosmeticProduct`.**
  - [ ] Use `@@map("Cosmetics")` initially if Prisma's migration generator wants to drop+recreate rather than rename. Check generated SQL before applying.
  - [ ] Drop `userOutlineId` + the `userOutline` relation — a catalog entry has no owning outline.

- [ ] **Add product-matching attributes to `CosmeticProduct`.**
  - [ ] `tags: String[]` — Postgres native. Shared vocabulary with `WeatherInsight.tags` (HOT, HUMID, HIGH_UV, DRY, …). The engine matches via set intersection.
  - [ ] `finish: CosmeticFinish?` — enum `{ MATTE, DEWY, NATURAL }`.
  - [ ] `spf: Int?` — 0–100. Nullable because not every product type has SPF.
  - [ ] `waterproof: Boolean @default(false)`.
  - [ ] `transferProof: Boolean @default(false)`.
  - [ ] `hydrating: Boolean @default(false)`.
  - [ ] `oilFree: Boolean @default(false)`.

- [ ] **Add `CosmeticRecommendation` model.**
  - [ ] `id String @id @default(cuid())`.
  - [ ] `userOutlineId String` + `userOutline UserOutline @relation(..., onDelete: Cascade)` — outline delete wipes recommendations.
  - [ ] `productId String` + `product CosmeticProduct @relation(..., onDelete: Restrict)` — don't lose products because a recommendation got cleaned up.
  - [ ] `insightId String` + `insight WeatherInsight @relation(..., onDelete: Cascade)` — when the insight goes (e.g. snapshot replaced), recommendations go with it. **This is what enforces "replacement, not reconciliation" at the DB level.**
  - [ ] `score: Int` — 0–100, engine confidence.
  - [ ] `rank: Int` — denormalized sort position so UI can paginate without re-sorting.
  - [ ] `reason: String[]` — short strings explaining the match (`"HOT_HUMID"`, `"HIGH_UV"`, `"oilFree"`). Surfaced in UI as the "why."
  - [ ] `createdAt: DateTime @default(now())`.
  - [ ] `@@index([userOutlineId, rank])` — primary read path (list recommendations for an outline in order).
  - [ ] `@@index([insightId])` — for cascade efficiency and reverse queries.
  - [ ] `@@unique([userOutlineId, productId])` — same product can't be recommended twice for the same outline.

- [ ] **Add back-relation on `WeatherInsight`**: `recommendations CosmeticRecommendation[]`.

- [ ] **Add back-relation on `UserOutline`**: `cosmetics Cosmetics[]` must change to `recommendations CosmeticRecommendation[]` (the old relation goes when `Cosmetics.userOutlineId` is dropped). Confirm no other code touches `UserOutline.cosmetics` first — grep shows zero refs today.

- [ ] **Enum.**
  - [ ] `CosmeticFinish { MATTE, DEWY, NATURAL }`.

- [ ] **Run `npx prisma format`**, then `npx prisma migrate dev --name add_cosmetics_module` (or bundle with weather as `add_weather_and_cosmetics` — single migration, fewer chances to leave the DB half-done).

---

### High — Engine (pure function)

- [ ] **Create `src/utils/cosmetics.util.ts`.** Pure rule application, no I/O.
  - [ ] Type `CosmeticsInput` — already defined by the weather module; import don't redeclare.
  - [ ] Type `ProductForScoring` — the subset of `CosmeticProduct` the engine reads (`id`, `tags`, `finish`, `spf`, `waterproof`, `transferProof`, `hydrating`, `oilFree`). Display fields excluded by type.
  - [ ] `RULES: ConditionRule[]` — table from the design:
    ```
    HOT_HUMID + HIGH_UV → require: finish=MATTE, spf>=50, waterproof
    RAINY               → require: transferProof
    COLD_WET            → require: waterproof || hydrating
    COLD_DRY + DRY      → require: hydrating, finish=DEWY
    HOT_DRY + HIGH_UV   → require: hydrating, spf>=50, oilFree
    MILD                → no requirements
    ```
  - [ ] `scoreProduct(input: CosmeticsInput, product: ProductForScoring) → { score, reason: string[] }` — for each rule that fires, score +N if product satisfies the predicate, record the rule name in `reason`. Score clamped 0–100.
  - [ ] `rankProducts(input, products) → { productId, score, reason, rank }[]` — sort by score desc, drop below threshold (e.g. `score < 30`), assign sequential `rank` starting at 1.
  - [ ] **`SENTINEL` branch**: if `input.source === "SENTINEL"`, downweight rules that depend on real data (UV-based rules, humidity-based rules). Don't return zero recommendations — return safe defaults.

- [ ] **Unit tests for `cosmetics.util.ts`.**
  - [ ] Each rule fires for the right `conditionType` + tag combination.
  - [ ] Score clamping (verify 0–100).
  - [ ] Conflict cases (a product satisfying multiple rules accumulates score correctly without double-counting).
  - [ ] `MILD` returns *some* recommendations (no requirements ≠ no output).
  - [ ] `SENTINEL` input produces conservative output (no SPF-50-required picks, no UV-based filtering).
  - [ ] Empty catalog → empty result, no exceptions.

---

### High — Services (with boundary enforcement)

The same import-boundary discipline as weather. **`cosmetics-recommendation.service.ts` is the only thing that writes recommendations.** Other modules read but don't write.

- [ ] **`src/services/shared/cosmetics-recommendation.service.ts`.**
  - [ ] `generateForOutline(outlineId: string) → CosmeticRecommendation[]` — the single entry point.
    1. Call `WeatherInsightService.getForOutline(outlineId)`. If `null` → throw `{ status: 409, message: "No weather insight available; take a snapshot first" }`. Don't trigger a snapshot from here — that's the caller's job, keeps the dependency one-way.
    2. Load active products from catalog (`prisma.cosmeticProduct.findMany(...)` — filter by whatever "active" means; for Phase 1, all rows).
    3. Run `rankProducts(insight, products)`.
    4. In a transaction: DELETE existing `CosmeticRecommendation` rows for this outline, INSERT the new ranked set.
    5. Return the new rows.
  - [ ] `listForOutline(outlineId) → CosmeticRecommendation[]` — read-only, joined with product for UI display. Ordered by `rank` asc.

- [ ] **`src/services/shared/cosmetic-product.service.ts`** — catalog CRUD.
  - [ ] `list`, `getById`, `create`, `update`, `softDelete` (or hard — Phase 1 doesn't need soft delete unless products will be archived for audit).
  - [ ] Admin-scoped — regular users don't write the catalog.

- [ ] **Import boundary check.** `cosmetics-recommendation.service.ts` imports `WeatherInsightService`. **It must not import `WeatherSnapshotService` or `WeatherCondition`.** Add a one-line check in the verification list (`grep`).

---

### Medium — API surface

- [ ] **Routes for recommendations** (mount at `/api/remote/outlines/:id/cosmetics`):
  - [ ] `POST /api/remote/outlines/:id/cosmetics/generate` — runs the engine, returns the new recommendation set.
    - 409 if no insight exists. Body: empty.
  - [ ] `GET /api/remote/outlines/:id/cosmetics` — returns existing recommendations (ordered by rank). 200 with empty array if none generated yet — no 404, the absence is meaningful.
  - [ ] Both require `authenticate` + outline-ownership guard.

- [ ] **Routes for catalog** (`/api/remote/cosmetics`) — admin-only:
  - [ ] `GET /` list, `GET /:id` read, `POST /` create, `PATCH /:id` update, `DELETE /:id` delete.
  - [ ] Joi validation on body — enums (`finish`), bounded ints (`spf` 0–100), tag whitelist (optional Phase 1 — keep tags free-text initially, tighten later).

- [ ] **Standard response envelope** via `responseSuccess` / `responseError`.

---

### Medium — Operational

- [ ] **No cache.** Recommendations are generated on demand, replaced wholesale. Reads hit Postgres directly. Same justification as weather snapshots.
- [ ] **Rule change path.** If `RULES` changes:
  1. Recommendations don't auto-regenerate.
  2. Outlines with stale recommendations will silently keep showing old picks until their next `generateForOutline` call.
  3. Acceptable for Phase 1 (low-volume, manual). When volume grows, add a backfill script invoked from a migration PR.
- [ ] **Product seeding.** Phase 1 needs ≥ a handful of products to test against. Add a `prisma/seed.ts` block with 6–10 products covering the rule matrix.

---

## Phase 2+ — out of scope

- `RecommendationRule` table for DB-editable rules.
- Per-user preferences (skin type, allergies) influencing the rank.
- Outfit ↔ cosmetics coordination (color matching against `Outfit`).
- Soft-delete + archival on `CosmeticProduct`.

---

## Verification (Phase 1)

- [ ] `npx prisma migrate dev` runs cleanly. Generated SQL renames `Cosmetics` → `CosmeticProduct` (or creates new + drops old — check before applying).
- [ ] `CosmeticProduct` no longer has `userOutlineId`.
- [ ] `CosmeticRecommendation` has `@@unique([userOutlineId, productId])` and cascades on insight delete (verified by deleting an insight and seeing recommendations go).
- [ ] `generateForOutline(outlineId)` with no insight → 409. With an insight → writes a ranked recommendation set, transactionally.
- [ ] Calling `generateForOutline` twice replaces the set (old rows gone, new rows present, no duplicates).
- [ ] Snapshot replacement (`snapshotForOutline` → new insight) cascades to recommendation deletion. Confirms the "replacement, not reconciliation" doctrine at the DB level.
- [ ] Unit tests for `cosmetics.util.ts` pass; SENTINEL input produces conservative output.
- [ ] `grep -r "WeatherSnapshotService\|WeatherCondition" src/services/shared/cosmetics-recommendation.service.ts` returns nothing — boundary intact.
- [ ] `GET /api/remote/outlines/:id/cosmetics` returns recommendations ordered by `rank` ascending.
- [ ] Auth: a user can only read/generate cosmetics for outlines they own.
- [ ] Catalog routes are admin-only — regular user gets 403.
