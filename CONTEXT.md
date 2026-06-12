---
name: mirror-api-context
description: Domain glossary for the Mirror API — the smart mirror lifestyle assistant backend
---

# Mirror API — Domain Glossary

## ChatWonder
The external conversational AI service that powers lifestyle recommendations. Receives a user message (with injected context) and returns structured JSON with fashion and cosmetics guidance. ChatWonder is the **recommendation brain** — it narrates, ranks, and explains.

## Persona
A system-level instruction injected into every ChatWonder request to constrain its output schema and behaviour. Selected by intent tag in the user message (e.g. `[garments]`, `[cosmetics]`, `[overview]`). Defined in `ChatWonderService.getPersonaPrompt`.

## Intent Tag
A bracket-enclosed token added to the user's input (e.g. `[garments]`, `[cosmetics]`, `[outfits]`, `[overview]`) that selects the correct persona. Resolved server-side before forwarding to ChatWonder.

## Session (ChatWonder Session)
A stateful conversation context held by the external ChatWonder API, identified by a `sessionId`. Scoped per user, cached in Redis for 24 hours, force-reset on `restart`.

## Restart
A full per-user reset: clears stored gender (so the mirror re-asks for the next person) and forces a new ChatWonder session. Does **not** touch the itinerary.

## Outline / UserOutline
The user's saved plan (fashion + cosmetics selections). Status transitions to `FINALIZED` when the user confirms with a finalization phrase.
