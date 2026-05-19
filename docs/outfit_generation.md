# Outfit Generation

Two ways to create outfits in this codebase: **AI-driven** (GPT-4o vision / text) and **rule-based** (deterministic-ish wardrobe composer). This doc covers both, with focus on the rule-based recommender.

---

## TL;DR

| Want | Use |
|---|---|
| AI to name/describe an uploaded outfit photo | `POST /outfits/evaluate` |
| AI to pick an outfit from a text prompt | `POST /outfits/compose` |
| AI to match a photo against the user's wardrobe | `POST /outfits/evaluate-hybrid` |
| **Rule-based pick by category, no AI** | **`POST /outfits/recommend`** |
| **Batch-seed system outfits by category** | **`npm run outfits:generate`** |
| Create one outfit manually with explicit items | `POST /outfits/` |

---

## Rule-based recommender

### What it does

Given a `CATEGORY` (e.g. `Streetwear`, `Formal`), pick garments from the wardrobe and persist a complete outfit. No GPT, no token cost, synchronous response. Random selection so calling twice produces different outfits.

### Composition rules

The recommender always covers **torso + legs + feet**, choosing one of two paths at random:

| Path | Slots used |
|---|---|
| `full` | `FullGarment` + `FootGarment` |
| `separates` | `UpperGarment` + `LowerGarment` + `FootGarment` |

If only one path is viable (e.g. no dresses tagged with this category), that path is used. If neither is viable, the call returns a `404`.

Optional additions, included only when a matching garment exists:
- 1 `HeadGarment`
- At most 1 accessory, randomly drawn from `NeckAccessory`, `WaistAccessory`, `LeftHandAccessory`, `RightHandAccessory`, `Glasses`, `Earrings`

### HTTP API

`POST /outfits/recommend`

**Body**
```json
{
  "category": "Streetwear",
  "gender": "MALE",
  "name": "Friday vibes",
  "description": "Optional human description",
  "kioskId": "optional-socket-room-id"
}
```

| Field | Required | Notes |
|---|---|---|
| `category` | ✅ | One of the `CATEGORY` enum values (see below) |
| `gender` | — | `MALE` / `FEMALE` / `UNISEX`. When set, the recommender includes both the requested gender AND `UNISEX` garments. |
| `name` | — | Defaults to `"{category} look"` |
| `description` | — | Free text |
| `kioskId` | — | Emits `outfit_recommended` socket event to this room on success |

**Response** — `201 Created`
```json
{
  "status": "success",
  "data": { "id": "clx...", "name": "...", "items": [...], "metaData": { ... } }
}
```

**Failure modes** — `404`:
- `No footwear found for category "<X>"` — no garment in that category has `FootGarment` in `fittingSlot`
- `No torso/leg garments found for category "<X>"` — neither path is viable

### CLI script

For seeding system outfits or backfilling a user, use [src/scripts/generate-outfits.ts](../src/scripts/generate-outfits.ts):

```bash
# All categories, 3 system outfits each:
npm run outfits:generate

# One category, larger batch:
npm run outfits:generate -- --category=Streetwear --count=10

# Male-only:
npm run outfits:generate -- --gender=MALE --count=2

# For a specific user (creates user-owned outfits):
npm run outfits:generate -- --user=clx123abc --count=5

# Or call ts-node directly (skip the `--` dance):
npx ts-node src/scripts/generate-outfits.ts --category=Casual --count=5
```

**Flags**

| Flag | Default | Notes |
|---|---|---|
| `--category=<X>` | all categories | Must be a valid `CATEGORY` value |
| `--count=<N>` | `3` | Outfits to attempt per category |
| `--gender=<X>` | (all) | `MALE` / `FEMALE` / `UNISEX` |
| `--user=<id>` | (system) | When set, outfits get `userId=<id>` and dedupe per-user. Without it, outfits get `userId=null` and become system outfits visible to everyone. |

**Behavior: "top up to N"**

The script counts existing outfits per category (scope-aware: system or specific `--user`), then only generates the difference. Re-running the same command after the target is reached is a **no-op**.

- Counted via `metaData.category` so manually-created outfits without that key don't count toward the quota.
- Retries are capped at 4× the target per category so a small wardrobe doesn't spin forever trying to produce unique combinations.

**Log markers**

```
🪡  Top-up generate — categories=20, targetPerCategory=3 (system)
  ✓ Streetwear → clx... (1/3)                           ← created, now at 1 of 3
  ✓ Streetwear → clx... (2/3)
  ⊘ Casual: already at 3/3, skipping                    ← target met, no work needed
  - Formal: No footwear found for category "Formal"      ← skipped (404 from service)
  ⚠ Vintage: stopped at 1/3 after 8 attempts — wardrobe variety limit
  ✗ Sportswear: <error message>                          ← real failure

Done. created=42, reused=8, skipped=10, exhausted=2, failed=0
```

| Marker | Meaning |
|---|---|
| `✓` | New unique outfit created |
| `⊘` | Category already at target, skipped entirely |
| `-` | No matching garments — category produces nothing |
| `⚠` | Wardrobe doesn't have enough unique combinations to reach target |
| `✗` | Real error, doesn't abort the script |

---

## Where the data goes

| Field | Value |
|---|---|
| `Outfit.userId` | The `--user` flag value, or `null` for system mode |
| `Outfit.designType` | `UserDesign` if `userId` present, `systemDesign` otherwise |
| `Outfit.fileId` | Display image — fallback uses the first item's garment image (no upload needed) |
| `Outfit.items` | `GarmentInOutfit` rows with `slot` set to the picked `FITTING_SLOT` |
| `Outfit.metaData` | `{ generatedBy, category, composition, categoryMix, silhouette }` — see [Outfit stats metadata](#outfit-stats-metadata) below |

---

## Outfit stats metadata

Every persisted outfit (rule-based AND AI flows) carries two computed stats in `metaData`:

### `categoryMix` — per-garment normalized weight

Each garment contributes weight = 1 total, split evenly across its `category` array. Percentages always sum to 100, rounded to 1 decimal.

```
4 garments:
  shirt   → [Summerwear]              → 1.0 to Summerwear
  shorts  → [Summerwear, Casual]      → 0.5 to Summerwear, 0.5 to Casual
  shoes   → [Summerwear]              → 1.0 to Summerwear
  pants   → [Rainwear]                → 1.0 to Rainwear
  ────────────────────────────────────────────────────────────────
  total weight = 4.0
  → categoryMix: { Summerwear: 62.5, Casual: 12.5, Rainwear: 25 }
```

Garments with no `category` are skipped (no fabrication). If no garment has any category, `categoryMix` is `{}`.

### `silhouette` — three views

Each garment has one `SILHOUETTE` value. The outfit aggregates them three ways:

| Key | Shape | Use |
|---|---|---|
| `perSlot` | `{ <FITTING_SLOT>: <SILHOUETTE> }` | UI/kiosk display ("upper: Slim, lower: WideLeg") |
| `tally` | `{ <SILHOUETTE>: count }` | Histogram queries — "how many outfits include any Oversized item?" |
| `dominant` | `<SILHOUETTE>` | Single-label filtering. Ties broken by enum order (deterministic). |

Garments without `silhouette` are skipped.

### Example final metadata

```json
{
  "generatedBy": "rule:recommend",
  "category": "Summerwear",
  "composition": "separates",
  "categoryMix": { "Summerwear": 75, "Rainwear": 25 },
  "silhouette": {
    "perSlot":  { "UpperGarment": "Slim", "LowerGarment": "WideLeg", "FootGarment": "Regular" },
    "tally":    { "Slim": 1, "WideLeg": 1, "Regular": 1 },
    "dominant": "Slim"
  }
}
```

AI flows produce the same `categoryMix` + `silhouette` shape but with their own `generatedBy` (`openai:gpt-4o:evaluate` / `:compose` / `:match`) and additional AI-specific keys (`tags`, `dominantColor`, etc.).

---

## Dedupe behavior

Implemented in [src/validations/outfit.validation.ts](../src/validations/outfit.validation.ts) → [src/repositories/outfit.repository.ts](../src/repositories/outfit.repository.ts).

| Scenario | What happens |
|---|---|
| Script (system mode), same garment set twice | Second call returns the existing system outfit. No duplicate row. |
| User generates the same combo twice | Returns the user's existing outfit. |
| User A and User B independently generate the same combo | Each gets their own outfit row. No cross-user leakage. |
| User generates a combo identical to a system outfit | User gets a fresh user-owned copy. System row is not returned. |

Dedupe is by **exact garment-id set within the same scope** (`userId` value, treating `null` as its own scope).

---

## Data requirements per garment

A garment is only pickable by the recommender if these fields are populated:

| Field | Required? | Failure mode if missing |
|---|---|---|
| `category: CATEGORY[]` containing at least one value | ✅ | Garment not loaded for that category |
| `fittingSlot: FITTING_SLOT[]` containing a core slot | ✅ | Loaded but never bucketed → never picked |
| `gender: GARMENT_GENDER` | schema-defaulted to `UNISEX` | Filtered out when `--gender` is more specific |
| `imageUrl` OR `file.fileUrl` (on at least one picked garment) | ✅ | `createOutfit` throws `"Outfit requires a display image..."` |

A category cannot produce outfits unless its garments collectively cover:

1. `FootGarment` (one or more) **AND**
2. Either `FullGarment` **or** (`UpperGarment` + `LowerGarment`)

---

## Diagnostic queries

To see what your wardrobe can actually compose:

```sql
-- Which categories have footwear?
SELECT DISTINCT unnest(category) AS cat
FROM "Garment"
WHERE 'FootGarment' = ANY("fittingSlot");

-- Garments with no fittingSlot — dead weight to the recommender:
SELECT id, name FROM "Garment" WHERE array_length("fittingSlot", 1) IS NULL;

-- Garments with no category — won't match any --category run:
SELECT id, name FROM "Garment" WHERE array_length(category, 1) IS NULL;

-- Recent system outfits from the recommender:
SELECT id, name, "createdAt", "metaData"->'category' AS category, "metaData"->'composition' AS composition
FROM "Outfit"
WHERE "userId" IS NULL AND "metaData"->>'generatedBy' = 'rule:recommend'
ORDER BY "createdAt" DESC
LIMIT 20;
```

Or open [Prisma Studio](http://localhost:5555) (`npx prisma studio` from `mirror-api/`) for a visual view.

---

## Enums it depends on

If any of these are renamed in `schema.prisma`, TypeScript will fail at compile time (loud, safe). Adding new values is mostly safe:
- New `CATEGORY` value → script iterates it on next run, skips silently if no garments match.
- New `FITTING_SLOT` value → recommender ignores it. If it's a new core slot (not accessory), update [src/services/shared/outfit.service.ts](../src/services/shared/outfit.service.ts) `recommendOutfit`.

| Enum | Used by | Specific values referenced in code |
|---|---|---|
| `CATEGORY` | service filter, script, Joi | all values (via `Object.values`) |
| `FITTING_SLOT` | service buckets | `FootGarment`, `UpperGarment`, `LowerGarment`, `FullGarment`, `HeadGarment`, `NeckAccessory`, `WaistAccessory`, `LeftHandAccessory`, `RightHandAccessory`, `Glasses`, `Earrings` |
| `GARMENT_GENDER` | service filter, Joi | `UNISEX` constant; all values for validation |
| `DESIGN_TYPE` | service persistence | `UserDesign`, `systemDesign` (string literals) |

---

## Known limitations

- **No coordination between picks.** Random selection means you might get clashing colors. If you want color-aware composition, the next iteration could pick an anchor garment first and prefer matching `dominantColor` for the rest.
- **No layering.** v1 picks one garment per slot, ignoring `layerLevel`. Winter/Rainwear categories that benefit from layering (e.g. coat over shirt) currently only get one torso garment.
- **Soft-deleted garments are not filtered** in `GarmentRepo.findAll`. If your `Garment` model uses `isDeleted`, the recommender may pick deleted rows.
- **Display image** comes from whichever garment's image the `createOutfit` fallback finds first. There's no rendering / composition of a ghost-mannequin image here — that lives in `mirror-admin` and is invoked separately by the frontend if needed.

---

## Related files

- [src/services/shared/outfit.service.ts](../src/services/shared/outfit.service.ts) — `recommendOutfit`
- [src/controllers/shared/outfit.controller.ts](../src/controllers/shared/outfit.controller.ts) — `recommend` handler
- [src/routes/shared/outfit.route.ts](../src/routes/shared/outfit.route.ts) — `POST /outfits/recommend`
- [src/scripts/generate-outfits.ts](../src/scripts/generate-outfits.ts) — CLI batch generator
- [src/validations/outfit.validation.ts](../src/validations/outfit.validation.ts) — `findExistingComposition` dedupe
- [src/repositories/outfit.repository.ts](../src/repositories/outfit.repository.ts) — `findByExactGarmentSet`
- [prisma/schema.prisma](../prisma/schema.prisma) — `CATEGORY`, `FITTING_SLOT`, `GARMENT_GENDER`, `DESIGN_TYPE` enums
