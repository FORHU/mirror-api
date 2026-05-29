# Cognitive Voice & ChatWonder Orchestration (API Progress)

## Overview
This document tracks the backend progress on integrating the new **Cognitive Voice Engine** powered by ChatWonder. It aligns with the frontend's architecture shift documented in `mirror-app/docs/voiceprovider_progress.md`, moving from a local regex FSM to a centralized, AI-driven cognitive orchestration.

---

## Current Architecture

The `mirror-api` acts as the middle-tier orchestrator between the Smart Mirror Frontend and the ChatWonder AI backend. It is responsible for:
1. Handling raw microphone input and processing it via Voice-to-Text (Transcription).
2. Gathering rich physical context (Weather, Location) before querying the AI.
3. Submitting highly structured prompts to ChatWonder.
4. Parsing ChatWonder's response into a strict JSON `CognitiveResponse` contract.
5. Synthesizing Text-to-Speech (TTS) for the AI's reply.

### Core Files and Responsibilities

| File | Purpose |
| ---- | ------- |
| `controllers/mirror/voice.controller.ts` | The main HTTP entry point for voice operations (`/transcribe`, `/ask`, `/tts`, `/suggest`). Resolves runtime context like reverse geocoding and weather before hitting the cognitive service. |
| `services/shared/cognitive-voice.service.ts` | The core AI prompt engine. Defines the system behavior, intent rules, output contract, and handles streaming/parsing the ChatWonder response into a structured `CognitiveResponse`. |
| `services/shared/voice.service.ts` | Manages external integrations for TTS and Transcription (likely wrapping standard cloud providers). |
| `platforms/chatWonder/chatWonder.service.ts` | The raw HTTP client connecting to the external ChatWonder infrastructure. |

---

## The Cognitive Engine

### System Prompts & Intents
`cognitive-voice.service.ts` enforces a strict JSON output contract from the LLM, moving away from simple text chats to structured, executable intents. 

Supported AI-driven intents include:
- **Navigation**: `navigate`, `maps_navigate`, `maps_preview_location`, `maps_get_directions`
- **Map Controls**: `traffic_on`, `traffic_off`, `traffic_route`, `stop_navigation`, `set_profile`
- **Calendar**: `calendar_save_event`
- **User Actions**: `select_gender`, `speak`, `none`

### Strict JSON Contract (`CognitiveResponse`)
The AI must respond with a JSON object that the frontend executes blindly:
```json
{
  "reply": "I've started navigation to Central Park.",
  "intent": { "primary": "maps_navigate", "secondary": null, "confidence": 0.98 },
  "emotion": "relaxed",
  "action": {
    "type": "maps_navigate",
    "payload": { "destination": "Central Park" }
  },
  "followUpQuestion": null,
  "requiresConfirmation": false,
  "suggestions": [],
  "memoryUpdates": {},
  "uiHints": { "overlay": null, "focus": null },
  "events": []
}
```

### Server-Driven Confirmation
The backend handles flow-control via the `requiresConfirmation` flag. If the user attempts to disrupt a focused flow (e.g., navigating away from the Fashion UI), the AI sets `requiresConfirmation: true` and forms the reply as a Yes/No question. The frontend then halts execution until the user verbally confirms.

### Context Enrichment
Before the prompt hits the AI, `voice.controller.ts` injects live data:
- **Reverse Geocoding**: Resolves coordinates to a readable `locationName`.
- **Weather**: Fetches current temperature, condition, windspeed, and humidity.
- **Smart Mirror State**: Current page, schedule, gender lock, and navigation ETA are provided to the LLM so it can behave contextually.

---

## Progress Tracker

- [x] Integrate basic Transcription (`/transcribe`) and TTS (`/tts`) routes.
- [x] Create `voice.controller.ts` to manage the voice interaction pipeline.
- [x] Introduce `cognitive-voice.service.ts` to replace basic text responses with intent-driven JSON.
- [x] Define `CognitiveResponse` interfaces matching the frontend.
- [x] Implement robust JSON parsing and fallback mechanisms for LLM hallucinations.
- [x] Inject live Weather and Reverse-Geocoding into the AI context window.
- [x] Enforce Gender Lock logic (redirecting to `/select-gender` for fashion/cosmetics if unknown).
- [x] Streamline ChatWonder session management (maintaining conversation history).
- [x] Define Map control and Navigation intents inside the system prompt.

## Next Steps

1. **Emotion / Voice Modulation**: Connect the `emotion` tag (e.g., `urgent`, `relaxed`) to SSML tags in the TTS engine so the mirror's voice sounds dynamically expressive.
2. **Memory Persistence**: Implement processing for `memoryUpdates` to save long-term user preferences back to the database.
3. **Latency Optimization**: Evaluate caching or faster models for the `CognitiveVoiceService` to reduce the time-to-first-audio during conversational interactions.
