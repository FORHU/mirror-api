# Chat Wonder Integration

Chat Wonder is the external conversational AI backend powering the Smart Mirror's voice and text chat features. It exposes a REST API (for session management) and a WebSocket endpoint (for streamed responses). `mirror-api` acts as a proxy — it enriches the user prompt with context, streams the response back to the client via SSE, and persists the conversation history.

---

## Architecture Overview

```
mirror-app / mirror-admin
       │
       │  POST /api/v1/mirror/chat-wonder/stream   (SSE)
       │  Socket: chatwonder_input / chatwonder_response
       ▼
   mirror-api
       ├── ChatWonderController  (SSE route)
       ├── ChatWonderService     (session + conversation persistence)
       ├── streamChat()          (WebSocket proxy to Chat Wonder)
       └── parseChatWonderResponse()  (JSON / markdown normaliser)
       │
       │  WebSocket  ws(s)://<CHAT_WONDER_API_URL>/chat-stream
       ▼
   Chat Wonder API  (external)
       ├── GET  /session-id
       ├── POST /chat            (non-streaming, legacy)
       └── WS   /chat-stream
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `CHAT_WONDER_API_URL` | Base URL of the Chat Wonder service (e.g. `https://api.chatwonder.io`) |

---

## Key Source Files

| File | Role |
|---|---|
| [`src/routes/shared/chat-wonder.route.ts`](../src/routes/shared/chat-wonder.route.ts) | Express route — mounts `POST /stream` under `/mirror/chat-wonder` |
| [`src/controllers/shared/chat-wonder.controller.ts`](../src/controllers/shared/chat-wonder.controller.ts) | SSE controller — orchestrates the full request lifecycle |
| [`src/services/shared/chat-wonder.service.ts`](../src/services/shared/chat-wonder.service.ts) | Session management, conversation persistence, prompt wrapping |
| [`src/platforms/chatWonder/chatWonder.service.ts`](../src/platforms/chatWonder/chatWonder.service.ts) | Low-level REST client (`ask`, `checkStatus`) — used for non-streaming calls |
| [`src/utils/chat-wonder-stream.ts`](../src/utils/chat-wonder-stream.ts) | WebSocket streaming client with `onChunk / onComplete / onError` callbacks |
| [`src/utils/detect-chat-route.util.ts`](../src/utils/detect-chat-route.util.ts) | Fast regex classifier — emits `route` SSE event before the AI stream starts |
| [`src/utils/parse-response.util.ts`](../src/utils/parse-response.util.ts) | Normalises raw Chat Wonder output (JSON or plain text) into `ChatWonderResponse` |
| [`src/utils/source-metadata.util.ts`](../src/utils/source-metadata.util.ts) | Strips the leading `[Sources] [...]` block from accumulated stream text |
| [`src/services/shared/voice.service.ts`](../src/services/shared/voice.service.ts) | Voice pipeline — uses Chat Wonder for the conversational reply step |

---

## SSE Event Flow

```
User (voice/text input)
        │
        ▼
POST /chat-wonder/stream
        │
        ├─► detectChatRoute(input)
        │         │
        │         ▼
        │   SSE: { type: "route", route: "video", query: "chill kpop music" }  ← Frontend navigates immediately
        │
        ├─► AI Stream (ChatWonder API)
        │         │
        │         ▼
        │   SSE: { type: "chunk", content: "..." }  (repeated)
        │
        └─► SSE: { type: "complete", message: "...", videos: [...], communities: [...], ... }
```

The `route` event tells the frontend **which experience to activate** (e.g. navigate to the video player, outfit builder, map) while the full AI response is still streaming. `detectChatRoute` should be a fast, local classifier — regex or lightweight model — so there is no added latency before the stream starts.

---

## SSE Stream — `POST /api/v1/mirror/chat-wonder/stream`

### Request

```http
POST /api/v1/mirror/chat-wonder/stream
Authorization: Bearer <token>
Content-Type: application/json

{
  "input": "What outfit should I wear today?",
  "conversationId": "<optional — omit to start a new conversation>",
  "persona": "<optional — e.g. \"mirror\">"
}
```

**Validation** (Joi):
- `input` — string, 1–500 chars, required
- `conversationId` — string, optional
- `persona` — string, optional, may be empty

### Controller Lifecycle

1. **Ensure conversation** — looks up or creates a `Conversation` record in the DB (`ChatWonderService.ensureConversation`).
2. **Session ID** — fetches or retrieves a cached Chat Wonder session (`ChatWonderService.generateChatSessionId`). Cached per `userId` for 24 hours.
3. **Save user message** — persists the raw input to `ChatMessage` with `role: "USER"`.
4. **Wrap prompt** — calls `ChatWonderService.getAdditionalPrompt(input)` which injects the Smart Mirror system prompt and instructs Chat Wonder to reply in JSON.
5. **Set SSE headers** — `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
6. **Stream** — connects to `<CHAT_WONDER_API_URL>/chat-stream` via WebSocket, forwarding chunks as SSE events.
7. **Complete** — strips sources prefix, parses the accumulated response, saves `role: "AI"` message, emits the `complete` event.

### SSE Event Types

```jsonc
// [TARGET] Emitted before the AI stream starts — frontend navigates immediately
{ "type": "route", "route": "video", "query": "chill kpop music" }

// Emitted for each WebSocket chunk
{ "type": "chunk", "content": "<partial text>" }

// Emitted once the stream ends
{
  "type": "complete",
  "message": "<full cleaned message>",
  "emotion_data": {
    "emotion": "neutral",
    "confidence": 0.85,
    "wasMapped": true
  },
  "videos": [],
  "communities": [],
  "metadata": {
    "conversationId": "<uuid>",
    "userMessageId": "<uuid>",
    "aiMessageId": "<uuid>"
  }
}

// Emitted on error
{ "type": "error", "message": "<error description>" }
```

---

## WebSocket Streaming (`streamChat`)

`chat-wonder-stream.ts` wraps the external Chat Wonder WebSocket:

- Connects to `<CHAT_WONDER_API_URL>/chat-stream` (protocol swapped from `http(s)` → `ws(s)`).
- Sends:
  ```json
  {
    "user_input": "[chumme-(mirror)] <wrapped prompt>",
    "session_id": "<session_id>"
  }
  ```
- Persona prefix format: `[chumme-(<persona>)]` — if no persona is supplied it defaults to `[mirror]`.
- Special message tokens from Chat Wonder:
  - `__END__` — stream complete, close socket.
  - `[Error]...` — reject and surface error.
  - `[Tool]...` — tool execution notification, ignored (no callback).
  - Any other string — text chunk, forwarded via `onChunk`.

---

## Response Parsing (`parseChatWonderResponse`)

Handles two response formats:

1. **JSON** (preferred) — extracts the first `{…}` block and maps to `ChatWonderResponse`:
   ```ts
   interface ChatWonderResponse {
     message: string;
     emotion_data: { emotion: string; confidence: number; wasMapped: boolean };
     videos: ParsedVideo[];
     artist: { name: string; image: string | null }[];
     images: { url: string; caption?: string }[];
     raw: string;
   }
   ```
2. **Plain text fallback** — strips any trailing `[Sources]…` block, returns `message` as the raw text with `wasMapped: false`.

The `getAdditionalPrompt` system prompt tells Chat Wonder to **always respond with valid JSON**, so plain-text fallback should only occur on edge cases or model failures.

---

## Session Management

- Session IDs are obtained from `GET <CHAT_WONDER_API_URL>/session-id`.
- They are cached in Redis/memory under `chat:sessionId:<userId>` with a **24-hour TTL**.
- If the session call fails, an empty string is used and the stream will still be attempted — Chat Wonder may create its own session server-side.
- The voice pipeline (`voice.service.ts`) manages sessions independently via `getChatWonderSession`, which accepts an optional `sessionId` from the socket context.

---

## System Prompt (Smart Mirror)

`ChatWonderService.getAdditionalPrompt` wraps every user message with:

```
You are a Smart Mirror fashion assistant. Respond with ONLY VALID JSON.
{
  "message": "Your helpful fashion advice here",
  "outfit_suggestion": "Describe a recommended outfit if applicable",
  "mood": "happy/chill/etc"
}

USER: <user message>
```

> **Note:** The `outfit_suggestion` and `mood` fields are requested in the prompt but the current `parseChatWonderResponse` implementation only maps `message`, `emotion`, `confidence`, `videos`, `artist`, and `images`. Extend the parser if you need to surface those fields.

---

## Voice Pipeline Integration

`voice.service.ts` uses Chat Wonder as the reply step in the voice flow:

```
PCM audio  →  AWS Transcribe  →  transcript
                                     │
                          detectIntent()  (regex-based, local)
                                     │
                          buildChatWonderQuery()
                            - injects date/time, weather, schedule,
                              current screen, navigation state, staff note
                                     │
                          askChatWonder()  →  streamChat()  →  parseChatWonderResponse()
                                     │
                          AWS Polly TTS  →  MP3 audio
                                     │
                    persist to Conversation / ChatMessage
```

`buildChatWonderQuery` prepends a context block to every transcript:

```
[Smart Mirror — Tuesday, 22 May 2026, 12:00 PM]
Weather: 28°C, Partly Cloudy, wind 14 km/h, humidity 72%
Schedule: <user schedules if provided>
Current screen: /outfit-builder
Navigation: active | destination: SM North | distance: 3.2 km | ETA: 8 mins
Staff note: <optional clarification>

User: <transcript>
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `CHAT_WONDER_API_URL` not set | `streamChat` rejects immediately; controller returns 500 |
| No session ID returned | Warning logged, empty string used; stream attempted anyway |
| WebSocket `[Error]...` message | `onError` called, SSE `error` event emitted, connection closed |
| `parseChatWonderResponse` JSON parse failure | Falls back to raw text, logs warning |
| DB persistence failure in `onComplete` | SSE `error` event emitted, connection closed |
| Headers already sent on late error | Error written as SSE `error` event instead of HTTP 500 |

---

## Health Check

```ts
// platforms/chatWonder/chatWonder.service.ts
ChatWonderService.checkStatus()  // GET <CHAT_WONDER_API_URL>/health → boolean
```

Returns `true` if the external service responds with 2xx, `false` otherwise. Used internally; not currently exposed as a public endpoint.
