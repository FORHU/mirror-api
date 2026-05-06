# Mirror Auth & Pairing — Implementation Plan

## 1. Design principle

**No free-floating login.** A user account is only created/authenticated *as part of* claiming a pairing. There is no `POST /auth/login` that exists in isolation — the only way for a mobile session to come into existence is by claiming a kiosk's pairing code. This kills three problems at once: account-enumeration, drive-by signups, and orphan sessions.

---

## 2. Identities

| Identity | Issued to | Carrier | Lifetime | Stored |
|---|---|---|---|---|
| **Device token** | Kiosk web (per browser install) | `Authorization: Device <jwt>` header | Long-lived (1y), refreshable | Kiosk localStorage |
| **User access token** | Mobile web user | `Authorization: Bearer <jwt>` header | 15 min | Mobile memory |
| **User refresh token** | Mobile web user | httpOnly Secure cookie | 30 days | Cookie + DB hash |
| **Pairing code** | Kiosk → user via QR | URL path | 5 min, one-time | Redis only |
| **Kiosk session** | Bound device↔user pair | DB row | Until revoked | DB |

Why the split: a kiosk shouldn't ever hold a user JWT (XSS on the mirror display would steal a user's session). A user shouldn't ever hold a device token. The pairing code is the only artifact that crosses the boundary, and it's ephemeral.

---

## 3. End-to-end flow

```
KIOSK                            BACKEND                            MOBILE
  │                                 │                                 │
  │ POST /devices/register          │                                 │
  │  (first run only)               │                                 │
  ├────────────────────────────────►│                                 │
  │  ◄── { deviceToken }            │                                 │
  │                                 │                                 │
  │ POST /pair/init                 │                                 │
  │  Auth: Device <token>           │                                 │
  ├────────────────────────────────►│                                 │
  │  ◄── { code: "K7M2QX",          │                                 │
  │        expiresAt }              │                                 │
  │                                 │                                 │
  │ render QR ──► https://mobile.app/p/K7M2QX                         │
  │                                 │                                 │
  │ GET /pair/K7M2QX/events (SSE)   │                                 │
  ├────────────────────────────────►│       user scans QR             │
  │  (open stream, waiting)         │◄────────────────────────────────┤
  │                                 │  GET https://mobile.app/p/K7M2QX│
  │                                 │     mobile renders {email,name} │
  │                                 │     form                        │
  │                                 │                                 │
  │                                 │  POST /pair/K7M2QX/claim        │
  │                                 │   body: { email, name }         │
  │                                 │◄────────────────────────────────┤
  │                                 │  upsert user                    │
  │                                 │  create KioskSession            │
  │                                 │  delete pair code (one-time)    │
  │                                 │  ─► { accessToken, user }       │
  │                                 │     + Set-Cookie: refresh       │
  │  ◄── SSE: { status:"claimed",   │                                 │
  │            userId }             │                                 │
  │                                 │                                 │
  │ GET /kiosk/active-outfit        │                                 │
  │  Auth: Device <token>           │                                 │
  ├────────────────────────────────►│                                 │
  │  ◄── { outfit, garments }       │                                 │
```

---

## 4. Endpoints

### Auth (mobile-only, no standalone login)
```
POST /api/v1/auth/refresh
  Cookie: refreshToken=...
  → 200 { accessToken }   (rotates refresh cookie)

POST /api/v1/auth/logout
  Auth: Bearer
  → 204
```

### Pairing
```
POST /api/v1/pair/init
  Auth: Device <token>
  → 201 { code: "K7M2QX", expiresAt: "2026-05-05T10:05:00Z", ttl: 300 }

GET /api/v1/pair/:code/events
  Auth: Device <token>          # must match the device that initiated
  → SSE stream:
       event: pending     (heartbeat every 15s)
       event: claimed     data: { userId, kioskSessionId }
       event: expired

POST /api/v1/pair/:code/claim       # MOBILE — public (rate-limited)
  body: { email: "j@x.com", name: "Jane" }
  → 200 { accessToken, user: { id, email, name } }
       Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Lax
```

### Device (kiosk lifecycle)
```
POST /api/v1/devices/register
  body: { label?: "Living Room Mirror" }
  → 201 { deviceToken, deviceId }
        # token is a long-lived JWT signed with DEVICE_SECRET, claim: { deviceId }

POST /api/v1/devices/me/refresh-token
  Auth: Device <token>
  → 200 { deviceToken }   # rotation, optional

DELETE /api/v1/kiosk/session
  Auth: Device <token>
  → 204                   # unpair this kiosk
```

### Kiosk view (device-authed)
```
GET /api/v1/kiosk/active-outfit
  Auth: Device <token>
  → 200 { outfit, garments[] }   # whichever outfit the paired user selected
  → 409 if no active KioskSession

GET /api/v1/kiosk/me
  Auth: Device <token>
  → 200 { device, pairedUser?: { id, name } }
```

### User resources (mobile-authed)
```
GET    /api/v1/me                       Auth: Bearer
GET    /api/v1/outfits                  Auth: Bearer
POST   /api/v1/outfits                  Auth: Bearer  body: {...}
GET    /api/v1/outfits/:id              Auth: Bearer
PATCH  /api/v1/outfits/:id              Auth: Bearer
DELETE /api/v1/outfits/:id              Auth: Bearer
POST   /api/v1/outfits/:id/activate     Auth: Bearer  # push to current kiosk

GET    /api/v1/garments
POST   /api/v1/garments
POST   /api/v1/file-uploads/upload
```

---

## 5. Data layer

### Prisma (DB)

```prisma
model User {
  id              String    @id @default(uuid())
  email           String    @unique
  name            String
  emailVerifiedAt DateTime?              // null today; set once OTP/Google added
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  isDeleted       Boolean   @default(false)
  avatarId        String?
  avatar          File?     @relation("UserAvatar", fields: [avatarId], references: [id])
  sessions        Session[]
  outfits         Outfit[]
  kioskSessions   KioskSession[]
}

model Device {
  id            String    @id @default(uuid())
  label         String?
  createdAt     DateTime  @default(now())
  lastSeenAt    DateTime  @default(now())
  revokedAt     DateTime?
  kioskSessions KioskSession[]
}

model KioskSession {        // = "this mirror is currently showing this user"
  id        String    @id @default(uuid())
  deviceId  String
  userId    String
  createdAt DateTime  @default(now())
  expiresAt DateTime?       // optional; null = until revoked
  revokedAt DateTime?
  device    Device    @relation(fields: [deviceId], references: [id])
  user      User      @relation(fields: [userId], references: [id])
  @@index([deviceId])
  @@index([userId])
}

model Session {              // user refresh-token sessions
  id               String    @id @default(uuid())
  userId           String
  refreshTokenHash String    @unique     // sha256 of token, NOT the token
  createdAt        DateTime  @default(now())
  expiresAt        DateTime
  revokedAt        DateTime?
  userAgent        String?
  ip               String?
  user             User      @relation(fields: [userId], references: [id])
  @@index([userId])
}
```

**Drop**: `User.password`, `User.username`, `Session.accessToken`, `Session.platform` (replaced by `userAgent`).

### Redis (pairing codes, hot path)

```
KEY:   pair:{CODE}                     (e.g. pair:K7M2QX)
TYPE:  Hash
TTL:   300s
FIELDS:
  deviceId    string   (the kiosk that asked)
  status      string   "pending" | "claimed"
  userId      string   (set on claim)
  createdAt   string   ISO

KEY:   pair:claim_lock:{IP}           # rate-limit guess attempts
TYPE:  String (counter)
TTL:   60s
```

**Code format**: 6 chars from Crockford base32 alphabet (excludes I, L, O, U → no ambiguity, ~1B combinations). Generated cryptographically (`crypto.randomBytes`).

---

## 6. Security details

| Threat | Mitigation |
|---|---|
| Pair-code brute force | 6 chars × 32 alphabet = ~1B; 5min TTL; per-IP rate limit on `/pair/:code/claim` (10 attempts / min); per-code attempt cap (5 wrong → invalidate) |
| Same code reused | Redis key deleted on first successful claim — second claim returns 410 |
| Email impersonation | Cannot be eliminated without verification, but contained: a stolen identity is useless without physical access to a kiosk + valid pair code |
| Stolen device token | Rotate via `/devices/me/refresh-token`; revoke device row to invalidate all KioskSessions in cascade |
| XSS on kiosk steals tokens | Kiosk only ever holds device token (no user data); device token can be revoked without user impact |
| XSS on mobile steals refresh token | Refresh in `httpOnly` cookie, inaccessible to JS |
| CSRF on claim endpoint | `SameSite=Lax` cookie + custom header check on mutating endpoints |
| Pair init flooding | Auth-required (device must be registered); rate-limit per device (e.g. 1 init per 30s) |

---

## 7. CORS

```ts
const ALLOWED = [
  process.env.MOBILE_WEB_ORIGIN,   // https://mobile.mirror.app
  process.env.KIOSK_WEB_ORIGIN,    // https://kiosk.mirror.app
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error("CORS blocked"));
  },
  credentials: true,                // required for refresh-cookie
  methods: ["GET","POST","PATCH","DELETE"],
}));
```

**Drop the current `origin: "*"`** in `src/app.ts` — incompatible with `credentials: true` anyway.

The kiosk can be even more locked down with an additional middleware: `/kiosk/*` and `/devices/*` only accept requests where `Origin` matches `KIOSK_WEB_ORIGIN`. Same for `/pair/:code/claim` and `/auth/*` → `MOBILE_WEB_ORIGIN`.

---

## 8. Future upgrades (non-breaking)

### Add Google Sign-In
Same pairing flow. Add a parallel claim endpoint:
```
POST /pair/:code/claim/google
  body: { idToken }
  → same response shape as /claim
```
Service path swaps `upsertByEmailAndName(...)` for `upsertByGoogleIdToken(...)`. Mobile UI shows both: "Sign in with Google" or "Continue with email." Schema adds `User.googleId String? @unique`. Existing email-only users link by matching `email` on first Google sign-in.

### Add OTP email verification
Mobile UI flow becomes two-step:
```
POST /pair/:code/claim          → 202 { status: "otp_sent" }   (no tokens yet)
POST /pair/:code/verify         body: { otp: "483921" }
                                → 200 { accessToken, ... }
```
Pair-code Redis key gains `otp` and `otpExpiresAt` fields; tokens are only issued after verify. Existing claim endpoint stays the same shape — clients just need to handle the 202 case. Schema: `User.emailVerifiedAt` is already in place; set it on successful verify.

### Both at once
Google users: `emailVerifiedAt = now()` (Google verified it). Email users: stays null until OTP flow added. Front-end shows a "verify your email" nag for users with `emailVerifiedAt: null`.

---

## 9. Build order

1. **Schema migration**: drop `password`/`username`, add `name`/`emailVerifiedAt`, add `Device`/`KioskSession`, refactor `Session` to store `refreshTokenHash`.
2. **`DeviceAuth` middleware** — verify `Authorization: Device <jwt>` against `DEVICE_SECRET`.
3. **Pairing endpoints** — `POST /devices/register`, `POST /pair/init`, SSE `GET /pair/:code/events`.
4. **Claim endpoint** — `POST /pair/:code/claim` (upsert user, create KioskSession, publish to SSE).
5. **Refactor `authenticate` middleware** — use `Bearer`, treat `User.isDeleted` as 401, not 404.
6. **Refresh-token flow** — `httpOnly` cookie, hash at rest.
7. **Lock down CORS** — two known origins, drop `*`.
8. **Rate limiters** — on `/pair/init` and `/pair/:code/claim`.
9. **Kiosk view** — `/kiosk/active-outfit` reading from current `KioskSession`.

---

## 10. New env vars

```
DEVICE_SECRET=<random 32+ bytes>           # for signing device JWTs
MOBILE_WEB_ORIGIN=https://mobile.mirror.app
KIOSK_WEB_ORIGIN=https://kiosk.mirror.app
ACCESS_TOKEN_EXPIRY=15m                    # was 7d — too long for access tokens
DEVICE_TOKEN_EXPIRY=365d
PAIR_CODE_TTL_SECONDS=300
```
