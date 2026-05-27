# Mirror API — Voice & Routing Architecture

> **Last Updated:** May 2026 — Reflects current production architecture including 4-layer AI prompt system, strict intent enum routing, and `/suggest` auto-recommendation endpoint.

This document outlines the complete backend architecture of `mirror-api`, covering the HTTP routing layer, voice pipeline, AI orchestration, and session management.

---

## 1. HTTP API Routing Architecture

The API uses a standard **Express.js** router, modularized into three consumer groups:

```
src/routes/index.ts
├── /remote/*         → Mobile Companion App endpoints (authenticated users)
├── /mirror/*         → Smart Mirror kiosk endpoints
└── /external/*       → Third-party integrations (API key protected)
```

### Key Mirror Endpoints

| Endpoint Group | Route Prefix | Purpose |
|---|---|---|
| Voice AI | `/api/mirror/voice` | Transcription, AI chat, TTS, auto-suggest |
| Garments | `/api/mirror/garments` | Fetch wardrobe items by slot type |
| Outfits | `/api/mirror/outfits` | Fetch pre-built outfit collections |
| Weather | `/api/mirror/weather` | Live weather by GPS coordinates |
| Map | `/api/mirror/map` | Geocoding, routing, navigation |
| Skin Analysis | `/api/mirror/skin-analyses` | AI skin type analysis from camera capture |
| Cosmetic Products | `/api/mirror/cosmetic-products` | Recommended cosmetic product catalog |
| File Uploads | `/api/mirror/file-uploads` | S3 upload for garments and skin captures |
| ChatWonder | `/api/mirror/chat-wonder` | Direct LLM conversation (Companion App) |

---

## 2. Voice Processing Pipeline

The voice system exposes four tightly focused endpoints in `voice.controller.ts` → `voice.service.ts`.

### A. `POST /api/mirror/voice/transcribe`

**Purpose:** Convert spoken audio (PCM) into text.

**Request:**
- Body: Raw binary audio buffer (`Content-Type: application/octet-stream`)

**Processing:**
1. Validates buffer size (rejects empty buffer with `400`, rejects `< 1,000` bytes as "Audio too short")
2. Sends to **AWS Transcribe Streaming** with:
   - `IdentifyLanguage: true` — auto-detects English or French
   - `LanguageOptions: "en-US,fr-FR"` — bilingual support
   - `PreferredLanguage: "en-US"` — fallback for short clips
   - `MediaSampleRateHertz: 16000`
   - `MediaEncoding: "pcm"`
3. Streams audio as an async generator in 32 KB chunks, collects non-partial transcript events
4. **Fallback path:** if `IdentifyLanguage` throws (e.g. `BadRequestException` on very short audio) or returns empty, retries the stream with strict `LanguageCode: "en-US"` (no language identification)
5. Returns the concatenated transcript

**Response:**
```json
{ "transcript": "I need something to wear today" }
```

**Errors:**
- `400` — No audio / audio too short
- `422` — AWS returned empty transcript: `{ "error": "Could not transcribe audio. Please speak clearly and try again." }`

---

### B. `POST /api/mirror/voice/ask`

**Purpose:** Full AI voice conversation — takes a transcript + context, returns spoken audio + a routing action.

**Request Body:**
```typescript
export interface VoiceContext {
  lat?: number;
  lng?: number;
  trafficEnabled?: boolean;
  isNavigating?: boolean;
  profile?: string;
  remainingDistance?: number;
  remainingDuration?: number;
  destinationName?: string;
  currentInstruction?: string;
  nextManeuverDistance?: number;
  nextInstruction?: string;
  currentTime?: string;
  currentDate?: string;
  schedules?: string;
  currentPage?: string;
  userOutlineId?: string;
  staffClarification?: string;
  sessionId?: string;
  gender?: string;        // User gender from auth profile — injected into Layer 4
  locationName?: string;  // Human-readable location reverse-geocoded from lat/lng
}
```

> Conversation continuity is handled server-side via ChatWonder's `sessionId`. The frontend keeps a short local history for the chat overlay UI but does not ship it to the backend.

**Processing (in `voice.service.ts`):**

**Step 1 — Weather + Location fetch (parallel):**
```
Promise.allSettled([
  weatherService.getWeather(ctx.lat, ctx.lng),
  mapService.reverseGeocode(ctx.lat, ctx.lng),
])
→ weatherInfo: "28°C, Sunny, wind 15 km/h, humidity 62%"
→ ctx.locationName: "Makati City, Metro Manila, Philippines"
```
Both fetched in parallel to avoid sequential latency. `reverseGeocode` calls Mapbox reverse geocoding (`/mapbox.places/{lng},{lat}.json`) and returns the human-readable `place_name`. Falls back to raw coordinates if Mapbox fails.

Also saves a weather snapshot to `UserOutline` if `userOutlineId` is set (for itinerary planning).

**Step 2 — 4-Layer Prompt Assembly (`buildChatWonderQuery`):**

```
Layer 1 — SYSTEM BEHAVIOR
  → Tone, conciseness, no markdown rules

Layer 2 — INTENT DECISION RULES
  → EVENT (no plan yet): Ask for occasion — NONE intent, no outfit yet
  → EVENT (plan known): FASHION intent using gender + weather → correct category
  → FASHION (no event): weather + location, immediate suggestion
  → COSMETIC: weather + location, immediate suggestion
  → MAP: destination → route_suggestion
  → NONE: general conversation

Layer 3 — OUTPUT CONTRACT (strict)
  → Must be valid JSON only
  → Schema: {
      intent: "FASHION" | "COSMETIC" | "MAP" | "NONE",
      message: string,
      data: { outfit?, cosmetics?, route? }   // always present, may be empty {}
    }
  → Only include fields inside `data` relevant to the chosen intent
  → No markdown wrapping, no backticks, no text outside the JSON
  → "If you fail to follow this JSON format, your response is invalid."

Layer 4 — CONTEXT BLOCK (dynamic)
  → Date, Time, Location (human-readable), Weather, User Gender, Screen, Schedule, Navigation state
```

**Step 3 — ChatWonder AI call:**
- Sends assembled prompt + transcript + session ID to external Python LLM backend
- Receives structured JSON response

**Step 4 — Response parsing (`parseChatWonderResponse`, in `utils/parse-chatWonder-response.util.ts`):**
- Extracts the first JSON block from the raw streamed response (`/\{[\s\S]*\}/`)
- **Schema-tolerant:** reads new-style `data: { outfit, cosmetics, route }` AND legacy flat fields (`outfit_suggestion` / `outfitSuggestion`, etc.) — useful while the LLM rollout stabilizes
- Validates and enforces **strict AIIntent enum**: `"FASHION" | "COSMETIC" | "MAP" | "NONE"` (uppercases and rejects anything else)
- If AI omitted `intent` field, parser infers it from which suggestion field is populated (outfit → FASHION, cosmetics → COSMETIC, route → MAP)
- Strips markdown characters (`* _ ~ \` #`) from `message` so Polly doesn't read them aloud
- If JSON parsing fails entirely, returns `intent: "NONE"` with the markdown-stripped fallback text (or "I'm here to help you.")

**Step 5 — Intent → Action mapping (strict enum lookup via `routeMap`):**
```
intent === "FASHION"                          → { type: "navigate", route: "/ai-recommendation-fashion", suggestion: outfit_suggestion }
intent === "COSMETIC"                         → { type: "navigate", route: "/ai-recommendation-cosmetic", suggestion: cosmetics_suggestion }
intent === "MAP"  && route_suggestion present → { type: "maps_navigate", destination: route_suggestion }
intent === "NONE" (or "MAP" w/o destination)  → { type: "speak" }
```
The default action is `{ type: "speak" }`; the branches above replace it only when the conditions are met.

**Step 6 — TTS synthesis:**
- `synthesize(speech)` sends the `message` text to **AWS Polly**
  - English → engine `GENERATIVE`, voice `Matthew`, language `en-US`
  - French (detected via common-word regex) → engine `NEURAL`, voice `Lea`, language `fr-FR`
- Long text is chunked into ≤ 2,000-char sentences and concatenated
- If the spoken text contains the fallback phrase "having trouble connecting", reads `assets/error-fallback.mp3` directly instead of calling Polly
- If Polly throws → also reads `assets/error-fallback.mp3` as a last-resort fallback

**Step 7 — Conversation persistence (only when `userOutlineId` is provided):**

Persistence is split into a **sync prep phase** (anything the response depends on) and a **fire-and-forget phase** (everything else, so the client doesn't wait on DB round-trips).

*Sync (before TTS, blocks the response):*
- Loads the `UserOutline` to get `userId` + `conversationId`
- If `conversationId` is null, **auto-creates a `Conversation`** ("Voice Session") via `ChatRepository.createConversation` and patches it back onto the outline
- If the AI returned `events`, runs `resolveItineraryCosmetics(userId, events, conversationId)` to attach DB-linked cosmetic recommendations (mutates `enrichedEvents` which is returned in the response)

*Fire-and-forget (kicked off after the audio buffer is ready, not awaited):*
- Finalization check: regex matches `save`, `confirm`, `finalize`, `looks good`, `looks awesome`, `looks perfect`, `perfect`, or `lock in` → sets `UserOutline.status = FINALIZED`
- Persists both messages (`USER` then `AI`) via `ChatRepository.createMessage`
- Bumps `conversation.lastMessageAt`

Errors in the async block are logged but never surface to the client.

**Response (JSON):**
```json
{
  "reply": "Spoken text shown to the user",
  "action": { "type": "navigate", "route": "/ai-recommendation-fashion", "suggestion": "..." },
  "events": [],
  "sessionId": "chat-wonder-session-id",
  "audioBase64": "<base64-encoded MP3>"
}
```

The frontend decodes `audioBase64` to a buffer and plays it via Web Audio API.

---

### C. `POST /api/mirror/voice/tts`

**Purpose:** Pure Text-to-Speech conversion. No AI involved.

**Request Body:** `{ "text": "Opening that up." }`

**Processing:** Calls AWS Polly directly via `synthesize(text)`.

**Response:** `Content-Type: audio/mpeg` — raw MP3 buffer.

**Usage:** Called by the frontend when a regex intent matches (e.g., "Open maps") — the frontend routes instantly and simultaneously requests TTS for the acknowledgment phrase.

---

### D. `POST /api/mirror/voice/suggest`

**Purpose:** Silently generates a weather-based AI recommendation **without TTS audio**. Used when a user navigates to a recommendation screen via touch (bypassing voice).

**Request Body:**
```json
{
  "type": "fashion",
  "ctx": { "lat": 48.8566, "lng": 2.3522 }
}
```

**Processing:**
1. Fetches live weather for provided GPS coordinates
2. Constructs a lightweight prompt: `"I need a quick fashion recommendation based on the current weather."`
3. Sends to ChatWonder AI
4. Returns only the suggestion text — **no TTS audio generated**

**Response:**
```json
{ "suggestion": "A light white linen shirt with chinos and sandals would be perfect for today's 28°C sunshine." }
```

---

## 3. AI Prompt Architecture (4 Layers)

The ChatWonder prompt is split into four distinct, non-competing layers defined as module-level constants in `voice.service.ts`:

```typescript
const SYSTEM_BEHAVIOR   // Layer 1: Tone + style rules
const INTENT_RULES      // Layer 2: When to use FASHION/COSMETIC/MAP/NONE
const OUTPUT_CONTRACT   // Layer 3: Strict JSON schema enforcement
// Layer 4: Dynamic context (built per-request)
```

**Why 4 layers:**
- Previously, behavior + intent + schema were in a single flat string → LLM had competing priorities → inconsistent JSON output
- Separating them gives the LLM clear priority ordering: behavior first, then decide intent, then format output, then use context
- The `OUTPUT_CONTRACT` explicitly states: *"If you fail to follow this JSON format, your response is invalid."* — this significantly reduces malformed outputs

---

## 4. Intent Enum System

`AIIntent` is a strict TypeScript enum defined in `parse-chatWonder-response.util.ts`:

```typescript
export type AIIntent = "FASHION" | "COSMETIC" | "MAP" | "NONE";
```

**Enforcement levels:**
1. AI is instructed in the prompt to always output a valid `intent` field
2. Parser validates: only accepts values in the enum, else falls back to inference
3. Backend maps intents to routes via a `routeMap` — no string comparison to optional fields
4. Frontend `dispatchAction` has a route guard: if the route is not in the safe list, it falls back to `/ai-recommendation-fashion`

---

## 5. Session & Conversation Management

ChatWonder maintains short-term conversation memory via a **Session ID**:

- On first `/ask` request: backend calls `getChatWonderSession()` to obtain a new session ID from `${CHAT_WONDER_API_URL}/session-id`
- Session ID is returned in the JSON response body as the `sessionId` field
- Frontend stores it in a React ref (`sessionIdRef`) and passes it back in `ctx.sessionId` on subsequent requests
- Session ID is scoped to a single user interaction window (not persisted across page reloads)
- If session creation fails, the backend returns a graceful fallback message ("having trouble connecting…") and serves a pre-recorded `error-fallback.mp3` so the user still hears audible feedback

---

## 6. Cosmetic Recommendation Pipeline

The skin analysis flow is separate from the voice pipeline:

1. **Frontend** captures a video frame from the camera (`canvas.toDataURL`)
2. Uploads JPEG to S3 via `POST /api/mirror/file-uploads/upload` → receives `fileId`
3. Sends `fileId` to `POST /api/mirror/skin-analyses` → backend runs AI skin analysis
4. Analysis result includes: `skinType`, `skinTone`, `hydrationPct`, `oilinessPct`, `concerns`, `routineTip`, and a list of ranked `SkinRecommendation` objects with actual cosmetic products from the database
5. Result is stored in `sessionStorage.skin_analysis` and frontend navigates to the results screen

---

## 7. State Management Across Layers

| State | Where | What |
|---|---|---|
| AI suggestion text | `useMirrorStore` (Zustand) | Fashion / Cosmetic recommendation displayed as banner |
| Map / navigation | `useMapStore` (Zustand) | GPS, route, destination, traffic, profile |
| Calendar events | `useCalendarStore` (Zustand) | User schedule injected into AI context |
| Outline / itinerary | `useOutlineStore` (Zustand) | Event planning outline ID |
| Auth / profile | `useAuthStore` (Zustand) | JWT token, user gender, home location |
| ChatWonder session | React ref (`sessionIdRef`) | Conversation continuity within a session |
| Pending map destination | `sessionStorage` | Cross-screen handoff for maps navigation |
