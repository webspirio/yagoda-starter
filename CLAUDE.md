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
| `docker-compose.prod.yml` | Production stack (postgres, redis, backend, nginx) |
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

## Architecture

- **API:** frontend → nginx `location /api/` (prefix stripped via `proxy_pass` trailing slash) → backend on port 3000. In dev the frontend calls the backend directly (`VITE_API_URL`); there is no Nest global prefix.
- **Auth:** login + password. The backend verifies credentials and issues a JWT (HS256, 7 days, payload `{ sub }` and nothing else) that the frontend keeps in `localStorage`. `JwtStrategy.validate()` reloads the user row on every authenticated request, so deactivation, demotion and point reassignment take effect on that user's very next request — there is no refresh token, but there is real revocation. Two roles, `network_owner` and `point_operator`: `@Auth()` means "any authenticated user", `@Auth(UserRole.NetworkOwner)` means owner only. There is no public registration — `POST /auth/login` is the only public route; a `network_owner` creates accounts via `POST /users`.
- **Identity seam:** `user_identities(provider, provider_user_id)` is the single login lookup path. This starter writes `provider = 'local'`; adding an OAuth provider means writing a different value, with no schema change.
- **Domain:** the schema of record is `28-db-schema.dbml` (repo root). Implemented so far: `users`, `collection_points` (foundation slice), `products`, `product_grades`, `tare_types` (catalog slice), `suppliers`, `grade_prices` (this slice). Ten tables remain, all of them documents: `shifts`, `intakes`, `intake_items`, `intake_item_tare_types`, `payouts`, `crate_issuances`, `crate_returns`, `crate_return_allocations`, `cash_counts`, `transfers`. Specs live in `docs/superpowers/specs/`.
- **Data:** PostgreSQL via TypeORM — `synchronize: false`, migrations run automatically on startup.
- **Redis:** rate-limit counters only; no durable state.
- **Health:** `GET /health/live` (process) and `GET /health/ready` (DB + Redis); compose healthchecks gate on `/health/ready`.

## Deployment

`nginx/` is a pure internal reverse proxy between the frontend static assets and the backend API — it does not terminate TLS. In `docker-compose.prod.yml`, `nginx` listens only on `127.0.0.1:8080` (plain HTTP); it expects a host-level reverse proxy or load balancer that owns the public HTTPS listener and forwards to `127.0.0.1:8080`. That terminator must allow request bodies of at least ~12 MB (`client_max_body_size`; nginx defaults to 1 MB): the app accepts image uploads up to 10 MB, and a smaller limit returns 413 before the request ever reaches the app (see `docs/vps-tls-setup.md`).
