# ChatWonder Navigation (`[NAV_DATA]`) — Frontend Integration Guide

## Overview

The `/mirror/chat-wonder/message` endpoint supports **AI-driven navigation** via ChatWonder's `[NAV_DATA]` block. When the user says something like _"take me to fashion"_ or _"show me the map"_, ChatWonder appends a machine-readable navigation decision to its response. The API parses this and returns it as `nav_data` in the JSON payload.

**No backend changes are needed.** This is fully wired and ready on the API side.

---

## How It Works

```
Frontend POST /mirror/chat-wonder/message
  ↓  sends: { input, sitemap_context: ["/", "/select-gender", ...] }

ChatWonder AI processes the message + sitemap context
  ↓  emits: "Sure, heading to fashion now."
            [NAV_DATA]{ "target_url": "/ai-recommendation-fashion", "confidence": 0.97 }[DONE]

API extracts [NAV_DATA] block → nav_data field
  ↓  returns: { message: "Sure, heading...", nav_data: { target_url, confidence, ... } }

Frontend reads nav_data → navigates to target_url  ✅
```

---

## API Contract

### Request

`POST /mirror/chat-wonder/message`

```json
{
  "input": "Take me to the fashion page",
  "conversationId": "optional-existing-conversation-id",
  "sitemap_context": [
    "/",
    "/select-gender",
    "/ai-recommendation-fashion",
    "/ai-recommendation-cosmetic",
    "/map",
    "/overview",
    "/virtual-mirror",
    "/authentication"
  ],
  "weather": { },
  "location": { }
}
```

> **`sitemap_context` is the key field.** Always send the full list of valid routes the app supports. ChatWonder will only navigate to URLs that appear in this list — it will never invent a route.

### Response

```json
{
  "status": "success",
  "data": {
    "message": "Sure! Let me take you to the fashion recommendation page.",
    "nav_data": {
      "target_url": "/ai-recommendation-fashion",
      "confidence": 0.97,
      "extracted_entities": { "section": "fashion" },
      "system_message": "User explicitly asked for fashion page"
    },
    "garment_data": null,
    "cosmetics_data": null,
    "maps_data": null,
    "events": [],
    "sets": [],
    "metadata": {
      "conversationId": "...",
      "userMessageId": "...",
      "aiMessageId": "..."
    }
  },
  "message": "OK"
}
```

`nav_data` is `null` when the user's message has no navigation intent (e.g. asking about weather, or a follow-up question).

---

## Frontend Implementation Checklist

- [ ] **Always include `sitemap_context`** in every `/message` call — pass all valid routes in the app.
- [ ] After receiving the response, **check `nav_data`**:
  ```ts
  if (response.data.nav_data?.target_url) {
    router.push(response.data.nav_data.target_url);
  }
  ```
- [ ] Optionally use `nav_data.confidence` to gate low-confidence navigations (e.g. only navigate if `confidence >= 0.8`).
- [ ] Display `response.data.message` in the chat bubble regardless of whether nav_data is present.

---

## Navigation Rules (enforced by ChatWonder)

These rules are defined in `chatwonder-navigation.contract.xml` and are enforced server-side:

| Rule | Behaviour |
|---|---|
| `target_url` must match `sitemap_context` | AI will never invent a route not in your list |
| Ambiguous intent | AI asks a clarifying question in prose; no `[NAV_DATA]` block emitted |
| Conversational message | No `[NAV_DATA]` block emitted; `nav_data` is `null` |
| Navigation + data block | AI can emit `[NAV_DATA]` alongside `[GARMENT_DATA]` or `[COSMETICS_DATA]` |

---

## Valid App Routes (current sitemap)

```ts
export const APP_SITEMAP = [
  "/",
  "/select-gender",
  "/authentication",
  "/ai-recommendation-fashion",
  "/ai-recommendation-cosmetic",
  "/map",
  "/overview",
  "/virtual-mirror",
];
```

> Keep this list in sync with your frontend router. When you add a new screen, add its route here and in every `sitemap_context` payload.

---

## Relevant Files

| File | Role |
|---|---|
| `src/routes/shared/chat-wonder.route.ts` | Registers `POST /message` |
| `src/controllers/shared/chat-wonder.controller.ts` | `chat()` method — extracts `nav_data` |
| `src/utils/parse-chatWonder-response.util.ts` | `extractChatWonderDataBlock("NAV_DATA")` |
| `src/utils/chat-wonder-stream.ts` | Forwards `sitemap_context` to ChatWonder WebSocket |
| `chatwonder-navigation.contract.xml` | Navigation rules & output schema given to ChatWonder |

---

## Difference from Cognitive Voice (`/mirror/voice/ask`)

The `/message` endpoint uses the **`[NAV_DATA]` contract** (lightweight, data-block approach).  
The `/voice/ask` endpoint uses **`cognitiveVoiceService`** (full intent parsing, `requiresConfirmation`, `action`, `emotion`, etc.).

For the text chat interface, `[NAV_DATA]` is the right choice — simpler, and ChatWonder handles the navigation decision natively without an extra orchestration layer.
