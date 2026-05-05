# Mirror API — Conventions

This document captures the conventions actually in use in `mirror-api/`. Treat it as the source of truth when adding new features or refactoring. If you need to deviate, update this file in the same PR.

---

## 1. Project Layout

```
mirror-api/
├── prisma/
│   ├── schema.prisma          # data model (PostgreSQL)
│   ├── migrations/            # generated migrations — never hand-edit
│   ├── seed.ts                # entrypoint for `db:seed`
│   └── seeders/               # one file per seeded entity (e.g. users.seeder.ts)
├── src/
│   ├── server.ts              # process entrypoint — loads env, starts listener
│   ├── app.ts                 # Express app — middleware + routes
│   ├── config.ts              # all env access lives here
│   ├── routes/                # Express routers, mounted under /api/v1
│   ├── controllers/           # HTTP layer: validate input, call service, shape response
│   ├── services/              # business logic — calls repositories, no Prisma here
│   ├── repositories/          # Prisma queries only — no business rules
│   ├── middleware/            # auth, error handler, multer upload
│   └── utils/                 # logger, redis, cache, prisma client
└── logs/                      # winston output (error.log, all.log) — gitignored
```

**Rule:** A controller never imports Prisma. A repository never imports another service or controller. Direction of dependency is `route → controller → service → repository → prisma`.

---

## 2. Naming

| Thing            | Convention             | Example                                        |
|------------------|------------------------|------------------------------------------------|
| Source files     | `entity.layer.ts`      | [auth.controller.ts](src/controllers/auth.controller.ts), [user.service.ts](src/services/user.service.ts) |
| Classes          | `PascalCase`           | `AuthController`, `UserService`, `CacheUtil`   |
| Methods          | `camelCase`, `static`  | `register()`, `findUserByEmail()`              |
| Route segments   | `kebab-case`           | `/api/v1/file-uploads`, `/refresh-token`       |
| DB models        | `PascalCase` singular  | `User`, `Session`, `File`                      |
| DB fields        | `camelCase`            | `avatarId`, `createdAt`, `isDeleted`           |
| Env vars         | `SCREAMING_SNAKE_CASE` | `JWT_SECRET`, `REDIS_HOST`                     |

Service classes may be suffixed `Svc` when the full word collides (e.g. `AuthSvc`). Prefer the full `Service` suffix for new code.

---

## 3. Layered Architecture — Reference Flow

User registration is the canonical example. New endpoints should mirror this shape.

1. **Route** — [src/routes/auth.route.ts](src/routes/auth.route.ts)
   ```ts
   router.post('/register', AuthController.register);
   ```
2. **Controller** — [src/controllers/auth.controller.ts](src/controllers/auth.controller.ts)
   - Define a Joi schema at the top of the file.
   - Validate `req.body`; on error return `400` directly.
   - Call the service with the validated `value`.
   - Wrap in `try/catch` and forward errors via `next(error)`.
3. **Service** — [src/services/auth.service.ts](src/services/auth.service.ts)
   - Orchestrates business logic (lookup → hash → create → token → cache).
   - Throws plain `{ status, message }` objects on failure.
4. **Repository** — [src/repositories/auth.repository.ts](src/repositories/auth.repository.ts)
   - Pure Prisma calls. No `try/catch`, no logging, no business decisions.

---

## 4. Error Handling

- **Throw shape:** `throw { status: 401, message: 'Invalid credentials' }` — a plain object with `status` + `message`. Don't use `new Error(...)` for HTTP errors.
- **Forward:** controllers catch and call `next(error)`.
- **Central handler:** [src/middleware/error.middleware.ts](src/middleware/error.middleware.ts) responds with:
  ```json
  { "status": "error", "statusCode": 500, "message": "...", "stack": "(dev only)" }
  ```
- Stack trace is included only when `NODE_ENV !== 'production'`.

---

## 5. Validation

- **Joi**, defined inline at the top of the controller file, one schema per endpoint.
- Validate `req.body` (or `req.query` / `req.params` as appropriate) and pass `value` — **not** the raw request — into the service.
- On validation error return `400` with `{ message: error.details[0].message }`.

```ts
const schema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  username: Joi.string().required(),
});
```

---

## 6. Auth

- **Tokens:** access token (1 day) + refresh token (7 days). Secrets in `config.ts`.
- **Header:** `Authorization: Bearer <token>`.
- **Middleware:** `authenticate` from [src/middleware/auth.middleware.ts](src/middleware/auth.middleware.ts) verifies the access token and attaches `req.user`.
- **Protected route:**
  ```ts
  router.get('/me', authenticate, UserController.getMe);
  ```
- **Sessions:** every login/register inserts a `Session` row (refresh + access token, expiry, platform). The refresh endpoint validates against this row.

---

## 7. Database (Prisma)

- Schema: [prisma/schema.prisma](prisma/schema.prisma) — PostgreSQL.
- Models in use: `User`, `Session`, `File`.
- **Soft deletes:** all read queries must filter `isDeleted: false`. There are no hard deletes.
- **Migrations:** generate with `npm run db:setup` (runs `prisma generate && prisma migrate dev`). Never edit files in `prisma/migrations/` by hand.
- **Seeding:** add a new file under `prisma/seeders/` and wire it into `prisma/seed.ts`.
- **Repositories** are the only place `prisma.*` is called.

---

## 8. Logging

- **Winston** configured in [src/utils/logger.ts](src/utils/logger.ts).
- Levels: `error`, `warn`, `info`, `http`, `debug`. Default is `debug` in dev, `info` in prod.
- Format: `YYYY-MM-DD HH:mm:ss:ms [level]: message`.
- Transports: console + `logs/error.log` (errors only) + `logs/all.log`.
- Use `logger.info(...)` / `logger.error(...)` — do not use `console.log`.

---

## 9. Config & Environment

- **All `process.env` access lives in [src/config.ts](src/config.ts).** Importing `process.env` from anywhere else is not allowed.
- Required: `PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`.
- Optional (with defaults): `JWT_EXPIRY` (`1d`), `REDIS_PASSWORD`, `REDIS_TTL_SECONDS` (`3600`).
- `isDev` is exported as a boolean — use it for environment branches, not `process.env.NODE_ENV` checks.

---

## 10. Response Shape

The codebase is currently inconsistent here. **For new endpoints, use:**

```json
{ "status": "success", "data": <payload>, "message": "<optional>" }
```

Errors always follow the central handler shape (`status: "error"`, `statusCode`, `message`). Do not invent new envelopes per route.

---

## 11. Async & Control Flow

- `async/await` everywhere. No `.then()` chains.
- Every controller method is wrapped in `try { ... } catch (err) { next(err); }`. There is no `asyncHandler` helper — match the existing pattern.
- Services may throw; they should not call `next` or touch `req`/`res`.

---

## 12. Lint & Format

- ESLint + Prettier are installed; `npm run lint` runs `eslint src/**/*.ts --fix`.
- TypeScript `strict` mode is on — keep it on. Don't add `// @ts-ignore` without a comment explaining why.
- Run `npm run lint` before opening a PR.

---

## 13. Cross-Cutting Concerns

- **Rate limiting:** `express-rate-limit`, 15 min window / 100 req per IP. Disabled when `isDev` is true.
- **Helmet:** enabled in [src/app.ts](src/app.ts). Don't disable headers without discussion.
- **CORS:** currently `*` with credentials. Tighten before production.
- **Redis cache:** wrap access through `CacheUtil` ([src/utils/cache.util.ts](src/utils/cache.util.ts)). Cache key convention: `entity:id` (e.g. `user:42`).
- **File uploads:** multer, memory storage, 20 MB limit, MIME whitelist. See [src/middleware/upload.middleware.ts](src/middleware/upload.middleware.ts).

---

## 14. Adding a New Resource — Checklist

1. Add the model to `prisma/schema.prisma` and run `npm run db:setup`.
2. Create `src/repositories/<entity>.repository.ts` with static Prisma methods.
3. Create `src/services/<entity>.service.ts` with the business logic.
4. Create `src/controllers/<entity>.controller.ts` with Joi schemas + handlers.
5. Create `src/routes/<entity>.route.ts` and mount it in `src/routes/index.ts` under `/api/v1/<entity>`.
6. Protect routes with `authenticate` where appropriate.
7. Use the `{ status, data, message }` response envelope.
8. Add a seeder under `prisma/seeders/` if the entity needs sample data.
9. `npm run lint` and verify the dev server starts cleanly.
