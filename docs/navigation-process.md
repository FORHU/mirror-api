# Mirror API Navigation & Routing Process

This document outlines how navigation and routing are structured within the `mirror-api` Node.js backend. The backend handles two completely different types of "routing":
1. **HTTP API Routing**: Standard Express.js endpoints for data fetching and mutations.
2. **Voice Intent Navigation**: Parsing spoken words into UI navigation commands that force the frontend to change screens.

## 1. HTTP API Routing Architecture
The API uses a standard Express.js router setup, heavily modularized to separate endpoints meant for the mirror interface vs. shared/external endpoints.

### The Main Hub (`src/routes/index.ts`)
All traffic passes through the main index router. Endpoints are grouped logically by their consumer:

```typescript
// Shared/Remote Endpoints
router.use("/remote/users", remoteUserRoute);
router.use("/remote/generation", mirrorGenerationRoute);

// Mirror Interface Endpoints
router.use("/mirror/try-on", mirrorTryOnRoute);
router.use("/mirror/voice", mirrorVoiceRoute);
router.use("/mirror/chat-wonder", chatWonderRoute);
```
Each of these sub-routers connects to specific Controllers, which then hand business logic off to Services and Repositories.

## 2. Voice Intent Navigation (The "Brain" of the UI)
Unlike a standard web app where users click buttons, the Smart Mirror relies heavily on the backend to tell the frontend when to change pages. This magic happens in `src/services/shared/voice.service.ts`.

### Intent Detection (`detectIntent`)
Before sending a voice transcript to the heavy AI (Chat Wonder), the Node backend runs it through a hyper-fast Regex intent engine. 

If the user says a keyword phrase, the backend instantly returns a JSON payload telling the frontend to navigate, bypassing the AI entirely:

```typescript
// Excerpt from detectIntent in voice.service.ts

// 1. UI Screen Navigation
// If the user says "go to fashion" or "style my fashion", tell the frontend to open the Outfit Builder
if (/\b(build|create|make|assemble|style)\s+(an?\s+)?(outfit|look|style|fashion)\b|\b(pick|choose|go\s+to|open)\s+(clothes|outfit|fashion)\b/i.test(t)) {
    return { type: "navigate", route: "/outfit-builder" };
}

// 2. Map Toggles
if (/\b(turn on|enable|show)\s+traffic\b/i.test(t)) {
    return { type: "traffic_on" };
}

// 3. Physical Navigation
if (/\b(take me to|navigate to)\s+(.+)/i.test(t)) {
    return { type: "maps_navigate", destination: navMatch[1].trim() };
}
```

### The Return Payload
When `detectIntent` hits a match, it sets `isCommand = true`. The API then returns a specific JSON structure to the React frontend:

```json
{
  "message": "Sure, opening that up.",
  "audio": "<binary mp3 buffer>",
  "action": {
    "type": "navigate",
    "route": "/outfit-builder"
  }
}
```

## 3. The End-to-End Flow
1. **Frontend**: Sends audio and context to `/mirror/voice`.
2. **API (`voice.controller.ts`)**: Transcribes the audio via AWS Transcribe.
3. **API (`voice.service.ts`)**: Parses the transcript using `detectIntent`.
4. **API to Chat Wonder**: If it's a UI command, the API briefly asks the Python LLM to acknowledge it (e.g., "Navigating now."). If it's conversational, it asks the LLM for a full response.
5. **Response**: The API converts the text to speech via AWS Polly and returns the MP3 buffer alongside the `{ action: "navigate" }` payload.
6. **Frontend**: Plays the audio and uses Next.js `router.push()` to execute the navigation action.
