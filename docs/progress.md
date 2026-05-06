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
- **Command Forwarding**: REST API triggers (`POST /v1/mirror/kiosks/command`) are instantly forwarded to the Mirror via Sockets.

### 4. AI Virtual Try-On
- **FASHN.AI Integration**: Specialized service for `tryon-v1.6` model.
- **Background Polling**: The backend manages AI generation state.
- **Live Progress**: Socket events (`tryon_progress`, `tryon_completed`) keep the Kiosk UI reactive during AI processing.

### 5. Conversational AI (LLMs)
- **OpenAI (ChatGPT)**: Integrated for fashion advice and personal stylist responses.
- **Chat Wonder**: Custom AI integration for localized or specialized knowledge.

---

## 📡 API Endpoint Map

### Remote (Mobile)
- `POST /remote/auth/login`: Login/Register.
- `GET /remote/users/me`: Get profile.
- `POST /remote/kiosks/connect`: Pair phone to mirror.
- `POST /remote/kiosks/disconnect`: Unpair.
- `POST /remote/kiosks/command`: Send remote action (Capture, Toggle UI, etc).

### Mirror (Kiosk)
- `POST /mirror/try-on/run`: Initiate AI Virtual Try-On.
- `GET /mirror/file-uploads/presign`: Get S3 upload ticket.

---

## 🔄 The Flow

1.  **Connection**: Mirror connects to Socket.IO and joins a room named after its `kioskId`.
2.  **Pairing**: User scans QR on the Mirror -> Phone sends `connect` request -> Backend locks `kioskId` to `userId` in Redis.
3.  **Control**: Phone sends `command` -> Backend checks Redis lock -> Backend emits event to Mirror's Socket room.
4.  **Try-On**: Phone selects outfit -> Mirror triggers `try-on/run` -> Backend calls FASHN.AI -> Backend polls status -> Backend pushes final Image URL to Mirror via Sockets.

---

## 🔐 Security & State
- **Redis Locking**: Kiosks are protected by a state-lock in Redis. This prevents multiple phones from controlling the same mirror simultaneously.
- **JWT Authentication**: All sensitive endpoints require a valid token. The user's identity is verified before any command is forwarded to a kiosk.
- **Auto-Cleanup**: When a Mirror's socket disconnects, the system automatically releases the Redis lock, preventing "zombie" states.

## 📈 Scalability
- **Redis Socket Adapter**: The WebSocket server is stateless. You can run multiple instances of the API, and events will correctly propagate between nodes via Redis.
- **Offloaded Processing**: By using S3 Presigned URLs, the API does not handle image data streams, allowing it to handle many more concurrent users.

## ⚙️ Environment Variables (Important)
Ensure the following are set in your `.env`:
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_HOST`/`REDIS_PORT`: Redis connection details.
- `AWS_REGION`/`S3_BUCKET_NAME`: For image storage.
- `FASHN_API_KEY`/`FASHN_BASE_URL`: For the AI Try-On engine.
- `JWT_SECRET`: For secure authentication.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js / TypeScript
- **Database**: PostgreSQL / Prisma
- **Real-time**: Socket.io + Redis Adapter
- **Cache/State**: Redis
- **Cloud**: AWS S3
- **AI**: FASHN.AI
