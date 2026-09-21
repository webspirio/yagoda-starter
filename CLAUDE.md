# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Web Starter — a production-ready web application boilerplate with a NestJS backend, React frontend, PostgreSQL, and Redis.

## Collaboration workflow

`superpowers:using-superpowers` loads at session start and sets the baseline rule: **if there's any chance a skill applies, invoke it before acting** — before clarifying questions, before exploring code. This project layers a specific order on top:

1. **Plan first.** Start every non-trivial task with `/grilling` to stress-test the idea, then `superpowers:brainstorming` to shape requirements and design.
2. **Then implement** via `/superpowers` — `writing-plans` → `executing-plans` / `subagent-driven-development`, with `test-driven-development`, `systematic-debugging`, and `requesting-code-review` applied as you go.
3. **Process skills before implementation skills.** A planning or debugging skill sets the approach; the domain skills below carry it out.

## Skills

| When the task involves… | Invoke |
|---|---|
| Stress-testing a plan before building, or any "grill" phrasing | `grilling` |
| Any new feature, component, or behavior change — before writing code | `superpowers:brainstorming`, then the `superpowers:*` implementation skills |
| **Backend** (`backend/src`) — writing/reviewing/refactoring a Nest module | `nest-module-conventions` |
| **Backend** — NestJS architecture: DI, module boundaries, security, performance | `nestjs-best-practices` |
| **Frontend** (`frontend/src`) — where code belongs: FSD layers, slices, public APIs | `feature-sliced-design` |
| **Frontend** — adding, composing, styling, or debugging shadcn/ui components | `shadcn` (model-invoked automatically) |

## Repository structure

| Path | Purpose |
|------|---------|
| `backend/` | NestJS API — see `backend/CLAUDE.md` |
| `frontend/` | React SPA — see `frontend/CLAUDE.md` |
| `nginx/` | Production reverse proxy (nginx config + Dockerfile) |
| `docker-compose.yml` | Local dev stack (postgres, redis, backend, frontend) |
| `docker-compose.prod.yml` | Production/preview stack for Coolify (postgres, redis, backend, seed, nginx) — no host ports |
| `docker-compose.standalone.yml` | Override adding loopback ports for a VPS without Coolify |
| `.env` | Local secrets — not committed; copy from `.env.example` |

## Commands

```bash
docker compose up          # start full dev stack
docker compose logs -f     # stream logs
npm test                   # both workspaces
npm run lint
npm run build
npm run db:seed             # idempotent demo dataset for manual testing — see backend/CLAUDE.md «Dev seed»
```

## Verification

`npm run verify` is the gate a turn is checked against: the **fast tier**, which does not
build the app, start a container or touch a database. `npm run verify:full` adds the rows
that do. `npm run verify:ci` is `verify:full` with `--no-skip`, where a missing precondition
is a failure rather than a quietly narrower green.

**Everything else about using the layer is the `verify` skill** — which rows sit in which
tier, what each proves and stays blind to, the pre-push gate, the five row statuses, and the
rules for adding a row. Read `.claude/skills/verify/SKILL.md` (or invoke the skill) rather
than duplicating any of it here: this section loads into every session and the reference
does not need to. It carries no row list and no row count on purpose — the runner prints
both, and every copy of them has gone stale.

Three rules bind every turn, whether or not anyone opened the skill:

1. **Evidence under the claim.** Name the command you ran and paste its verdict line. What
   changed decides the tier, not habit. A change confined to application code needs
   `npm run verify`. A change whose proof lives in a production build, a browser, a real
   database, the npm registry or a coverage floor needs `npm run verify:full` — the fast
   tier cannot see any of them, and a migration or a lockfile edit is always that kind.
   **Money code is that kind too:** the arithmetic seam is `backend/src/common/money.ts`,
   the module list is the money `files` array in `backend/eslint.config.mjs`, and the SQL
   formulas behind both are exercised only against a real Postgres. Quote `coverage`'s own
   percentages if you quote anything — never a floor: the floors live in
   `.github/workflows/ci.yml`'s `COVERAGE_*` block and read zero locally, so a green local
   `coverage` is a measurement, never a verdict.

2. **Skips are spoken aloud.** "The fast tier is green; `smoke` was skipped, no daemon" —
   never "all green". A `SKIPPED` row is a row nobody ran, not a row that passed.

3. **Ratchets turn one way.** Widening a baseline, relaxing a rule, adding a suppression, or
   lowering a floor **is not turning green** — it is the cheapest available response to a
   red check, and it is exactly what this layer exists to catch. An exception is allowed
   only when it is listed individually, dated, carries a reason checked against the source,
   and cancels itself the moment the finding it excuses disappears.

## Architecture

- **API:** frontend → nginx `location /api/` (prefix stripped via `proxy_pass` trailing slash) → backend on port 3000. In dev the frontend calls the backend directly (`VITE_API_URL`); there is no Nest global prefix.
- **Auth:** login + password. The backend verifies credentials and issues a JWT (HS256, 7 days, payload `{ sub }` and nothing else) that the frontend keeps in `localStorage`. `JwtStrategy.validate()` reloads the user row on every authenticated request, so deactivation, demotion and point reassignment take effect on that user's very next request — there is no refresh token, but there is real revocation. Two roles, `network_owner` and `point_operator`: `@Auth()` means "any authenticated user", `@Auth(UserRole.NetworkOwner)` means owner only. There is no public registration — `POST /auth/login` is the only public route; a `network_owner` creates accounts via `POST /users`. Passwords are scrypt-hashed for verification and, when `PASSWORD_VAULT_KEY` is set, ALSO kept as an AES-256-GCM copy so the owner can read one back through the audited, owner-only `GET /users/:id/password` (issue #11) — `backend/src/users/secret-box.ts` states the trade; unset is the default and leaves passwords hashed only.
- **Identity seam:** `user_identities(provider, provider_user_id)` is the single login lookup path. This starter writes `provider = 'local'`; adding an OAuth provider means writing a different value, with no schema change.
- **Domain:** the schema of record is `28-db-schema.dbml` (repo root), and the business rules it cites live in `26-rules-by-example.md` (repo root, `§N` references throughout the code point there). **The original seventeen tables are now complete**: `users`, `collection_points` (foundation slice), `products`, `product_grades`, `tare_types` (catalog slice), `suppliers`, `grade_prices` (prices slice), `shifts`, `intakes`, `intake_items`, `intake_item_tare_types`, `payouts`, `transfers`, `cash_counts` (foundation slice), and `crate_issuances`, `crate_returns`, `crate_return_allocations` (crates slice, 2026-09-15 — spec `docs/superpowers/specs/2026-09-15-yagoda-crates-slice.md`, plan `docs/superpowers/plans/2026-09-15-yagoda-crates-slice.md`), plus `intake_top_ups` (#61 — the only table the DBML gained after its original seventeen, rather than one drawn from that original set), plus `reweighs`, `reweigh_items`, `reweigh_item_tare_types` and `day_expenses` (reweigh & cost-of-day slice, 2026-09-17 — spec `docs/superpowers/specs/2026-09-17-yagoda-reweigh-slice.md`, plan `docs/superpowers/plans/2026-09-17-yagoda-reweigh-slice.md`) — **twenty-two tables in all** (`grep -c "^Table " 28-db-schema.dbml`). Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, and open follow-ups in `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`.
- **Data:** PostgreSQL via TypeORM — `synchronize: false`, migrations run automatically on startup.
- **Documents:** `shifts` is one point's working day and the ONLY place `intakes` and `payouts` learn their point and business date — neither stores those columns, so scoping a query to a point is a JOIN. A document is never edited: §2.7 freezes `amount` and §9.3 makes a correction a void plus a new document, so there is no `PATCH` on either table. An operator may void only a document they recorded themselves and only while the shift is open (§9.4); the owner may void anything. Crates (`crate_issuances`, `crate_returns`) are a carve-out from that author check, per the client instruction of 2026-09-15: an operator may void ANY crate document at their own point while that shift is open — not just one they recorded themselves — and only a closed shift's crate document is owner-only. Opening and closing a shift is the operator's alone (§10.3); reopening is the owner's. A `reweigh_items` line is immutable and voided individually, same as every other document line here; its `reweighs` header carries no `void_*` columns and is never voidable, because voiding every line already reads as an empty day (§8.6's «Це не нуль»). `day_expenses` breaks the pattern on purpose — it is the schema's ONE mutable money table, `PATCH`/`DELETE` and all: §2.7's freeze protects a supplier's printed receipt, and nothing is printed for a scratchpad line like «пальне 1 000,00». The compensating control is an audit entry on every write that actually CHANGES something, inside the same transaction as the write: `create` and `delete` always record one, while `PATCH` records one only when a field really moved — a no-op PATCH still saves the row (bumping `updated_at`) and writes no audit entry, which is why `amount` is canonicalised at the DTO before `diffFields` ever compares it.
- **Money:** every arithmetic operation on a `numeric` value goes through `backend/src/common/money.ts` — strings in, strings out, half-up at 2 decimals, rounded per line then summed. An eslint rule bans `*`, `/`, `*=`, `/=`, `Number()`, `toFixed`, `parseInt` and `parseFloat` in the money modules — the list is `backend/eslint.config.mjs`'s money `files` array and nowhere else, and every module owning a money or weight `numeric` column is in it, which `registry.test.mjs` derives from `28-db-schema.dbml` and enforces rather than asks you to remember. `money.ts` gained `div` (scale-2 quotient, half-up) and `allocate` (largest-remainder split, so parts sum exactly to the total) for the reweigh & cost-of-day slice's §8.4 cost-per-kilogram and §8.5 top-up split. `decimal.js` is still not a RUNTIME dependency; it is a devDependency used as the independent oracle the property tests in `money.properties.spec.ts` check `money.ts` against.
- **Redis:** rate-limit counters only; no durable state.
- **Health:** `GET /health/live` (process) and `GET /health/ready` (DB + Redis); compose healthchecks gate on `/health/ready`.

## Deployment

Production and PR previews run on one Hetzner VPS under **Coolify**, which
pulls images CI built — it never builds. `.github/workflows/ci.yml` pushes
`ghcr.io/webspirio/yagoda-starter-{backend,nginx}:sha-<commit>` on every PR and
on `main`; `deploy-prod` (push to `main`) and `deploy-preview` (internal PR,
all CI jobs green) trigger Coolify through its API and then verify the
application (`/api/health/ready`, `/api/health/version`, a seeded login for
previews). `sha-<commit>` is the only tag ever deployed. Runbook, env tables
and failure modes: `docs/coolify-deploy.md`; design: `docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md`.

`docker-compose.prod.yml` is the single compose file (no `ports`, no custom
`networks` — Coolify's Traefik owns TLS and routing). Without Coolify, add
`docker-compose.standalone.yml` (loopback ports) and terminate TLS per
`docs/vps-tls-setup.md`. On that standalone path whatever terminates TLS must
allow request bodies of at least ~12 MB — nginx defaults to 1 MB and would
return 413 before the request reaches the app (`client_max_body_size`). Under
Coolify there is nothing to set: Traefik has no default body limit, and the
internal nginx already allows 12 MB against the app's 10 MB upload cap.
