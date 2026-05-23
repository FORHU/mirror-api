# Mirror API - Development Progress & Architecture

This document tracks the architectural decisions, implemented features, and the communication flow for the Mirror API.

## 🏗️ Architecture Overview

The API follows a **Client-Specific Layered Architecture** to cleanly separate the logic for the two distinct frontend applications.

### Folder Structure
- `src/routes/`, `src/controllers/`, `src/services/`
  - `remote/`: Logic specific to the **Mobile Remote Control** app.
  - `mirror/`: Logic specific to the **Smart Mirror Kiosk** display.
  - `shared/`: Common logic used by both (Garments, Outfits, File Uploads).
- `src/repositories/`: Flat structure for shared database access.
- `src/platforms/`: Third-party API integrations (e.g., FASHN.AI).

---

## 🚀 Key Features Implemented

### 1. Authentication (Remote)
- **Passwordless Flow**: Email-based registration and login.
- **Auto-Registration**: New users are automatically created with unique usernames.
- **JWT Security**: Protected routes for both Remote and Mirror.

### 2. S3 Storage (Optimized)
- **Presigned URLs**: Bypasses the backend for file uploads. The Kiosk uploads photos directly to S3, reducing server load and latency.
- **Upload Confirmation**: Secure metadata storage in the database after S3 upload is complete.

### 3. Real-Time Sync & Control
- **Socket.IO + Redis**: Bidirectional communication with horizontal scaling support.
- **Kiosk Pairing**: Secure device locking using Redis. Ensures only the paired phone can control a specific Mirror.
- **Command Forwarding**: REST API triggers (`POST /api/remote/kiosks/command`) are instantly forwarded to the Mirror via Sockets.

### 4. AI Virtual Try-On
- **FASHN.AI Integration**: Image flow uses the `tryon-v1.6` model; image-to-video flow uses the model id from `FASHN_VIDEO_MODEL` env var (empty disables video endpoints).
- **Background Polling**: The backend manages AI generation state. Poll timeout is 2 min for image, 5 min for video.
- **Live Progress**: Socket events (`tryon_progress`, `tryon_completed`, `tryon_failed`) keep the Kiosk UI reactive during AI processing. Each payload now carries a `media: "image" | "video"` discriminator; completion payloads use `imageUrl` for image runs and `videoUrl` for video runs.
- **REST Status Polling**: `GET /try-on/:predictionId/status` works for both image and video predictions.
- **Garment Alignment**: Outfit composition is the **frontend's** job — the phone positions garments on a canvas, screenshots, uploads the composed image to S3, and the backend forwards the URL to FASHN.AI. Because the input is always a pre-composed full-body image, the `runByGarment`/`runVideoByGarment` endpoints hardcode FASHN's `category` to `one-pieces`.
- **Try-On by Garment ID**: `POST /try-on/garment` (image) and `POST /try-on/video/garment` (image-to-video) let the client trigger a run using a stored `Garment.id` instead of raw URLs.
- **Try-On by Outfit ID**: `POST /try-on/outfit` and `POST /try-on/video/outfit` accept a stored `Outfit.id`.
- **Model Image Management**: Dedicated endpoints for the user's body photo (`/try-on/model/*`) — multipart upload through the API (multer-s3) that creates a `File` row and attaches it as `User.avatar`, plus a GET endpoint that returns a fresh presigned-read URL.

### 5. Conversational & Vision AI (LLMs)
- **OpenAI GPT-4o (Vision)**: Used to classify garment images against our Prisma enums (`GARMENT_TYPES`, `FITTING_SLOT`, `CATEGORY`, `GARMENT_GENDER`, `LAYER_LEVEL`, `SILHOUETTE`). The endpoint `POST /garments/evaluate` accepts a single image, sends it to GPT-4o with the enum vocabulary baked into the prompt, validates the response with Joi against those same enums, then persists a `Garment` tied to the authenticated user.
- **Chat Wonder (4-Persona System)**: Custom AI lifestyle engine. Utilizes a 4-persona architecture (System, Fashion, Cosmetics, Maps) to provide highly specialized advice across different domains.
- **Context-Aware Prompt Injection**: Before querying ChatWonder, the backend automatically injects the user's specific real-time context (their saved Garments, Outfits, current WeatherSnapshot, and Cosmetic Recommendations). This grounds the AI in reality so it recommends items the user actually owns.
- **OpenBeautyFacts Data Ingestion**: A robust ingestion pipeline (`src/scripts/import-openbeautyfacts.ts`) extracts raw crowdsourced product JSON, applies strict taxonomy mapping, parses SPF/finish/ingredients, and upserts thousands of real-world items into our `CosmeticProduct` database.

---

## 📡 API Endpoint Map

All endpoints are prefixed with `/api`.

### Remote (Mobile)
- `POST /api/remote/auth/login`: Login/Register.
- `GET /api/remote/users/me`: Get profile.
- `POST /api/remote/kiosks/notify-scanning`: [Anonymous] Notify Kiosk of a successful scan.
- `POST /api/remote/kiosks/clear-all`: [Anonymous] Reset all kiosk states and disconnect everyone.
- `POST /api/remote/kiosks/connect`: Pair phone to mirror.
- `POST /api/remote/kiosks/disconnect`: Unpair.
- `POST /api/remote/kiosks/command`: Send remote action (Capture, Toggle UI, etc).

### Garments (Shared)
- `GET /api/remote/garments`: List garments (paginated, filterable by enum fields).
- `GET /api/remote/garments/:id`: Fetch a single garment.
- `POST /api/remote/garments`: Manually create a garment.
- `POST /api/remote/garments/evaluate`: **[Auth + image]** Single-image AI evaluation. GPT-4o classifies the garment against our Prisma enums, Joi validates the AI output, and the result is persisted as a `Garment` owned by the caller.
- `PATCH /api/remote/garments/:id`: Update.
- `DELETE /api/remote/garments/:id`: Delete.

### Try-On (Mirror + Remote — same routes mounted at both prefixes)
- `POST /api/mirror/try-on/run`: Legacy raw-URL try-on (`modelImage`, `garmentImage`, `category`, `kioskId`). Kiosk websocket polling.
- `POST /api/mirror/try-on/garment`: **[Auth]** Image try-on using a stored `Garment.id` + user-supplied `modelImage`. Category is always `one-pieces` (composite-outfit strategy). Optional `kioskId` enables websocket updates.
- `POST /api/mirror/try-on/outfit`: **[Auth]** Image try-on using a stored `Outfit.id`.
- `POST /api/mirror/try-on/video/garment`: **[Auth]** Image-to-video try-on using a stored `Garment.id`. Returns 503 if `FASHN_VIDEO_MODEL` is unset.
- `POST /api/mirror/try-on/video/outfit`: **[Auth]** Image-to-video try-on using a stored `Outfit.id`.
- `GET /api/mirror/try-on/:predictionId/status`: REST polling alternative to the kiosk websocket flow. Works for both image and video predictions.
- `POST /api/mirror/try-on/model`: **[Auth]** Multipart upload of the user's model photo. Creates a `File` row and attaches it as `User.avatar`; the previous avatar's File row and S3 object are deleted.
- `GET /api/mirror/try-on/model`: **[Auth]** Return the user's current model image with a fresh presigned GET URL.

### Files
- `POST /api/remote/file-uploads/upload`: Single-file direct upload (with Sharp processing).
- `POST /api/remote/file-uploads/upload-many`: Multi-file direct upload.
- `GET /api/remote/file-uploads/presign`: Generic S3 presigned PUT.
- `POST /api/remote/file-uploads/confirm`: Generic file-record save after upload.

---

## 🔄 The Flow

1.  **Connection**: Mirror connects to Socket.IO and joins a room named after its `kioskId`.
2.  **Pairing**: User scans QR on the Mirror -> Phone sends `notify-scanning` request (Kiosk shows "Please sign in") -> Phone sends `connect` request -> Backend locks `kioskId` to `userId` in Redis.
3.  **Control**: Phone sends `command` -> Backend checks Redis lock -> Backend emits event to Mirror's Socket room.
4.  **Garment Capture (AI)**: User uploads a garment image -> Backend pushes it to GPT-4o vision with our enum vocabulary -> Joi enforces the AI's response against the enums -> Garment row persisted, tied to the user.
5.  **Model Image Setup**: Phone uploads model photo via multipart `POST /try-on/model` -> Backend (multer-s3) streams it to S3 -> File row created, attached as `User.avatar`, prior avatar deleted.
6.  **Try-On**: Phone composes the outfit on its canvas -> uploads composed image to S3 -> Phone calls either `tryon/run` (raw URLs) or `tryon/garment` (by Garment.id) -> Backend forwards to FASHN.AI with `category: "one-pieces"` -> Backend polls status -> Backend pushes final Image URL to Mirror via Sockets, while mobile clients can also poll `GET /try-on/:id/status` directly.

---

## 🔐 Security & State
- **Redis Locking**: Kiosks are protected by a state-lock in Redis. This prevents multiple phones from controlling the same mirror simultaneously.
- **JWT Authentication**: All sensitive endpoints require a valid token. The user's identity is verified before any command is forwarded to a kiosk.
- **Auto-Cleanup**: When a Mirror's socket disconnects, the system automatically releases the Redis lock, preventing "zombie" states.
- **Bounded TTL**: `kiosk_state:*` and `socket_to_kiosk:*` keys carry a 24-hour TTL refreshed on every `register_kiosk`, so a crashed process or network partition self-heals instead of leaking locks forever.
- **Kiosk Device Secret**: `register_kiosk` requires `KIOSK_DEVICE_SECRET` — unverified sockets are rejected before they can join a kiosk room.
- **Idle Auto-Logout (kiosk frontend)**: After 5 min of UI inactivity on the kiosk display, the kiosk calls `POST /api/remote/kiosks/disconnect` (releasing the Redis lock) and clears its local auth tokens. The manual logout button uses the same code path.

## 📈 Scalability
- **Redis Socket Adapter**: The WebSocket server is stateless. You can run multiple instances of the API, and events will correctly propagate between nodes via Redis.
- **Offloaded Processing**: By using S3 Presigned URLs, the API does not handle image data streams, allowing it to handle many more concurrent users.

## ⚙️ Environment Variables (Important)
Ensure the following are set in your `.env`:
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`: Redis connection details.
- `AWS_REGION`/`AWS_S3_BUCKET_NAME`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`: For image/video storage.
- `FASHN_API_KEY`/`FASHN_BASE_URL`: For the AI Try-On engine.
- `FASHN_VIDEO_MODEL`: FASHN model id for image-to-video try-on. Leave empty to disable the `/try-on/video/*` endpoints.
- `OPENAI_API_KEY`: For GPT-4o garment evaluation.
- `CHAT_WONDER_API_URL`: For the conversational AI service (text-only).
- `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET`: For JWT signing.
- `KIOSK_DEVICE_SECRET`: Shared secret kiosk devices must present when calling `register_kiosk` over the socket.
- `GOOGLE_CLIENT_ID`: For Google SSO auth.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js / TypeScript
- **Database**: PostgreSQL / Prisma
- **Real-time**: Socket.io + Redis Adapter
- **Cache/State**: Redis
- **Cloud**: AWS S3
- **AI**: FASHN.AI (virtual try-on), OpenAI GPT-4o (vision classification), Chat Wonder (conversational)
