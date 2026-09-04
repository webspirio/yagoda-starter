# backend/CLAUDE.md

NestJS REST API for Web Starter.

## Stack

- **NestJS** (Express platform) — modules, controllers, services, guards, pipes
- **TypeORM** + **PostgreSQL 16** — entities with migrations (`synchronize: false`; migrations run automatically on startup)
- **Redis 7** — rate-limit counter storage for `ThrottlerModule`
- **JWT** (passport-jwt) — authentication

## Commands

```bash
npm run dev     # start with hot-reload (port 3000)
npm test        # run Jest unit tests (*.spec.ts — no I/O, everything mocked)
npm run test:db # run DB-backed tests (*.db-spec.ts) against a real Postgres
npm run lint    # ESLint (flat config, eslint.config.mjs)
```

**`test:db` prerequisite** — create the throwaway database once:
`docker compose exec postgres createdb -U app app_test`. The suite connects with
the usual `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` but overrides the database
name with `TEST_DB_NAME` (default `app_test`); `src/testing/db-harness.ts` refuses
to start if that name equals `DB_NAME` or does not end in `_test`, because these
specs `TRUNCATE`. They run serially (`jest.db.config.js`, `maxWorkers: 1`) and
apply migrations on connect. They exist because they verify **Postgres semantics
that a mocked spec cannot reach** — constraints, unique indexes, cascade rules,
and whether a hand-written statement even parses. `npm test` never picks them
up: its `testRegex` (`.*\.spec\.ts$`) does not match `.db-spec.ts`.

## Structure

```
src/
  app.module.ts         # root module — TypeORM/logger/throttler config, imports all feature modules
  main.ts               # bootstrap: helmet, trust proxy, CORS allowlist, ValidationPipe, static /uploads, listen :PORT
  auth/                  # JWT strategy, /auth/register + /auth/login, @Auth() route-protection decorator
  users/                 # User, UserIdentity, UserCredentials entities; UsersService, CredentialsService (domain only — no controller)
  current-user/          # /me — read, update display name, avatar upload (the one controller that reads/writes User)
  audit/                 # append-only audit log (AUDIT_ACTIONS union + AuditService)
  media/                 # local-disk image storage — upload validation, image re-encoding, MediaFile entity
  common/                # cross-cutting: global exception filter, shared pagination DTOs (PaginationQueryDto, Paginated<T>)
  health/                # GET /health/live, GET /health/ready (terminus)
  redis/                 # global RedisModule — shared ioredis client (REDIS_CLIENT token)
  time/                   # TimeService — the one seam for timezone-aware time (APP_TIMEZONE)
  config/                 # typed, namespaced env config factories (app, database, auth, redis, timezone, uploads)
  migrations/             # InitialSchema + SeedDevAdmin (guarded off in production)
```

## Key conventions

- Every feature lives in its own NestJS module under `src/<feature>/`.
- Entities register themselves — `TypeOrmModule.forRootAsync` in `app.module.ts` uses `autoLoadEntities: true`, so any entity passed to a module's `TypeOrmModule.forFeature([...])` is picked up automatically; a new `<feature>.entity.ts` needs no central list. The CLI data source (`src/data-source.ts`, used by `migration:generate`/`run`/`revert`) discovers entities and migrations independently via `__dirname`-relative globs (`**/*.entity{.ts,.js}`), so it works unchanged from both `src/` (ts-node) and compiled `dist/` (the prod migration step — see "Migrations" below).
- **Strict TypeScript** — `"strict": true` in `tsconfig.json`, with `strictPropertyInitialization` off (entities and DTOs are populated by TypeORM/class-validator, not constructors). No `@ts-ignore`, no `as any`.
- **Route protection — `@Auth()` is the only blessed pattern.** `@Auth()` (any authenticated user), from `src/auth/decorators/auth.decorators.ts`, applies `AuthGuard('jwt')` via `applyDecorators`. It takes zero arguments on purpose — this starter ships no authorization, so every authenticated user is equal. Adding roles later means changing this one decorator plus a migration, not auditing every controller; see the root `README.md`'s "What to change first" section.
- **Pagination** — collection endpoints take `PaginationQueryDto` (`?page=&limit=`, `src/common/dto/pagination-query.dto.ts`, page ≥ 1, 1 ≤ limit ≤ 100) and return the `Paginated<T>` envelope (`{ data, total, page, limit }`, `src/common/dto/paginated.ts`). Copy this pair for every new list endpoint instead of an unpaginated `find()` — nothing in this starter uses it yet, but it's the intended shape for the first one that does.
- **Serialization boundary** — a global `ClassSerializerInterceptor` (wired in `main.ts`) runs on every response. Mark sensitive entity fields `@Exclude()` (class-transformer) — see `UserCredentials.password` and `UserIdentity.provider_data` — instead of hand-picking fields per controller; the exclusion then applies no matter which handler returns the entity.
- **Identity seam** — `user_identities(provider, provider_user_id)` (`UNIQUE`) is the single login lookup path (`UsersService.findByIdentity`). This starter writes exactly one provider, `'local'` (`LOCAL_PROVIDER` in `user-identity.entity.ts`); adding an OAuth provider means writing a different value there, with no schema change. `AuthService.register`/`login` are the reference callers.
- **Password storage is a deliberate placeholder — plain text.** `CredentialsService.set()`/`.verify()` (`src/users/credentials.service.ts`) are the *only* place a password is read or written; `UserCredentials.password` (`src/users/user-credentials.entity.ts`) holds the raw string. See the root `CLAUDE.md`'s "Before you deploy this" section before shipping this anywhere real.
- **Registration vs. login asymmetry is intentional.** `RegisterDto` enforces an 8-character minimum (`src/auth/dto/register.dto.ts`); `LoginDto` enforces none, only a DoS-guard max length (`src/auth/dto/login.dto.ts`). A length rule on login would lock out credentials that were valid when created, the first time anyone tightens the policy — tighten `RegisterDto` freely, never add a `@Length` to `LoginDto`.
- Environment variables are managed via `@nestjs/config` with typed namespaced factories in `src/config/`. Use `@Inject(xConfig.KEY)` with `ConfigType<typeof xConfig>` to access config in services. `PORT` (default 3000) sets the listen port; `JWT_SECRET` must be at least 32 characters (Joi-validated at startup, see `app.module.ts`). `DB_SSL` (default `false`) enables TLS on the Postgres connection for managed providers (Neon/RDS/Supabase/…); the bundled compose Postgres doesn't need it.
- **Media** — one purpose, `MediaPurpose.Avatar` (`src/media/media.constants.ts`), demonstrating the per-purpose directory pattern without importing a domain. Adding a purpose means adding a member to that enum, a subdirectory under `UPLOADS_DIR`, and an `ALTER TYPE` migration for the `media_purpose` Postgres enum. `MEDIA_MAX_BYTES` (10 MB) is the single source of truth for the size cap, enforced by each `FileInterceptor`'s `limits.fileSize` (413 before the buffer lands) and mirrored client-side for UX. Any reverse proxy in front of the app must allow at least ~12 MB request bodies, or an at-the-limit upload 413s before it ever reaches Nest.
- **Audit log** — append-only, no update/delete API, ever (`src/audit/audit-log.entity.ts`). `AUDIT_ACTIONS` is a TS string union stored as `varchar`, not a DB enum, so adding an action is a code change with no migration. `target_type`/`target_id` are polymorphic with no foreign key, which is what lets one log serve every table a consuming project adds — the price is that a `target_id` can outlive the row it names, so `before`/`after` should carry enough context to stay readable after the target is gone.
- **Deliberately deferred** — API versioning (no `/v1` prefix or header-based scheme), soft-delete (no `deleted_at` column), and authorization (no roles) aren't implemented; add them when a real requirement shows up rather than pre-building for a hypothetical one.
- **Frontend contract drift** — DTO shapes returned here (e.g. the `GET /me` response) are hand-mirrored on the frontend as plain TypeScript types (e.g. `CurrentUserProfile` in `frontend/src/entities/user`), not generated. Fine at the current API surface; if keeping them in sync by hand becomes error-prone as the API grows, consider a shared `packages/contracts` workspace (types, maybe zod schemas) both sides import instead.

## Security & observability

- **helmet** and an always-on CORS allowlist (the `APP_URL` origin, plus the Vite dev origin outside production) are applied in `main.ts`; `trust proxy` is set to `TRUST_PROXY_HOPS` for correct client-IP resolution behind nginx.
- **Health** — `GET /health/live` (process up, no dependency checks) and `GET /health/ready` (DB + Redis via terminus; 503 when either is down). Compose healthchecks hit `/health/ready`.
- **Rate limiting** — global `ThrottlerGuard`: 100 req/min per IP by default, Redis-backed storage so counters are shared across replicas and survive restarts.
- **Logging** — structured JSON via `nestjs-pino` (pretty-printed when `NODE_ENV=development`); `Authorization` headers are redacted and `/health*` requests are not access-logged. Each request gets a UUID `requestId`.
- **Errors** — the global `AllExceptionsFilter` (`src/common/filters/`) returns `{ statusCode, error, message, path, timestamp, requestId }`, plus an optional `reason` passed through from an `HttpException` response body when present; unknown errors are logged in full but respond with a generic 500. `reportError()` in that file is the single hook to wire up an error tracker (Sentry/Bugsnag/…) — it mirrors the frontend stub in `frontend/src/shared/lib/error-reporting`.
- **Static uploads** — `main.ts` serves `UPLOADS_DIR` under the `/uploads/` prefix with `Cross-Origin-Resource-Policy: cross-origin` (avatars are loaded via `<img>` from a different origin than the API in dev).

## Migrations

TypeORM migrations run automatically on startup (`migrationsRun: true`). `synchronize` is disabled in all environments. The CLI data source (`src/data-source.ts`) and the runtime config (`src/config/database.config.ts`) share one set of DB connection defaults via `src/config/database.defaults.ts`.

**Multi-replica caveat:** `migrationsRun: true` is safe today because the prod stack (`docker-compose.prod.yml`) runs exactly one backend replica and TypeORM's migration runner is idempotent — re-applying an already-applied migration on the next boot is a no-op. It stops being safe the moment more than one replica starts concurrently, since two containers could race to apply the same pending migration. This starter ships no CD pipeline, so there is no automated pre-flight migration step; before scaling the backend past one replica, remove `migrationsRun: true` from `app.module.ts` entirely and run migrations as an explicit, single, one-shot step before the new containers start.

**Workflow for schema changes:**

```bash
# 1. Make your entity changes in src/<feature>/<name>.entity.ts
# 2. Generate a migration (run from backend/):
npm run migration:generate -- src/migrations/DescribingYourChange

# 3. Review the generated file in src/migrations/ — confirm it only changes what you intended
# 4. Start the app — migration applies automatically:
npm run dev

# Other useful commands:
npm run migration:show    # list applied / pending migrations
npm run migration:revert  # roll back the last applied migration
npm run migration:run     # apply pending migrations without starting the full app
```

`npm run migration:run:prod -w backend` (`typeorm migration:run -d dist/data-source.js`) is the production variant — it targets the compiled `dist/data-source.js` instead of `src/data-source.ts`, so it needs `npm run build -w backend` first. Run this as the migration step before starting new containers in any deploy that doesn't run migrations another way.

Migration files are committed to git. Every developer gets the same schema after `git pull && npm run dev`.

**Note:** Migration generation requires a running Postgres instance. `docker-compose.yml` publishes Postgres on `0.0.0.0:5432`, so `DB_NAME=app_test npm run migration:generate -w backend -- src/migrations/YourChangeName` also works directly from the host once the dev stack is up. The container route below remains valid too — it's just no longer the only option (paths are relative to the image's `/app` = repo root):

```bash
# From repo root — ensure the dev stack is running first:
docker compose up -d postgres redis backend

# Generate (the backend service already has DB_* env and the app_net network):
docker compose exec backend \
  npm run migration:generate -w backend -- src/migrations/YourChangeName

# The dev compose mounts ./backend/src into the container, so the generated
# file appears in your working tree; review and commit it.
```
