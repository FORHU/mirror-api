---
name: mirror-api-context
description: Domain glossary for the Mirror API — the smart mirror lifestyle assistant backend
---

# Mirror API — Domain Glossary

## ChatWonder
The external conversational AI service that powers lifestyle recommendations. Receives a user message (with injected context) and returns structured JSON with fashion, cosmetics, and map guidance. ChatWonder is the **recommendation brain** — it narrates, ranks, and explains; it does not discover or geocode.

## Persona
A system-level instruction injected into every ChatWonder request to constrain its output schema and behaviour. Selected by intent tag in the user message (e.g. `[garments]`, `[map]`, `[overview]`). Defined in `ChatWonderService.getPersonaPrompt`.

## Intent Tag
A bracket-enclosed token added to the user's input (e.g. `[map]`, `[garments]`, `[cosmetics]`, `[outfits]`, `[overview]`) that selects the correct persona. Resolved server-side before forwarding to ChatWonder.

## Routing Pipeline
The server-side layer that handles navigation: geocoding (`mapService` via Mapbox), turn-by-turn directions (Mapbox for cars, ORS for motorcycle/bicycle/walking), and itinerary location resolution (`resolveItineraryLocations`). Does **not** overlap with ChatWonder — the routing pipeline is the navigation engine; ChatWonder is the conversation layer.

## POI (Point of Interest)
A nearby place (restaurant, café, park, etc.) surfaced on the map. For **named-destination queries** (itinerary stops, "find a restaurant at X"), ChatWonder discovers and searches POIs internally via its own Google Places integration and returns them in `[MAPS_DATA]` blocks. The server-side `googlePlacesService.nearbyPOIs` is used separately for the mirror-app map UI (the `/mirror/map/nearby-pois` endpoint), not for ChatWonder chat requests.

## Itinerary
An ordered set of time-labelled stops the user plans to visit. Built conversationally through ChatWonder's MODE A (`itinerary_setup` → `itinerary_resolved`). Once resolved, locations are geocoded server-side by `resolveItineraryLocations`.

## Session (ChatWonder Session)
A stateful conversation context held by the external ChatWonder API, identified by a `sessionId`. Scoped per user, cached in Redis for 24 hours, force-reset on `restart`.

## Restart
A full per-user reset: clears stored gender (so the mirror re-asks for the next person) and forces a new ChatWonder session. Does **not** touch the itinerary.

## Outline / UserOutline
The user's saved plan (fashion + cosmetics selections + itinerary). Status transitions to `FINALIZED` when the user confirms with a finalization phrase.
