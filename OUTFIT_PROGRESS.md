# Outfit Module — Progress Checklist

Tracking fixes from the review of `src/controllers/shared/outfit.controller.ts` (and the service/repo/validation it touches). Work top-down; the critical bug should ship before anything else.

---

## Critical

- [x] **Replace `FileService.uploadFile(...)` with `FileService.attachPresignedUrls(...)` for response hydration.** `uploadFile` expects a multer file object and crashes (`fs.readFile(undefined)`) when handed an outfit/array. Every read endpoint is broken.
  - [x] `index` — controller line 43 (`data.data` array)
  - [x] `show` — line 55
  - [x] `create` idempotent-reuse branch — line 129
  - [x] `create` success — line 141
  - [x] `update` — line 166
  - [x] `recommend` — line 412

---

## High

- [x] **`update` wipes all items on partial PATCH.** Added a dedicated `outfitUpdateSchema` (no defaults). `items` omitted → composition untouched; `items: []` → explicit clear.
- [x] **`update` is missing `create`'s safety net.** Added:
  - [x] `validateGarmentIds(items)` before any write (only when items provided)
  - [x] `req.file` mime check (`startsWith("image/")`)
  - [x] Reject `req.file && fileId` both present
- [x] **`evaluateHybrid` skips orphan cleanup on AI failure.** Added `discardOrphanedFile(fileRecord)` in the catch block, matching `evaluate`.
- [x] **Authenticated-user guard for AI / write endpoints.** `evaluate`, `evaluateHybrid`, `compose`, `recommend` now 401 via `unauthorizedError()` when `userId` is missing.
- [x] **Add Joi schemas to `evaluate` / `evaluateHybrid` bodies.** Added `evaluateSchema` + `evaluateHybridSchema` (`compose` already had one). `prompt` now rejected (not silently truncated) above 500; `generate` constrained to `GENERABLE_FIELDS`.

---

## Medium

- [x] **`prepareBody` swallows JSON parse errors silently.** Now logs a `logger.warn` naming the field + parse error; Joi still surfaces a typed error to the caller.
- [x] **Honor `pickProvided` in the persist functions.** Verified: `evaluateOutfitImage` and `matchOutfitToWardrobe` both call `mergeEvaluation`, which already gives caller values precedence over AI output. No code change needed; the persist functions correctly write the merged result.
- [x] **Standardize the 202 envelope.** Switched all three 202s (`evaluate`, `compose`, `evaluateHybrid`) to `{ status: "success", statusCode: 202, data, message }`. *Note: any client branching on `status === "queued"` needs an update.*
- [x] **Remove the duplicate idempotency check.** Decision: keep both. Controller check skips the AI call entirely (cost win); service check guards direct callers. Existing comment at `evaluate` line ~220 already documents this.
- [ ] **Background-work durability.** IIFEs after the 202 are lost if the process restarts mid-flight. Deferred — promote to a real job queue when load justifies it.

---

## Minor

- [ ] Type Express `Request` with `user?: { id: string }` once and remove the `(req as any).user?.id` casts (~10 sites). Deferred — project-wide refactor.
- [x] **`outfitSchema` vs AI fields.** Decision: AI-endpoint-only. `evaluateSchema` / `evaluateHybridSchema` accept `tags` / `dominantColor` / `generate`; basic `POST /outfits` doesn't, by design.
- [x] **Unify prompt-length handling.** With the new Joi schemas, `evaluate` and `evaluateHybrid` now `.max(500)` reject above 500 — matches `compose`.
- [x] **Apply mime check** (`req.file.mimetype?.startsWith("image/")`) to `update`, `evaluate`, `evaluateHybrid`.

---

## Verification

After all fixes, walk through each route end-to-end:

- [ ] `GET /outfits` returns outfits with signed image URLs (no 500).
- [ ] `GET /outfits/:id` returns one outfit with signed URLs.
- [ ] `POST /outfits` with a file creates; second identical call returns the same outfit (idempotent).
- [ ] `POST /outfits` with bad garmentId 400s and leaves S3 clean.
- [ ] `PATCH /outfits/:id` with only `{ name }` does NOT wipe items.
- [ ] `POST /outfits/evaluate` 202s, then socket-emits `outfit_evaluated`; failure case cleans up S3.
- [ ] `POST /outfits/evaluate-hybrid` same as above; failure cleans up S3.
- [ ] `POST /outfits/compose` 202s, emits `outfit_composed`.
- [ ] `POST /outfits/recommend` returns a synchronous outfit with signed URLs.
- [ ] `DELETE /outfits/:id` removes items + outfit.
