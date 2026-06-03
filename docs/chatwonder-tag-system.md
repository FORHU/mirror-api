# ChatWonder Input Tag System

Every call to `/api/mirror/chat-wonder/message` or `/stream` can optionally prefix the
user input with a **tag** to activate a specialized server persona. The tag governs which
system prompt and response schema the AI uses.

---

## Tag Reference

| Tag | Activated by | Persona | Key response fields |
|---|---|---|---|
| `[garment]` | Garment/Fashion page voice | Fashion AI — outfit sets + garment recommendations | `garment_data` |
| `[cosmetics]` | Cosmetics page voice | Cosmetics AI — product sets | `cosmetics_data` |
| `[overview]` | Overview page voice | Companion AI — praises selections | `message` only |
| `[map]` | Map page voice | Map AI — multi-event itinerary, lat/lng resolution | `events[]` |
| *(none)* | Chat UI | Conversational fallback — general lifestyle chat | `message` only |

> **`[NAV_DATA]` is not a tag.** It is a cross-cutting block that the AI can append to
> **any** persona response when it detects navigation intent ("go to fashion", "open cosmetics").
> It is parsed by the API into `nav_data` and handled by the client via `router.push()`.
> See [`chat-wonder-nav-integration.md`](./chat-wonder-nav-integration.md).

---

## [NAV_DATA] — Cross-Cutting Navigation

`[NAV_DATA]` can appear alongside **any** persona response. It is not owned by the default
persona — any tag can co-emit it:

```
[garment] response  →  garment_data  +  optional [NAV_DATA] block
[map] response      →  events[]      +  optional [NAV_DATA] block
*(none)* response   →  message       +  optional [NAV_DATA] block
```

This means the client must **always** check `nav_data` in every response, regardless of
which tag was used.

---

## Default Persona `*(none)*` — Scope

The default persona (no tag) is a **pure conversational fallback**. It does not return
`events[]` or `sets[]`. Its only job is to hold a natural conversation and let the AI
emit `[NAV_DATA]` when it detects navigation intent.

**Do not rely on the default persona for itinerary or fashion data.** Use the appropriate
tagged branch instead.

---

## How Tags Work

The tag is prepended to the `input` field client-side before the API call:

```typescript
// Garment branch — VoiceProvider.tsx
chatWonderService.message({ input: `[garment] ${transcript}` })

// Map branch — VoiceProvider.tsx
chatWonderService.message({ input: `[map] ${transcript}` })
```

On the server, `ChatWonderService.getPersonaPrompt(input)` checks `input.includes("[tag]")`
and returns the matching system prompt.

**File:** `src/services/shared/chat-wonder.service.ts` → `getPersonaPrompt()`

---

## Response Shapes

### `[garment]`

```json
{
  "message": "Here are your outfit recommendations!",
  "success": true,
  "gender": "FEMALE",
  "sets": [
    {
      "set_number": 1,
      "vibe": "Chic Look",
      "recommendations": [
        {
          "id": "db_id",
          "name": "Item Name",
          "fittingSlot": "UpperGarment",
          "garmentType": ["Blazer"],
          "category": ["Business"],
          "imageUrl": ""
        }
      ]
    }
  ]
}
```

### `[cosmetics]`

```json
{
  "message": "Here are your cosmetics picks!",
  "success": true,
  "sets": [
    {
      "set_number": 1,
      "vibe": "Fresh Glow",
      "recommendations": [
        { "id": "db_id", "name": "Product Name", "type": "FOUNDATION", "imageUrl": "" }
      ]
    }
  ]
}
```

### `[overview]`

```json
{
  "message": "You look amazing! The blazer elevates your style perfectly.",
  "outfit_suggestion": null,
  "cosmetics_suggestion": null,
  "events": []
}
```

### `[map]` — incomplete events (reprompt)

```json
{
  "message": "Where is your morning date and where is your lunch meeting?",
  "intent": "itinerary_setup",
  "events": [
    { "eventName": "date", "eventType": "romantic", "timeLabel": "morning", "map": null },
    { "eventName": "meeting", "eventType": "professional", "timeLabel": "lunch", "map": null }
  ]
}
```

### `[map]` — all events resolved

```json
{
  "message": "Your itinerary is ready!",
  "intent": "itinerary_resolved",
  "events": [
    {
      "eventName": "date",
      "timeLabel": "morning",
      "map": { "destination": "Central Park", "lat": 40.7851, "lng": -73.9683, "address": "Central Park, NY", "placeId": "ChIJ..." }
    },
    {
      "eventName": "meeting",
      "timeLabel": "lunch",
      "map": { "destination": "The Ritz Carlton", "lat": 40.7614, "lng": -73.9776, "address": "50 Central Park S, NY", "placeId": "ChIJ..." }
    }
  ]
}
```

---

## Client-Side Tag Assignment

| Page / Mode | Tag | File |
|---|---|---|
| Garment/Fashion page voice | `[garment]` | `VoiceProvider.tsx` — garment branch |
| Cosmetics page voice | `[cosmetics]` | `VoiceProvider.tsx` *(to be wired)* |
| Overview page voice | `[overview]` | `VoiceProvider.tsx` *(to be wired)* |
| Map page voice | `[map]` | `VoiceProvider.tsx` — map branch *(new)* |
| Chat UI | *(none)* | `useChatWonderStream.ts` |

---

## Adding a New Tag

1. Add the tag check in `getPersonaPrompt()` in `src/services/shared/chat-wonder.service.ts`
2. Define the strict JSON schema the AI must return
3. Add the client branch in `VoiceProvider.tsx` (voice) or handle in `useChatWonderStream.ts` (chat)
4. Add the response interface in `modules/shared/api/chat-wonder.service.ts` (mirror-app)
5. Document it in this file

---

## Related Docs

- [`chat-wonder-nav-integration.md`](./chat-wonder-nav-integration.md) — `[NAV_DATA]` navigation block details
- [`voice_chatwonder_progress.md`](./voice_chatwonder_progress.md) — Voice + ChatWonder integration progress
