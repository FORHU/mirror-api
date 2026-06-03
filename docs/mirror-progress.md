# Mirror — Progress & Current Tasks

> Working context: **testing ground**. We are NOT overriding ChatWonder's prompts
> right now — ChatWonder (the external WS API) is the AI engine and the source of
> truth for replies, structured data blocks, AND navigation decisions. mirror-api
> is a passthrough that parses what ChatWonder emits and adds backend effects
> (persistence, TTS, geocoding only where ChatWonder doesn't).

In scope: **mirror-api** + **mirror-app** (`/api/mirror/*`). companion-app and
kiosk are out of scope / being phased out.

---

## Decisions locked in

- **Navigation is handled by ChatWonder.** We do not classify intent or resolve
  routes in the backend. ChatWonder decides the screen/route and emits the data;
  mirror-api forwards it. (No backend "manufacture maps" work — that option is
  dropped.)
- **No prompt overrides from our side during testing.** The local
  `chatwonder-navigation.contract.xml` is a reference/spec only; it is NOT injected
  into outgoing payloads. Anything ChatWonder emits comes from its own server-side
  prompt.

---

## Task 1 — `MAPS_DATA` structured block (DONE, verify in client)

ChatWonder now appends a `[MAPS_DATA]` block to map/itinerary replies, mirroring
`[GARMENT_DATA]` / `[COSMETICS_DATA]`.

- **Shape:** a **top-level JSON array**, one nearby-search result set per stop —
  `[{ success, query, location_label, lat, lng, radius, search_mode,
  total_results, places: [...] }, ...]`. Each `place` has `name, address, rating,
  user_ratings_total, place_id, types, lat, lng, open_now, photo_url, price_level`.
  Verified live with a 3-stop itinerary (SM Baguio / La Union / Tagudin).
- **Parsing wired** in `src/utils/parse-chatWonder-response.util.ts`:
  - `MAPS_DATA` added to `DATA_BLOCK_TAIL` and the next-marker stop regex.
  - `extractChatWonderDataBlock` accepts `"MAPS_DATA"` and returns
    `Record<string, unknown> | unknown[] | null` — matches `[` vs `{` on the
    payload's opening bracket so the array's outer `[]` survives.
- **Controllers** (`src/controllers/shared/chat-wonder.controller.ts`): both
  `/stream` (SSE `complete` → `maps`) and `/message` (`maps_data`) surface the
  block; `message` is stripped of the appended `[MAPS_DATA]` block.
- **Request context:** both endpoints accept optional `location` and inject it +
  `weather` into the prompt text sent to ChatWonder.

> Note: `maps_data` is **content** (the place/restaurant search results to render).
> It is NOT the same as navigation (which screen to show) — see Task 4. The two are
> independent: ChatWonder can return `maps_data` without it being a "go to the MAP
> screen" decision, and a navigation decision need not carry map content.

---

## Task 2 — Voice: speak the ChatWonder reply (DONE)

Goal: when ChatWonder returns a response, play it as audio (TTS) — the mic
conversation runs through the same ChatWonder engine.

- `/api/mirror/chat-wonder/message` now accepts opt-in `voice: true` (+ optional
  `lang`, default `en-US`) and returns `data.audioBase64` — a base64 MP3 of the
  clean reply via `voiceService.tts` (AWS Polly).
- **Opt-in / non-breaking:** existing callers that don't pass `voice` are
  unaffected (`audioBase64: null`). TTS failure is non-fatal — text reply still
  returns.
- Existing voice routes remain: `/mirror/voice/transcribe` (STT),
  `/mirror/voice/ask` (cognitive flow + TTS), `/mirror/voice/tts` (text → mp3).

---

## Task 3 — Kiosk removal (TEMP, dated 2026-06-03)

Kiosk frontend is gone; companion-app doesn't use websockets — so socket emits go
to nobody. Disabled (not deleted) for now:

- `src/events/index.ts` — `registerKioskEvents` import + call commented out.
- `src/utils/socket.util.ts` — `emitToKiosk` gutted to a no-op.

Restore these bodies if kiosk/websocket delivery returns; otherwise delete in a
later cleanup pass.

---

## Task 4 — `[nav]` navigation via `NAV_DATA` (backend DONE; client consumer pending)

Separate concern from Task 1. **navigation = where to send the user** (a route);
`maps_data` = the content to render. One does not supersede the other.

How it actually works (confirmed live): send `[nav] <request>` + `sitemap_context`
(Task 7) and ChatWonder appends a **`[NAV_DATA]`** block — an OBJECT:
```
…prose…[NAV_DATA]{"target_url":"/ai-recommendation-fashion","confidence":0.95,"extracted_entities":null,"system_message":"…"}
```
(The marker is `NAV_DATA`, not the older spec's `NAVIGATION_DATA`. `target_url` is one
of the routes we sent in `sitemap_context`.)

Backend wired (parallel to `MAPS_DATA`):
- `parse-chatWonder-response.util.ts` — `NAV_DATA` added to `DATA_BLOCK_TAIL`, the
  `parseChatWonderResponse` strip, and the `extractChatWonderDataBlock` stop-regex +
  type union. The block no longer leaks into `message`.
- `chat-wonder.controller.ts` — `/message` returns `nav_data`; `/stream` `complete`
  event returns `nav`.
- mirror-app — `ChatWonderMessageResponse.nav_data: ChatWonderNavData | null` typed.

Still pending: **a client consumer** that calls `router.push(nav_data.target_url)`.
Note this overlaps the existing voice nav system (`actionExecutor.executeAction`,
which routes on `action.route`) — converge or keep separate. The fashion test-page
mic flow is NOT the place (it sends `[garment]`, never `[nav]`).

Superseded/stale: `navigation_to_apps.md`'s `deriveNavigateTarget` claim (function
doesn't exist) and `chatwonder-navigation.contract.xml`'s `[NAVIGATION_DATA]` object
spec (live marker is `NAV_DATA` with `target_url`).

---

## Task 5 — Restart & Refresh semantics (DONE)

Two distinct resets, both as mirror-api endpoints:

- **Restart** (next person at the mirror): `POST /api/mirror/chat-wonder/restart`
  - Nulls `User.gender` (`ChatWonderService.clearUserGender`) so the app re-asks.
  - Forces a brand-new ChatWonder session (`generateChatSessionId(userId, true)`),
    clearing conversation history.
  - Returns `{ sessionId, gender: null }`. Does NOT touch the itinerary.
- **Refresh** (reset itinerary): `POST /api/mirror/outlines/reset`
  - Soft-deletes all active outlines for the user
    (`OutlineRepo.softDeleteAllByUserId` → stamps `deletedAt`), so `getActive`
    returns null. Returns `{ cleared: <count> }`.

Note: restart and refresh are independent by design. If a restart should also wipe
the itinerary, the client calls both endpoints.

---

## Task 6 — Frontend wiring (mirror-app) (DONE)

Connected the backend work above to mirror-app:

- **Voice audio** — `chatWonderService.message` now sends `voice: true` (+ optional
  `location`, `lang`) and the response type carries `audioBase64` + `maps_data`.
  New helper `modules/shared/voice/playBase64Audio.ts` plays the base64 MP3; wired
  into the fashion test-page mic flow so the reply is spoken after it's shown.
- **Restart** — `chatWonderService.restart()` → `POST /chat-wonder/restart`.
- **Refresh / reset itinerary** — `outlineService.reset()` → `POST /outlines/reset`.

Both `mirror-api` and `mirror-app` type-check clean (`tsc --noEmit`).

> Still to do on the client: call `restart()` from the restart button and
> `reset()` on the refresh/landing flow (services are ready; UI hooks not yet
> attached). Audio is only wired on the fashion test-page mic call site so far.

---

## Task 7 — `sitemap_context` navigation (DONE, plumbing)

How ChatWonder's `[nav]` works (from the reference demo): the client sends a
`sitemap_context` array (the app's routes) alongside `user_input`, and ChatWonder
resolves the request (e.g. `[nav] Take me to the shoes page`) to one of those routes.

Wired our own sitemap end-to-end:
- **mirror-app** — `navigation.ts` exports `SITEMAP_CONTEXT = Object.values(ROUTES)`.
  `chatWonderService.message` always sends `sitemap_context` (defaults to
  `SITEMAP_CONTEXT`, override via `request.sitemapContext`).
- **mirror-api** — `/message` and `/stream` accept `sitemap_context`
  (`Joi.array().items(string)`) and forward it; `streamChat` adds `sitemap_context`
  to the ChatWonder WS payload when non-empty.

> This is **plumbing only** — the app's routes now reach ChatWonder. ChatWonder must
> be configured to use `sitemap_context` and return a nav decision; and the client
> still needs to act on that decision (route the user). The shape of ChatWonder's nav
> response for our flow is not yet confirmed — ties into Task 4 (`NAVIGATION_DATA`).

---

## Open / next

- [ ] Confirm in the client that `maps_data` parses to the 3-element array (not
      just present-but-null). Check whether the `[MAPS_DATA]` block is leaking
      into `data.message` vs. living only in `data.maps_data` / `raw`.
- [ ] Decide if `/stream` should also return `audioBase64` on its `complete`
      event, or if `/message` is the voice authority.
- [ ] Decide whether to wire `NAVIGATION_DATA` / screen routing (Task 4) — separate
      from `maps_data`. Depends on ChatWonder emitting the block.
- [ ] Fix `navigation_to_apps.md`: it claims `deriveNavigateTarget` / a `navigate`
      field is implemented; it is not. Correct or delete.
- [ ] Voice maps parity: cognitive `/ask` returns a destination *name*, not
      resolved places. Revisit only if voice needs rendered map data.

---

## Git state (mirror-api, branch `staging`)

- 2 unpushed commits ahead of `origin/staging`: `parsers`, `garments authentication`.
- Uncommitted: MAPS_DATA parsing, voice TTS opt-in, kiosk disable, this doc, and
  the two reference docs (`chatwonder-navigation.contract.xml`,
  `navigation_to_apps.md`).
