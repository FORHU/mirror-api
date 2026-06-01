# Cosmetics Feature — Progress & Capabilities

## What Works Right Now

### Skin Analysis
- Face scan stored as `SkinAnalysis` record (skinType, hydrationPct, oilinessPct, concerns)
- Latest scan auto-linked to the active `UserOutline` session when a recommendation flow starts
- Falls back to `NORMAL` skin profile defaults if user has no scans

### Product Scoring Engine (`cosmetics.util.ts`)
- Scores and ranks the entire product catalog per itinerary event
- Factors used in scoring:
  - User skin type (DRY / OILY / NORMAL / COMBINATION)
  - Skin concerns (acne, sensitivity, etc.)
  - Weather risk signals: UV, sweat, smudge, dryness, oil
  - Product attributes: SPF, oilFree, waterproof, hydrating, transferProof, finish
- Returns ranked list with score, rank, and reason per product

### Cosmetic Recommendation Persistence
- `CosmeticRecommendation` rows created and linked to both `UserOutline` (master list) and `ItineraryEvent` (per-event card)
- Previous draft recommendations wiped on each new session to maintain a clean slate
- REST API: list, get, create, update, delete recommendations (owner-guarded)

### Itinerary Events
- `ItineraryEvent` rows created per AI-generated event (type, timeBlock, weather risks, fashion/cosmetics/route suggestions)
- Top 3 resolved products attached per event as `cosmetics.resolvedProducts` in the response payload

### ChatWonder Catalog Injection ✅ (implemented)
- Compact product catalog (id, brand, name, type, tags, spf, finish) now injected into `document_context` before each ChatWonder call
- Applies to both the **voice flow** (`voice.service.ts`) and the **skin analysis flow** (`skin-analysis.service.ts`)
- AI can now reference real product names in its spoken/written cosmetic suggestions
- Catalog fetch runs in parallel with session ID fetch — no added latency on the happy path
- If catalog fetch fails, gracefully falls back to empty string (AI still works without it)

### Skin Analysis → ChatWonder Product Recommendation ✅ (implemented)
- After face scan, `askChatWonderForSkinProducts()` sends skin profile (skinType, oiliness%, hydration%, concerns) + full product catalog to ChatWonder
- ChatWonder now instructed to name 2-3 specific products from the catalog and explain why they suit the skin profile
- Suggestion stored in `rawSignals.chatWonderSuggestion` on the `SkinAnalysis` record

---

## What Does NOT Work Yet

### No Real-Time Stock / Availability
- The catalog injected to the AI has no stock status — AI may suggest a product that is out of stock or unavailable at the kiosk
- Fix needed: add an `inStock: boolean` or `available: boolean` field to `CosmeticProduct` and filter before injecting

### No Intent-Based Catalog Filtering
- Currently the full catalog is sent to ChatWonder on every request, regardless of intent
- If catalog grows large (100+ products), this increases token usage unnecessarily
- Fix needed: pre-filter by event type / time of day before injecting
  - e.g. night event → only `type: foundation, lipstick, eyeshadow`
  - e.g. morning / outdoor → prioritise `type: sunscreen, moisturizer`

### Weather Context Not Wired Into Events
- `events[].context` (oilRisk, uvRisk, smudgeRisk etc.) is currently populated by ChatWonder guessing from text
- The real weather data fetched by `weatherService` is not yet serialised into structured risk signals and passed as event context
- Fix needed: after fetching weather, compute risk signals and inject them into the prompt so the AI uses real values

### No Product Images in Voice Reply
- `resolvedProducts` carry `imageUrl` but the voice/WebSocket response does not yet surface them to the frontend UI layer in a way that renders product cards
- Fix needed: frontend needs to consume `events[].cosmetics.resolvedProducts` and render product cards

### Cosmetics Recommendation Screen (`/ai-recommendation-cosmetic`)
- The route exists and navigation works
- The screen itself needs to consume the `events` payload from the voice controller and display per-event product cards with image, brand, score, and reason

### No User Preference Memory
- `User.preferences` JSONB column exists but is not yet read when scoring products
- Fix needed: factor user's saved brand/finish/coverage preferences into the ranking engine

### No Interaction Feedback Loop
- When a user tries on or selects a product (virtual try-on), that interaction is not yet fed back to improve future recommendation scores
- `Interaction` model exists in schema — needs to be wired to scoring weight adjustments

---

## Data Flow Summary

```
User speaks
    │
    ▼
buildCatalogContext()          ← NEW: fetches products from DB
    │
    ▼
ChatWonder (AI)
  user_input  = system prompt + user message
  document_context = compact product catalog   ← NEW
    │
    ▼ (AI response with events[])
resolveItineraryCosmetics()
  1. Link latest SkinAnalysis to UserOutline
  2. Wipe previous draft events + recommendations
  3. Fetch full catalog
  4. Score products per event (skin + weather risks)
  5. Persist ItineraryEvent + CosmeticRecommendation rows
  6. Attach top 3 resolvedProducts per event
    │
    ▼
Response → frontend
  events[].cosmetics.suggestion      (AI text, now references real product names)
  events[].cosmetics.resolvedProducts (top 3 scored DB products with images)
```

---

## Polly Voice Bug

**Error:** `AWS Polly failed: Unsupported Neural feature`

**Cause:** `AWS_VOICE_REGION` falls back to `AWS_REGION = ap-southeast-1` (Singapore). AWS Polly Neural engine is not available in that region.

**Fix:** Add to `.env`:
```
AWS_VOICE_REGION=us-east-1
```

Neural voices supported: Matthew (en-US), Lea (fr-FR), Seoyeon (ko-KR)
