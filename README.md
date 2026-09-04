# Web Starter

A production-ready web application boilerplate: NestJS backend, React
frontend, PostgreSQL, Redis, Docker Compose for dev and prod, an nginx
reverse proxy, and CI. It exists to be forked and grown into a real product,
not to be a demo of everything a web app could have.

## What this is not

The starter is deliberately small in a few places so a consuming project
adds exactly what it needs, rather than ripping out what it doesn't:

- **No authorization / roles.** Every authenticated user is equal — `@Auth()`
  takes zero arguments. See "What to change first" below for how to add roles.
- **No refresh token.** One JWT, 7-day expiry, held in `localStorage`. When it
  expires, the user signs in again.
- **No token revocation.** `users.is_active` blocks new logins only —
  flipping it false does not invalidate a token already issued, since
  `JwtStrategy` never re-checks the database. An existing token keeps
  authenticating until it expires. Deleting a user has the same limit; see
  `scripts/reset-data.sh` for the operational consequences.
- **No email.** Registration takes a username and password; the username is
  never validated as an email address, and the app never sends mail.
- **No CD pipeline.** CI (build, lint, test) runs on every push to `main` and
  on every pull request (see `.github/workflows/ci.yml`); there
  is no automated deploy workflow. Build and push your own images, or deploy
  from source, using `docker-compose.prod.yml` as the target shape.

## Prerequisites

- Docker and Docker Compose (the entire dev stack runs in containers — no
  local Postgres, Redis, or Node install is required to get started).
- Node.js (see `.nvmrc` / `package.json#engines`) only if you want to run
  `npm` scripts (lint, test, build) outside Docker.

## Getting started

```bash
cp .env.example .env
```

Generate a real signing key for `JWT_SECRET` — the backend refuses to boot
below 32 characters:

```bash
openssl rand -hex 32
```

Paste the output over the `JWT_SECRET` placeholder in `.env`. Every other
value in `.env.example` already works for local development.

```bash
docker compose up
```

This builds and starts Postgres, Redis, the backend (`http://localhost:3000`),
and the frontend (`http://localhost:5173`). Migrations run automatically on
backend startup — there's nothing else to apply by hand. Once the backend is
healthy, open `http://localhost:5173`.

### Dev credentials

A dev-only migration (`SeedDevAdmin`) seeds one account on a fresh database:

```
username: admin
password: admin
```

It is guarded on `NODE_ENV !== production` — it can never create this
known-credential account in a production deployment. Sign in with it, or
register your own account from `/register`.

## ⚠️ Passwords are stored in plain text

This is the single most important thing to know before you deploy this
starter anywhere real.

`user_credentials.password` holds the raw password string, and
`CredentialsService.verify()` compares it with `===`. There is no hashing, no
salt, no key-derivation function.

**This is a deliberate, recorded decision for this starter's first consumer
project — not a bug, and not an oversight.** It is called out here, in
`CLAUDE.md`, and directly on `UserCredentials` and `CredentialsService` in
the source, so nobody mistakes it for one.

**It must be replaced before any deployment holding a password a human might
reuse elsewhere.** The swap is small and needs no new dependency — Node ships
`scrypt` in `node:crypto`:

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);

// set(): derive and store a salted hash instead of the raw password
const salt = randomBytes(16).toString('hex');
const key = (await scrypt(password, salt, 64)) as Buffer;
// store `${salt}:${key.toString('hex')}`

// verify(): split the stored value on ':', re-derive with the same salt,
// compare with timingSafeEqual (never `===`, which leaks timing information)
```

The whole change touches exactly two functions —
`backend/src/users/credentials.service.ts`'s `set()` and `verify()` — plus one
migration to widen/rename the `user_credentials.password` column if you want
the column name to reflect what it now holds. Nothing else in the codebase
reads or writes a password; `CredentialsService` is documented as the only
place that does.

## Project layout

| Path | Purpose |
|------|---------|
| `backend/` | NestJS API — see `backend/CLAUDE.md` |
| `frontend/` | React SPA — see `frontend/CLAUDE.md` |
| `nginx/` | Production reverse proxy (nginx config + Dockerfile) |
| `docs/` | Operational runbooks (backup/restore, VPS TLS setup) |
| `docker-compose.yml` | Local dev stack (postgres, redis, backend, frontend) |
| `docker-compose.prod.yml` | Production stack (postgres, redis, backend, nginx) |
| `.env.example` | Template for `.env` — copy it, never commit the real file |

## Commands

```bash
docker compose up          # start the full dev stack
docker compose up -d       # ...detached
docker compose logs -f     # stream logs
docker compose down -v     # stop and wipe dev volumes (DB, uploads, redis)

npm test                   # both workspaces (backend Jest + frontend Vitest)
npm run lint                # both workspaces
npm run build                # both workspaces
```

Per-service commands (hot-reload dev server without Docker, DB-backed test
suite, migration CLI) are documented in `backend/CLAUDE.md` and
`frontend/CLAUDE.md`.

## Migrations

Migrations run automatically on backend startup (`migrationsRun: true`) —
this is safe as long as the backend runs as a single replica, which is what
both compose stacks do. Schema changes follow the usual TypeORM workflow:

```bash
# from backend/, with the dev stack's Postgres reachable
npm run migration:generate -- src/migrations/DescribingYourChange
# review the generated file, then just start the app — it applies automatically
npm run dev
```

See `backend/CLAUDE.md`'s "Migrations" section for the full workflow,
including the production build variant and the multi-replica caveat.

## What to change first

This starter ships four seams specifically so a consuming project doesn't
have to fight the existing code to extend it:

1. **Add a login provider.** `user_identities(provider, provider_user_id)` is
   the single login lookup path (`UNIQUE`). This starter writes exactly one
   provider, `'local'`. Adding Google/GitHub/etc. OAuth means writing a
   different `provider` value at registration time — no schema change.
2. **Add a `MediaPurpose`.** `backend/src/media/media.constants.ts` ships one
   purpose, `Avatar`. Adding another (a cover photo, a document, …) means
   adding a member to that enum, a subdirectory under `UPLOADS_DIR`, and an
   `ALTER TYPE` migration for the `media_purpose` Postgres enum.
3. **Extend `AUDIT_ACTIONS`.** `backend/src/audit/audit-log.entity.ts`'s
   `AUDIT_ACTIONS` is a TypeScript string union stored as `varchar`, not a DB
   enum — add a new action string and start calling `AuditService.record()`
   with it; no migration required.
4. **Add roles back via `@Auth()`.** `backend/src/auth/decorators/auth.decorators.ts`
   ships `@Auth()` with zero arguments — every authenticated user is equal.
   Reintroducing authorization means adding a role column/table, a
   `RolesGuard`, and an optional argument to `@Auth()` (e.g.
   `@Auth('admin')`) that composes it in — the same shape NestJS's own guard
   composition supports, just not pre-built here.

## Operational runbooks

- [`docs/backup-restore.md`](docs/backup-restore.md) — nightly Postgres
  backups, off-box copies, and the restore procedure.
- [`docs/vps-tls-setup.md`](docs/vps-tls-setup.md) — host nginx + Certbot in
  front of the bundled internal reverse proxy.
