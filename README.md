# Web Starter

A production-ready web application boilerplate: NestJS backend, React
frontend, PostgreSQL, Redis, Docker Compose for dev and prod, an nginx
reverse proxy, and CI. It exists to be forked and grown into a real product,
not to be a demo of everything a web app could have.

## What this is not

The starter is deliberately small in a few places so a consuming project
adds exactly what it needs, rather than ripping out what it doesn't:

- **No refresh token.** One JWT, 7-day expiry, held in `localStorage`. When it
  expires, the user signs in again.
- **No public registration.** `POST /auth/login` is the only public auth
  route. A `network_owner` creates every other account via `POST /users`
  (the `user-admin` module) — there is no self-service sign-up.
- **No email.** Login is a username/login and password; it is never validated
  as an email address, and the app never sends mail.
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
known-credential account in a production deployment. Sign in with it; there
is no self-service registration, so every other account is created by an
owner over `POST /users` once one is signed in.

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

This starter ships three seams specifically so a consuming project doesn't
have to fight the existing code to extend it:

1. **Add a login provider.** `user_identities(provider, provider_user_id)` is
   the single login lookup path (`UNIQUE`, plus an index on `user_id` for the
   per-request auth lookup). This starter writes exactly one provider,
   `'local'`. Adding Google/GitHub/etc. OAuth means writing a different
   `provider` value at account-creation time — no schema change.
2. **Add a `MediaPurpose`.** `backend/src/media/media.constants.ts` ships one
   purpose, `Avatar`. Adding another (a cover photo, a document, …) means
   adding a member to that enum, a subdirectory under `UPLOADS_DIR`, and an
   `ALTER TYPE` migration for the `media_purpose` Postgres enum.
3. **Extend `AUDIT_ACTIONS`.** `backend/src/audit/audit-log.entity.ts`'s
   `AUDIT_ACTIONS` is a TypeScript string union stored as `varchar`, not a DB
   enum — add a new action string and start calling `AuditService.record()`
   with it; no migration required.

Roles (`network_owner` / `point_operator`) and route-level authorization
(`@Auth(...roles)`) already exist — see `backend/CLAUDE.md`'s "Route
protection" entry rather than adding them again.

## Deployment

Before the **first** production boot of a fresh database, set four
environment variables so the network has an owner able to sign in at all
(public registration doesn't exist — see "What this is not" above):

- `BOOTSTRAP_OWNER_LOGIN`, `BOOTSTRAP_OWNER_PASSWORD` (required to create the
  account) and optionally `BOOTSTRAP_OWNER_FIRST_NAME`,
  `BOOTSTRAP_OWNER_LAST_NAME`.

Optionally set `PASSWORD_VAULT_KEY` (`openssl rand -base64 32`) as well. It
turns on the owner-only, audited `GET /users/:id/password`, which is what puts
the eye beside each row on «Користувачі»: alongside the scrypt hash the app
then keeps an AES-256-GCM copy of every password it issues, decryptable only
with that key. Leaving it unset is the safer default and the login path is
identical either way — see `backend/src/users/secret-box.ts` for the trade.

They are read exactly once, by the `BootstrapOwner` migration, and only when
the `users` table is empty — harmless to leave set afterward, but pointless,
since the migration has already run and will not run again. Unset in
development, where `SeedDevAdmin` already seeds `admin`/`admin`. If a
production database is first booted **without** these set, the migration
still records itself as applied and no owner is ever created; recovery at
that point is a manual `INSERT`, not a re-run. See `backend/CLAUDE.md`'s
"Migrations" section and the migration's own doc comment.

## Operational runbooks

- [`docs/backup-restore.md`](docs/backup-restore.md) — nightly Postgres
  backups, off-box copies, and the restore procedure.
- [`docs/vps-tls-setup.md`](docs/vps-tls-setup.md) — host nginx + Certbot in
  front of the bundled internal reverse proxy.
