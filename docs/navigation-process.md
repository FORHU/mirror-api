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
1. Validates buffer size (must be > 1,000 bytes)
2. Pads audio buffer with silence to a minimum of **3 seconds / 96,000 bytes** — required by AWS Transcribe's `IdentifyLanguage` mode to avoid empty transcript errors on short phrases
3. Sends to **AWS Transcribe Streaming** with:
   - `IdentifyLanguage: true` — auto-detects English or French
   - `LanguageOptions: "en-US,fr-FR"` — bilingual support
   - `PreferredLanguage: "en-US"` — fallback for short clips
   - `MediaSampleRateHertz: 16000`
   - `MediaEncoding: "pcm"`
4. Streams audio as async generator to AWS, collects transcript events
5. Returns most complete transcript result

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
```json
{
  "transcript": "What should I wear today?",
  "ctx": {
    "lat": 48.8566,
    "lng": 2.3522,
    "currentTime": "07:30 PM",
    "currentDate": "Monday, May 26, 2026",
    "schedules": "Team meeting @ Conference Room on 05/27/2026",
    "currentPage": "Fashion Screen",
    "isNavigating": false,
    "sessionId": "abc123",
    "userOutlineId": "outline_xyz"
  },
  "history": [
    { "user": "previous question", "assistant": "previous reply" }
  ]
}
```

**Processing (in `voice.service.ts`):**

**Step 1 — Weather fetch:**
```
weatherService.getWeather(ctx.lat, ctx.lng)
→ "28°C, Sunny, wind 15 km/h, humidity 62%"
```
Also saves a weather snapshot to `UserOutline` if `userOutlineId` is set (for itinerary planning).

**Step 2 — 4-Layer Prompt Assembly (`buildChatWonderQuery`):**

```
Layer 1 — SYSTEM BEHAVIOR
  → Tone, conciseness, no markdown rules

Layer 2 — INTENT DECISION RULES
  → FASHION: weather + location, no clarifying questions
  → COSMETIC: weather + location, immediate suggestion
  → MAP: destination → route_suggestion
  → NONE: general conversation

Layer 3 — OUTPUT CONTRACT (strict)
  → Must be valid JSON only
  → Schema: { intent, message, outfit_suggestion?, cosmetics_suggestion?, route_suggestion? }
  → Omit null fields
  → No markdown wrapping
  → "If you fail to follow this JSON format, your response is invalid."

Layer 4 — CONTEXT BLOCK (dynamic)
  → Date, Time, Weather, Screen, Schedule, Navigation state
```

**Step 3 — ChatWonder AI call:**
- Sends assembled prompt + transcript + session ID to external Python LLM backend
- Receives structured JSON response

**Step 4 — Response parsing (`parseChatWonderResponse`):**
- Extracts JSON block from raw response string
- Validates and enforces **strict AIIntent enum**: `"FASHION" | "COSMETIC" | "MAP" | "NONE"`
- If AI omitted `intent` field, parser infers from presence of suggestion fields (fallback inference)
- If JSON parsing fails entirely, returns `intent: "NONE"` with fallback message

**Step 5 — Intent → Action mapping (strict, no inference):**
```
intent === "FASHION"  → { type: "navigate", route: "/ai-recommendation-fashion", suggestion: outfit_suggestion }
intent === "COSMETIC" → { type: "navigate", route: "/ai-recommendation-cosmetic", suggestion: cosmetics_suggestion }
intent === "MAP"      → { type: "maps_navigate", destination: route_suggestion }
intent === "NONE"     → { type: "speak" }
```

**Step 6 — TTS synthesis:**
- `synthesize(speech)` → sends `message` text to **AWS Polly** (voice: `Joanna`)
- Returns MP3 audio buffer
- If Polly fails → reads `assets/error-fallback.mp3` as fallback

**Step 7 — Conversation persistence:**
- If `userOutlineId` is present: saves user message and AI reply to `ChatRepository` (database)
- Checks for finalization keywords ("save", "confirm", "finalize") → updates `UserOutline.status` to `FINALIZED`

**Response:**
```
Content-Type: audio/mpeg
X-Reply:      <URL-encoded spoken text>
X-Action:     <URL-encoded JSON action object>
X-Events:     <URL-encoded JSON events array>
X-Session-Id: <URL-encoded ChatWonder session ID>
Body:         <MP3 audio buffer>
```

> ⚠️ **Known Risk:** X-Headers can be stripped by HTTP proxies and load balancers. Planned upgrade: migrate to structured JSON body response with `audioBase64` field.

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

- On first `/ask` request: backend calls `getChatWonderSession()` to obtain a new session ID from the ChatWonder API
- Session ID is returned via `X-Session-Id` header
- Frontend stores session ID in a React ref (`sessionIdRef`) and passes it back in `ctx.sessionId` on subsequent requests
- Session ID is scoped to a single user interaction window (not persisted across page reloads)

**Safety Wipe:**
If a user updates their profile (e.g., changes gender), the backend explicitly clears the ChatWonder session to prevent the AI from persisting stale user data in future recommendations.

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
