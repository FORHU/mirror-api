# mirror-api

Backend API for the **Mirror** project. A Node.js + TypeScript service built on Express, Prisma (PostgreSQL), and Redis. It provides authentication (email/password with JWT access + refresh tokens), user endpoints, and file upload handling, organized in a clean Service–Repository–Controller layout.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Request Lifecycle](#request-lifecycle)
5. [Getting Started (From Scratch)](#getting-started-from-scratch)
6. [Environment Variables](#environment-variables)
7. [Database & Prisma](#database--prisma)
8. [Running with Docker](#running-with-docker)
9. [API Reference](#api-reference)
10. [Adding a New Resource](#adding-a-new-resource)
11. [Conventions](#conventions)
12. [Scripts](#scripts)

---

## Architecture

`mirror-api` follows a layered **Service–Repository–Controller (SRC)** pattern. Each layer has a single responsibility, which keeps business logic isolated from transport (HTTP) and persistence (Prisma) concerns.

```
            ┌────────────────────────────────────────────┐
HTTP ─────► │  Routes  ─►  Middleware  ─►  Controllers   │
            │                                  │         │
            │                                  ▼         │
            │                              Services      │  ◄── business logic
            │                                  │         │
            │                                  ▼         │
            │                            Repositories    │  ◄── DB access only
            │                                  │         │
            └──────────────────────────────────┼─────────┘
                                               ▼
                                       Prisma  +  Redis
                                          │        │
                                          ▼        ▼
                                       Postgres   Cache
```

- **Routes** ([src/routes/](src/routes/)) — bind URL paths to controller methods and apply route-level middleware.
- **Middleware** ([src/middleware/](src/middleware/)) — cross-cutting concerns: JWT auth, multipart uploads, centralized error handling.
- **Controllers** ([src/controllers/](src/controllers/)) — parse + validate input (Joi), call services, serialize responses. No business logic.
- **Services** ([src/services/](src/services/)) — business rules, orchestration, password hashing, token signing, cache invalidation.
- **Repositories** ([src/repositories/](src/repositories/)) — the **only** place that touches Prisma. Returns plain data.
- **Utils** ([src/utils/](src/utils/)) — Prisma client, Redis client, cache helpers, Winston logger.

The bootstrap chain is: [src/server.ts](src/server.ts) → [src/app.ts](src/app.ts) → [src/setup.ts](src/setup.ts) (initializes Redis) → routes.

---

## Tech Stack

| Concern        | Library                                    |
|----------------|--------------------------------------------|
| Runtime        | Node.js 18+ / 20 (Docker image)            |
| Language       | TypeScript 5                               |
| HTTP framework | Express 4                                  |
| ORM            | Prisma 6 (PostgreSQL 15)                   |
| Cache          | Redis 7                                    |
| Auth           | `jsonwebtoken` (access + refresh)          |
| Password hash  | Node `crypto.pbkdf2` (sha512, salt:hash)   |
| Validation     | Joi                                        |
| Uploads        | Multer (memory storage, 20 MB limit)       |
| Security       | Helmet, CORS, `express-rate-limit`         |
| Logging        | Winston                                    |
| Dev tools      | ts-node, nodemon, ESLint, Prettier         |

---

## Project Structure

```
mirror-api/
├── prisma/
│   ├── schema.prisma         # User, Session, SessionSocialAccount, File
│   ├── seed.ts               # Seed entry point
│   └── seeders/              # Modular seeders
├── src/
│   ├── server.ts             # HTTP listener
│   ├── app.ts                # Express app, middleware chain
│   ├── setup.ts              # Async startup (Redis connect)
│   ├── config.ts             # Env-derived constants
│   ├── routes/               # Route definitions, mounted under /api/v1
│   ├── controllers/          # Request handlers (Joi validation)
│   ├── services/             # Business logic
│   ├── repositories/         # Prisma queries
│   ├── middleware/           # auth, upload, error
│   └── utils/                # prisma, redis.util, cache.util, logger
├── Dockerfile                # Multi-stage Node 20 image
├── docker-compose.yml        # api + postgres + redis
└── .env.example
```

---

## Request Lifecycle

A request to `POST /api/v1/auth/login` flows like this:

1. **Express app** ([src/app.ts](src/app.ts)) — CORS → JSON body parser → Helmet → rate limiter (prod only) → router.
2. **Router** ([src/routes/auth.route.ts](src/routes/auth.route.ts)) — matches `POST /login`, dispatches to `AuthController.login`.
3. **Controller** ([src/controllers/auth.controller.ts](src/controllers/auth.controller.ts)) — validates body with Joi; on success calls `AuthSvc.login(value)`.
4. **Service** ([src/services/auth.service.ts](src/services/auth.service.ts)) — looks up user via repo, verifies PBKDF2 password, signs JWTs, persists session, caches user in Redis.
5. **Repository** ([src/repositories/auth.repository.ts](src/repositories/auth.repository.ts)) — Prisma reads/writes for `User` and `Session`.
6. **Response** — controller returns `{ message, data: { accessToken, refreshToken, user } }`.
7. **Errors** — anything `throw`n is caught by `next(error)` and rendered by [src/middleware/error.middleware.ts](src/middleware/error.middleware.ts).

Authenticated routes additionally pass through [authenticate](src/middleware/auth.middleware.ts), which verifies the bearer token, loads the user via `AuthRepo.findUserById`, and attaches it to `req.user`.

---

## Getting Started (From Scratch)

### Prerequisites

- Node.js **18+** (20 recommended)
- Docker + Docker Compose (easiest path for Postgres + Redis)
- Or: a local PostgreSQL 15 instance and Redis 7 instance

### 1. Clone and install

```bash
git clone <repo-url> mirror-api
cd mirror-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum `DATABASE_URL` and `JWT_SECRET`. See [Environment Variables](#environment-variables).

### 3. Start dependencies

Easiest — bring up Postgres and Redis with Docker:

```bash
docker-compose up -d db redis
```

Or point `DATABASE_URL` / `REDIS_HOST` at your own instances.

### 4. Generate client and run migrations

```bash
npm run db:setup
```

This runs `prisma generate` and `prisma migrate dev`, creating the `User`, `Session`, `SessionSocialAccount`, and `File` tables.

### 5. (Optional) Seed sample data

```bash
npm run db:seed
```

### 6. Start the dev server

```bash
npm run dev
```

The API listens on `http://localhost:3002` (override with `PORT`). Hit the health endpoint to verify:

```bash
curl http://localhost:3002/api/v1
# { "message": "Welcome to node-postg-template API" }
```

### 7. Try the auth flow

```bash
# Register
curl -X POST http://localhost:3002/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.com","password":"secret123","username":"alice"}'

# Login
curl -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.com","password":"secret123"}'

# Authenticated request
curl http://localhost:3002/api/v1/users/me \
  -H "Authorization: Bearer <accessToken>"
```

---

## Environment Variables

Defined in [src/config.ts](src/config.ts).

| Variable             | Default                  | Purpose                                    |
|----------------------|--------------------------|--------------------------------------------|
| `PORT`               | `3002`                   | HTTP port                                  |
| `NODE_ENV`           | `development`            | `development` disables rate limiter        |
| `DATABASE_URL`       | —                        | Postgres connection string (required)      |
| `JWT_SECRET`         | `access-secret`          | Access token signing secret (set this!)    |
| `JWT_REFRESH_SECRET` | `refresh-secret`         | Refresh token signing secret (set this!)   |
| `JWT_EXPIRY`         | `1d`                     | Access token TTL                           |
| `LOG_LEVEL`          | `debug`                  | Winston log level                          |
| `REDIS_HOST`         | `localhost`              | Redis hostname                             |
| `REDIS_PORT`         | `6379`                   | Redis port                                 |
| `REDIS_PASSWORD`     | _(empty)_                | Redis password if required                 |
| `REDIS_TTL_SECONDS`  | `3600`                   | Default cache TTL                          |

Refresh tokens always live `7d` (hard-coded in [src/config.ts](src/config.ts)).

---

## Database & Prisma

Schema: [prisma/schema.prisma](prisma/schema.prisma)

- **User** — email/username (unique), optional password (null for social-only accounts), role enum (`USER | ADMIN | SUPER_ADMIN | DEVELOPER`), soft-delete via `isDeleted`, optional avatar pointer to `File`.
- **Session** — refresh token rows with `expiresAt`; one user → many sessions.
- **SessionSocialAccount** — placeholder for OAuth providers (unique `[userId, platform]`).
- **File** — uploaded asset metadata (referenced by `User.avatarId`).

Common Prisma commands:

```bash
npx prisma migrate dev --name <change>   # create + apply migration in dev
npx prisma migrate deploy                # apply migrations in prod/CI
npx prisma generate                      # regenerate the client
npx prisma studio                        # web UI to browse data
```

---

## Running with Docker

The full stack (api + postgres + redis):

```bash
docker-compose up --build
```

The compose file ([docker-compose.yml](docker-compose.yml)) overrides `DATABASE_URL` and `REDIS_HOST` so the API container resolves `db` and `redis` by service name. Postgres and Redis state persists in named volumes (`postgres_data`, `redis_data`).

The Dockerfile ([Dockerfile](Dockerfile)) is multi-stage: builder runs `npm install` + `npm run build`, runtime image runs `npm run start` against `dist/`.

> Note: `Dockerfile` exposes `3000` while the app listens on `PORT` (default `3002`). The compose file maps `3002:3002` correctly. If you run the image standalone, publish the port your app actually listens on.

---

## API Reference

All routes are mounted under `/api/v1`. See [src/routes/index.ts](src/routes/index.ts).

### Health
- `GET /api/v1` — welcome payload.

### Auth — [src/routes/auth.route.ts](src/routes/auth.route.ts)
| Method | Path                      | Auth | Body                                                |
|--------|---------------------------|------|-----------------------------------------------------|
| POST   | `/auth/register`          | —    | `{ email, password, username, name? }`              |
| POST   | `/auth/login`             | —    | `{ email, password }`                               |
| POST   | `/auth/refresh-token`     | —    | `{ refreshToken }`                                  |
| POST   | `/auth/logout`            | ✔    | `{ refreshToken? }`                                 |

Successful register/login returns `{ accessToken, refreshToken, user }`. Pass the access token as `Authorization: Bearer <token>`.

### Users — [src/routes/user.route.ts](src/routes/user.route.ts)
| Method | Path          | Auth | Notes                              |
|--------|---------------|------|------------------------------------|
| GET    | `/users/me`   | ✔    | Returns the authenticated user     |
| GET    | `/users`      | —    | List users (controller-defined)    |

### File uploads — [src/routes/fileUpload.route.ts](src/routes/fileUpload.route.ts)
| Method | Path                    | Body                  | Limits                                      |
|--------|-------------------------|-----------------------|---------------------------------------------|
| POST   | `/file-uploads/upload`  | `multipart/form-data` field `file` | 20 MB max, allowlist of image/video/audio/json mimetypes ([upload.middleware.ts](src/middleware/upload.middleware.ts)) |

Files are kept in memory by Multer; persisting them to S3/disk is left to the caller.

---

## Adding a New Resource

To add a new resource (e.g., `posts`):

1. **Schema** — add the model in [prisma/schema.prisma](prisma/schema.prisma), then `npx prisma migrate dev --name add_post`.
2. **Repository** — `src/repositories/post.repository.ts` with static methods that wrap Prisma queries.
3. **Service** — `src/services/post.service.ts` with business logic; call the repo, never Prisma directly.
4. **Controller** — `src/controllers/post.controller.ts`; validate with Joi, call the service, return JSON.
5. **Route** — `src/routes/post.route.ts`; bind handlers, attach `authenticate` where needed.
6. **Mount** — register the route in [src/routes/index.ts](src/routes/index.ts):
   ```ts
   import postRoute from './post.route';
   router.use('/v1/posts', postRoute);
   ```

Cache reads via `CacheUtil.get/set` ([src/utils/cache.util.ts](src/utils/cache.util.ts)) and invalidate on writes with `CacheUtil.del` / `delByPattern`.

---

## Conventions

- **Errors** — services throw `{ status, message }` shapes; the error middleware translates them into the response.
- **Validation** — controllers validate input with Joi before calling services.
- **Soft delete** — `User.isDeleted` is checked in every read; honor this in new repo queries.
- **JWT** — access token in `Authorization: Bearer …`; refresh token in request body for `/refresh-token` and `/logout`.
- **Caching** — keys follow `user:<id>` style; use `REDIS_TTL_SECONDS` unless a different TTL is justified.

---

## Scripts

| Script              | What it does                                          |
|---------------------|-------------------------------------------------------|
| `npm run dev`       | Start with nodemon + ts-node                          |
| `npm run build`     | Type-check and emit JS to `dist/`                     |
| `npm run start`     | Run the compiled server                               |
| `npm run lint`      | ESLint with autofix                                   |
| `npm run db:setup`  | `prisma generate` + `prisma migrate dev`              |
| `npm run db:seed`   | Run [prisma/seed.ts](prisma/seed.ts)                  |

---

## License

MIT — see [LICENSE](LICENSE).
