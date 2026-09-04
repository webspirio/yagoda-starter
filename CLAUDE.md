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
```

## ⚠️ Before you deploy this

**Passwords are stored in plain text.** `user_credentials.password` holds the raw string, and `CredentialsService` compares it directly. This is a deliberate placeholder, not a bug — see the comments on `backend/src/users/user-credentials.entity.ts`. Replace it with a real KDF before any deployment holding a password a human might reuse. Node's built-in `scrypt` needs no new dependency; the change touches `CredentialsService.set()`, `.verify()`, and one migration.

## Architecture

- **API:** frontend → nginx `location /api/` (prefix stripped via `proxy_pass` trailing slash) → backend on port 3000. In dev the frontend calls the backend directly (`VITE_API_URL`); there is no Nest global prefix.
- **Auth:** username + password. The backend verifies credentials and issues a JWT (HS256, 7 days) that the frontend keeps in `localStorage`. No refresh token, no roles — `@Auth()` means "any authenticated user".
- **Identity seam:** `user_identities(provider, provider_user_id)` is the single login lookup path. This starter writes `provider = 'local'`; adding an OAuth provider means writing a different value, with no schema change.
- **Data:** PostgreSQL via TypeORM — `synchronize: false`, migrations run automatically on startup.
- **Redis:** rate-limit counters only; no durable state.
- **Health:** `GET /health/live` (process) and `GET /health/ready` (DB + Redis); compose healthchecks gate on `/health/ready`.

## Deployment

`nginx/` is a pure internal reverse proxy between the frontend static assets and the backend API — it does not terminate TLS. In `docker-compose.prod.yml`, `nginx` listens only on `127.0.0.1:8080` (plain HTTP); it expects a host-level reverse proxy or load balancer that owns the public HTTPS listener and forwards to `127.0.0.1:8080`. That terminator must allow request bodies of at least ~12 MB (`client_max_body_size`; nginx defaults to 1 MB): the app accepts image uploads up to 10 MB, and a smaller limit returns 413 before the request ever reaches the app (see `docs/vps-tls-setup.md`).
