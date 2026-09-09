# Coolify Deployment & CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merge to `main` deploys `https://yagoda.webspirio.com` through Coolify from images CI built; every green internal PR gets a seeded `https://pr-<N>.yagoda.webspirio.com`; the server has swap, a firewall and nightly atomic backups.

**Architecture:** GitHub Actions builds both images once per commit and pushes them to GHCR as `sha-<commit>`; Coolify (Docker Compose build pack, its own Traefik for TLS) only pulls and runs `docker-compose.prod.yml`, which becomes the single compose file for prod, previews and the no-Coolify exit path. Deploys are triggered by CI through the Coolify API *after* the push and are verified against the application itself (`/api/health/ready`, `/api/health/version`, a seeded login), never against Coolify's status alone. Server-side work is gated by a spike that confirms three properties of `SOURCE_COMMIT` (spec §3.1).

**Tech Stack:** NestJS 11 / TypeORM / Joi (backend), Docker Compose v2 (nested interpolation), GitHub Actions (`docker/build-push-action@v7`, GHCR), Coolify v4 API, bash + curl + jq, systemd timers, Hetzner Cloud Firewall.

**Spec:** `docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md`

## Global Constraints

- Deployment source of truth is `sha-<full 40-char commit>` only; `pr-<N>` is an alias never deployed; **no `latest` is pushed** (spec §1).
- One workflow file `.github/workflows/ci.yml` with `needs`; the only other workflow is the weekly `cleanup-images.yml` (spec §1).
- Preview deploys only after `checks`, `db-checks` and `docker` are all green (spec §1).
- `docker-compose.prod.yml` has **no** `networks:` and **no** `ports:`; `docker-compose.standalone.yml` adds the loopback ports back (spec §4.1–4.2).
- `mem_limit`: backend 384m, postgres 256m, redis 64m, nginx 64m, seed 256m; backend runs with `NODE_OPTIONS=--max-old-space-size=256`, seed with `--max-old-space-size=192` (spec §4.1).
- Hostnames: `yagoda.webspirio.com` (prod), `coolify.yagoda.webspirio.com` (panel), `pr-<N>.yagoda.webspirio.com` (previews) (spec §1).
- Preview cap: initial `6`, counted as open PRs labelled `preview`, under `concurrency: preview-allocation`; invariant ≥ 0.8–1.0 GiB free RAM (spec §1, §4.5).
- Every mutating command on the server (`root@188.245.146.122`) runs only after the owner's explicit go-ahead for that step (spec §5). Secrets never pass through the chat: the owner types them (Coolify UI, `! ssh …`).
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; work stays on branch `feat/coolify-deployment`.
- Money/ESLint rules of the repo are untouched; no new runtime dependencies in `backend/` or `frontend/`.
- Local tools: `jq`, `shellcheck`, `actionlint` are **not** installed on the dev machine — run them through Docker as shown in the tasks (`rhysd/actionlint` image is already present; `koalaman/shellcheck:stable` and `alpine` will be pulled).

---

## File structure

| Path | Responsibility |
|---|---|
| `backend/src/config/env.schema.ts` (new) | The Joi process-env contract, extracted from `app.module.ts` so it is unit-testable; `.empty('')` on `BOOTSTRAP_OWNER_*` |
| `backend/src/config/env.schema.spec.ts` (new) | Tests for the schema |
| `backend/src/config/app.config.ts` | Gains `commit` (from `APP_COMMIT`) |
| `backend/src/health/health.controller.ts` (+ spec) | Gains `GET /health/version` |
| `backend/Dockerfile` | `ARG APP_COMMIT` baked into the `prod` stage as `ENV` |
| `docker-compose.prod.yml` | The one compose file: images by `sha-`, mem limits, `seed` one-shot, no ports/networks |
| `docker-compose.standalone.yml` (new) | Loopback ports for the no-Coolify path |
| `scripts/vps/bootstrap.sh` (new) | Idempotent swap + sysctl + packages |
| `scripts/vps/backup.sh`, `scripts/vps/yagoda-backup.service`, `scripts/vps/yagoda-backup.timer` (new) | Atomic nightly snapshot pair with `flock` |
| `scripts/ci/coolify-deploy.sh` (new) + `scripts/ci/coolify-deploy.test.sh` | Deploy → poll → readiness; used by the composite action |
| `.github/actions/coolify-deploy/action.yml` (new) | Composite action wrapping the script |
| `scripts/ci/ghcr-cleanup.sh` (new) + test | Deletes `pr-*` of closed PRs, untagged, `sha-*` > 30 days |
| `.github/workflows/cleanup-images.yml` (new) | Weekly cleanup |
| `.github/workflows/ci.yml` | `docker` job pushes; `deploy-preview`, `deploy-prod` jobs |
| `docs/coolify-deploy.md` (new) | The runbook |
| `docs/vps-tls-setup.md`, `docs/backup-restore.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` | Updated to the new truth |

Phase A (Tasks 1–11) is repository work, testable locally. Phase B (Tasks 12–16) is the server. Phase C (Tasks 17–18) is end-to-end acceptance and the PR.

---

## Phase A — repository

### Task 1: Extract the env schema and make empty `BOOTSTRAP_OWNER_*` mean «unset»

**Files:**
- Create: `backend/src/config/env.schema.ts`
- Create: `backend/src/config/env.schema.spec.ts`
- Modify: `backend/src/app.module.ts:10` (drop the `Joi` import), `:43-73` (replace the inline `Joi.object({...})` with `envValidationSchema`)

**Interfaces:**
- Produces: `export const envValidationSchema: Joi.ObjectSchema` — consumed by `app.module.ts` only.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/config/env.schema.spec.ts
import { envValidationSchema } from './env.schema';

// The two keys with no default; every other rule has one.
const required = {
  APP_URL: 'https://yagoda.example.com',
  JWT_SECRET: 'x'.repeat(32),
};

// Mirror ConfigModule's defaults: unknown keys pass, all errors are collected.
function validate(env: Record<string, string>) {
  return envValidationSchema.validate({ ...required, ...env }, { allowUnknown: true, abortEarly: false });
}

describe('envValidationSchema', () => {
  it('treats empty BOOTSTRAP_OWNER_* as unset — docker-compose.prod.yml forwards them as ${VAR:-}', () => {
    const { error, value } = validate({
      BOOTSTRAP_OWNER_LOGIN: '',
      BOOTSTRAP_OWNER_PASSWORD: '',
      BOOTSTRAP_OWNER_FIRST_NAME: '',
      BOOTSTRAP_OWNER_LAST_NAME: '',
    });
    expect(error).toBeUndefined();
    expect(value.BOOTSTRAP_OWNER_LOGIN).toBeUndefined();
    expect(value.BOOTSTRAP_OWNER_PASSWORD).toBeUndefined();
  });

  it('still rejects a BOOTSTRAP_OWNER_PASSWORD shorter than 8 characters', () => {
    const { error } = validate({ BOOTSTRAP_OWNER_LOGIN: 'owner', BOOTSTRAP_OWNER_PASSWORD: 'short' });
    expect(error?.message).toContain('BOOTSTRAP_OWNER_PASSWORD');
  });

  it('accepts a complete bootstrap owner', () => {
    const { error } = validate({ BOOTSTRAP_OWNER_LOGIN: 'owner', BOOTSTRAP_OWNER_PASSWORD: 'long-enough-1' });
    expect(error).toBeUndefined();
  });

  it('still requires APP_URL and a 32-character JWT_SECRET', () => {
    const { error } = envValidationSchema.validate({}, { allowUnknown: true, abortEarly: false });
    expect(error?.message).toContain('APP_URL');
    expect(error?.message).toContain('JWT_SECRET');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w backend -- env.schema`
Expected: FAIL — `Cannot find module './env.schema'`.

- [ ] **Step 3: Create the schema module**

```ts
// backend/src/config/env.schema.ts
import * as Joi from 'joi';

/**
 * The process-environment contract, validated once at boot by ConfigModule
 * (allowUnknown: true, abortEarly: false are ConfigModule's defaults).
 *
 * BOOTSTRAP_OWNER_*: `.empty('')` maps an empty string to `undefined`.
 * docker-compose.prod.yml forwards these as `${VAR:-}` so the BootstrapOwner
 * migration can read them inside the container; when the operator has not set
 * them that expands to "", which a plain `Joi.string().optional()` rejects —
 * and a fresh production stack crash-loops before its first request. "" and
 * "unset" have to mean the same thing, which is also what the migration
 * assumes (`if (!login || !password) return`).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(0),
  // Public origin of the frontend. Drives the CORS allowlist in app.config.
  APP_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().integer().default(5432),
  DB_USER: Joi.string().default('app'),
  DB_PASSWORD: Joi.string().default('app'),
  DB_NAME: Joi.string().default('app'),
  DB_SSL: Joi.boolean().default(false),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().integer().default(6379),
  APP_TIMEZONE: Joi.string().default('Europe/Kyiv'),
  // Global per-IP rate limit. Configurable ONLY so the DB-backed HTTP
  // suites can raise it: every request in those specs comes from
  // 127.0.0.1, so one test run looks like a single abusive client and
  // trips the production default partway through. See
  // `src/testing/db-harness.ts`.
  THROTTLE_TTL_MS: Joi.number().integer().min(1).default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  // Read ONLY by the BootstrapOwner migration, and only when the users
  // table is empty. Unset in development, where SeedDevAdmin covers it.
  BOOTSTRAP_OWNER_LOGIN: Joi.string().empty('').optional(),
  BOOTSTRAP_OWNER_PASSWORD: Joi.string().empty('').min(8).optional(),
  BOOTSTRAP_OWNER_FIRST_NAME: Joi.string().empty('').optional(),
  BOOTSTRAP_OWNER_LAST_NAME: Joi.string().empty('').optional(),
  UPLOADS_DIR: Joi.string().optional(),
  // Baked into the image by backend/Dockerfile (ARG APP_COMMIT); read by
  // GET /health/version. Absent in dev, hence optional.
  APP_COMMIT: Joi.string().optional(),
});
```

- [ ] **Step 4: Point `app.module.ts` at it**

In `backend/src/app.module.ts`: remove line 10 (`import * as Joi from 'joi';`), add `import { envValidationSchema } from './config/env.schema';` next to the other `./config/*` imports, and replace the whole `validationSchema: Joi.object({ … })` block (lines 43–73, ending with `UPLOADS_DIR: Joi.string().optional(),\n      }),`) with:

```ts
      validationSchema: envValidationSchema,
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w backend -- env.schema && npm run lint -w backend`
Expected: 4 tests PASS; lint clean (no unused `Joi` import).

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/env.schema.ts backend/src/config/env.schema.spec.ts backend/src/app.module.ts
git commit -m "$(cat <<'EOF'
Treat empty BOOTSTRAP_OWNER_* as unset

docker-compose.prod.yml forwards these as ${VAR:-}, which expands to ""
when the operator leaves them out; Joi.string().optional() rejects "" and a
fresh production stack crash-looped before its first request. The schema
moves to config/env.schema.ts so this is unit-tested.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `GET /health/version` and the `APP_COMMIT` build-arg

**Files:**
- Modify: `backend/src/config/app.config.ts` (add `commit`)
- Modify: `backend/src/health/health.controller.ts` (add `version()`), `backend/src/health/health.controller.spec.ts`
- Modify: `backend/Dockerfile` (`prod` stage)

**Interfaces:**
- Produces: `GET /health/version` → `200 { "commit": string }` (`"unknown"` when `APP_COMMIT` is unset). Consumed by `scripts/ci/coolify-deploy.sh` (Task 6) as `.commit`.
- Produces: Docker build-arg `APP_COMMIT` on `backend/Dockerfile` — passed by `ci.yml` (Task 8) as `APP_COMMIT=${{ github.sha }}`.

- [ ] **Step 1: Write the failing test** — append to `backend/src/health/health.controller.spec.ts` inside `describe('HealthController')`, and add `appConfig` to the testing module:

Replace the `providers` array in `beforeEach` with:

```ts
      providers: [
        HealthIndicatorService,
        { provide: HealthCheckService, useValue: { check: mockCheck } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck: mockPingCheck } },
        { provide: REDIS_CLIENT, useValue: { ping: mockRedisPing } },
        { provide: appConfig.KEY, useValue: { commit: 'abc123def' } },
      ],
```

Add the import at the top: `import { appConfig } from '../config/app.config';`

Append the test:

```ts
  it('GET /health/version reports the commit the image was built from', () => {
    expect(controller.version()).toEqual({ commit: 'abc123def' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w backend -- health.controller`
Expected: FAIL — `controller.version is not a function`.

- [ ] **Step 3: Add `commit` to `appConfig`** — in `backend/src/config/app.config.ts`, inside the returned object after `corsOrigins,`:

```ts
    // Full git SHA the image was built from — backend/Dockerfile bakes the
    // APP_COMMIT build-arg into the prod stage. CI compares this with the
    // commit it deployed (GET /health/version) before it calls a deploy done.
    commit: process.env.APP_COMMIT ?? 'unknown',
```

- [ ] **Step 4: Add the endpoint** — in `backend/src/health/health.controller.ts`:

Imports: add `ConfigType` from `@nestjs/config` and `import { appConfig } from '../config/app.config';`. Extend the constructor:

```ts
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicator: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}
```

Add after `ready()`:

```ts
  // Which build is serving this hostname. Unauthenticated like live/ready:
  // a commit hash is not a secret, and CI needs it before it has a token.
  @Get('version')
  version(): { commit: string } {
    return { commit: this.app.commit };
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w backend -- health.controller && npm run lint -w backend`
Expected: 4 tests PASS.

- [ ] **Step 6: Bake the commit into the image** — in `backend/Dockerfile`, in the `prod` stage, directly after `ENV NODE_ENV=production`:

```dockerfile
# Set by CI (--build-arg APP_COMMIT=<git sha>) and read by GET /health/version.
# Placed in the final stage only, so it never invalidates the npm ci / dist
# layers above.
ARG APP_COMMIT=unknown
ENV APP_COMMIT=$APP_COMMIT
```

- [ ] **Step 7: Verify the image end to end**

```bash
docker build -f backend/Dockerfile --target prod --build-arg APP_COMMIT=deadbeef -t yagoda-backend:t2 . -q
docker run --rm yagoda-backend:t2 sh -c 'echo "$APP_COMMIT"'
```
Expected: prints `deadbeef`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/app.config.ts backend/src/health/health.controller.ts backend/src/health/health.controller.spec.ts backend/Dockerfile
git commit -m "$(cat <<'EOF'
Expose the built commit at GET /health/version

CI deploys sha-<commit> images and needs to see which SHA a hostname is
actually serving before it calls a deploy done; the Dockerfile bakes the
APP_COMMIT build-arg into the final stage only, so layer caching is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reshape `docker-compose.prod.yml`; add `docker-compose.standalone.yml`

**Files:**
- Modify: `docker-compose.prod.yml` (rewrite)
- Create: `docker-compose.standalone.yml`

**Interfaces:**
- Consumes: `APP_COMMIT` image env (Task 2); `dev-seed.cli.js` in the image (already there).
- Produces: services `postgres`, `redis`, `backend`, `nginx`, `seed`; variables `GHCR_REPO`, `IMAGE_TAG`, `SOURCE_COMMIT`, `SEED_DEV_DATA`, plus the existing app variables. Coolify (Task 14) points at this file; Task 5's backup script reads the `postgres` container and the `uploads_data` volume.

- [ ] **Step 1: Rewrite `docker-compose.prod.yml`**

```yaml
# The ONE production compose file. It runs in three places:
#   - Coolify (Docker Compose build pack): prod on main and every PR preview;
#   - a plain VPS without Coolify: add -f docker-compose.standalone.yml, which
#     publishes the loopback ports Coolify's Traefik makes unnecessary here;
#   - locally, to reproduce production.
# Rules that follow from Coolify running it (docs/coolify-deploy.md):
#   - no `networks:` — Coolify creates the stack network; a second network on
#     a container makes its Traefik pick interfaces non-deterministically;
#   - no `ports:` — Coolify does not strip them, and two previews would fight
#     over 127.0.0.1:8080. The standalone override adds them back.
#
# Distinct project name: without it, running this file from the same directory
# as the dev stack would silently reuse the dev-initialized pg_data volume
# (and its dev credentials) for production. Coolify ignores `name:` and uses
# its own resource UUID.
name: yagoda-prod

volumes:
  pg_data:
  # Uploaded images (avatars, etc.) are written under /app/uploads and served
  # as static assets. Without this volume they live inside the backend
  # container and are lost on every redeploy.
  uploads_data:
  # AOF, not just the volume. The image's default RDB policy
  # (save 3600 1 / 300 100 / 60 10000) may not snapshot for an hour on a
  # low-write instance, so rate-limit counters written minutes before a
  # restart would be lost even with /data persisted. appendfsync everysec
  # bounds that loss to ~1s.
  redis_data:

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER:-app}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME:-app}
    volumes:
      - pg_data:/var/lib/postgresql/data
    # Verified under migrations + seed + restore (plan Task 3 step 4). The
    # image's shared_buffers default (128MB) fits; the realistic peaks are
    # the seed's inserts and a pg_restore, not idle.
    mem_limit: 256m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-app}"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]
    volumes:
      - redis_data:/data
    mem_limit: 64m
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    # Built and pushed by .github/workflows/ci.yml as sha-<full commit>; that
    # tag is the ONLY thing ever deployed. Coolify sets SOURCE_COMMIT to the
    # commit it checked out (see docs/coolify-deploy.md). IMAGE_TAG exists for
    # the standalone path (pass it explicitly) and for the documented API
    # fallback — never set it in Coolify's env otherwise.
    image: ghcr.io/${GHCR_REPO:-webspirio/yagoda-starter}-backend:${IMAGE_TAG:-sha-${SOURCE_COMMIT}}
    environment:
      NODE_ENV: production
      # Heap cap below mem_limit, so an out-of-memory is a readable Node heap
      # error in the logs rather than a SIGKILL from the cgroup.
      NODE_OPTIONS: --max-old-space-size=256
      APP_URL: ${APP_URL}
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-7d}
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: ${DB_USER:-app}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: ${DB_NAME:-app}
      # Proxy hops in front of the backend: Coolify's Traefik + the internal
      # nginx (or host nginx + internal nginx on the standalone path). Rate
      # limiting keys on the client IP taken this many hops back in
      # X-Forwarded-For.
      TRUST_PROXY_HOPS: 2
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Pin the uploads dir to the volume's absolute mount path. Without this the
      # backend (and any migration run) falls back to `./uploads`, which is
      # CWD-relative — a process launched with a different working directory would
      # silently read/write the wrong place (and its files would miss this volume).
      UPLOADS_DIR: /app/uploads
      # BootstrapOwner1788600000003 runs INSIDE this container as part of the
      # startup migration run (migrationsRun: true) and only ever runs once — it
      # records itself as applied on its very first invocation, whether or not it
      # actually created anyone. Compose's top-level .env only interpolates
      # `${…}` inside this file, it does NOT inject vars into the container, so
      # without listing these explicitly here BOOTSTRAP_OWNER_LOGIN/_PASSWORD are
      # undefined at boot, the migration silently no-ops, and — since public
      # registration is deleted — the install has no owner and no recovery path
      # short of hand-inserting a user row, an identity row and a hand-computed
      # scrypt hash. A missed variable here is unrecoverable, not merely
      # inconvenient, so forward these even though the defaults are empty
      # (config/env.schema.ts treats "" as unset).
      BOOTSTRAP_OWNER_LOGIN: ${BOOTSTRAP_OWNER_LOGIN:-}
      BOOTSTRAP_OWNER_PASSWORD: ${BOOTSTRAP_OWNER_PASSWORD:-}
      BOOTSTRAP_OWNER_FIRST_NAME: ${BOOTSTRAP_OWNER_FIRST_NAME:-}
      BOOTSTRAP_OWNER_LAST_NAME: ${BOOTSTRAP_OWNER_LAST_NAME:-}
      APP_TIMEZONE: ${APP_TIMEZONE:-Europe/Kyiv}
    volumes:
      - uploads_data:/app/uploads
    mem_limit: 384m
    healthcheck:
      test: ["CMD-SHELL", "wget -qO/dev/null http://127.0.0.1:3000/health/ready"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  # One-shot demo dataset for PREVIEW deployments only. Coolify's preview env
  # set carries SEED_DEV_DATA=true; production does not, so this exits 0 at
  # once there. It waits for the BACKEND, not Postgres: the seed refuses to run
  # while migrations are pending and the backend's start-up is the only
  # migration runner in the stack — a healthy backend is the signal that the
  # schema exists. Idempotent: a redeploy of the same preview inserts 0 rows.
  # NODE_ENV=development applies to this process alone (the seed refuses
  # production by design); the backend container stays production.
  seed:
    image: ghcr.io/${GHCR_REPO:-webspirio/yagoda-starter}-backend:${IMAGE_TAG:-sha-${SOURCE_COMMIT}}
    command:
      - sh
      - -c
      - '[ "$$SEED_DEV_DATA" = "true" ] || exit 0; exec node backend/dist/seed/dev-seed.cli.js'
    environment:
      SEED_DEV_DATA: ${SEED_DEV_DATA:-}
      NODE_ENV: development
      NODE_OPTIONS: --max-old-space-size=192
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: ${DB_USER:-app}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: ${DB_NAME:-app}
    mem_limit: 256m
    restart: "no"
    depends_on:
      backend:
        condition: service_healthy

  # nginx serves the SPA and proxies /api/ to the backend. It does NOT
  # terminate TLS: Coolify's Traefik (or the host nginx on the standalone
  # path, docs/vps-tls-setup.md) owns the public HTTPS listener. Both must
  # allow request bodies of at least 12 MB (uploads are capped at 10 MB).
  nginx:
    image: ghcr.io/${GHCR_REPO:-webspirio/yagoda-starter}-nginx:${IMAGE_TAG:-sha-${SOURCE_COMMIT}}
    mem_limit: 64m
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
```

Note `$$SEED_DEV_DATA` — the double `$` keeps compose from interpolating it at parse time; the container's shell reads the env var.

- [ ] **Step 2: Create `docker-compose.standalone.yml`**

```yaml
# Override for a VPS WITHOUT Coolify (docs/vps-tls-setup.md):
#   docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d
# Re-adds the loopback-only ports the base file deliberately has none of.
# Bind to 127.0.0.1, never 0.0.0.0 — Docker's published ports bypass the host
# firewall (UFW/iptables), so a bare "5432:5432" would expose Postgres to the
# public internet. Postgres stays reachable only through an SSH tunnel:
# `ssh -N -L 5433:localhost:5432 user@host`, then connect to localhost:5433.
# Set IMAGE_TAG=sha-<commit> explicitly on this path — there is no Coolify to
# provide SOURCE_COMMIT.
services:
  postgres:
    ports:
      - "127.0.0.1:5432:5432"
  nginx:
    ports:
      - "127.0.0.1:8080:8080"
```

- [ ] **Step 3: Validate the files parse and interpolate as intended**

```bash
docker compose -f docker-compose.prod.yml config --no-interpolate >/dev/null && echo "prod: syntax ok"
DB_PASSWORD=x APP_URL=http://x JWT_SECRET=x SOURCE_COMMIT=abc docker compose -f docker-compose.prod.yml config | grep -E '^\s+image:' 
DB_PASSWORD=x APP_URL=http://x JWT_SECRET=x IMAGE_TAG=sha-fff docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml config | grep -E 'image:|published|mem_limit|networks'
```
Expected: three `image:` lines ending in `:sha-abc`; the second command shows `:sha-fff`, `published: "8080"` and `"5432"`, four `mem_limit` values, and **no** `networks` key other than compose's implicit default.

- [ ] **Step 4: Run the whole stack locally under the limits, with the seed, and prove the limits hold**

Build both images from the working tree with a fake commit and run the standalone stack on alternative ports (the dev stack occupies 5432/8080's neighbours):

```bash
S=/tmp/claude-1000/-home-dz-work-yagoda-starter/5335b35a-6b3a-4af7-a09d-0da1ab42e245/scratchpad
docker build -f backend/Dockerfile --target prod --build-arg APP_COMMIT=localtest -t ghcr.io/webspirio/yagoda-starter-backend:sha-localtest . -q
docker build -f nginx/Dockerfile -t ghcr.io/webspirio/yagoda-starter-nginx:sha-localtest . -q
cat > "$S/t3.env" <<'EOF'
IMAGE_TAG=sha-localtest
DB_PASSWORD=t3-pass
JWT_SECRET=t3-secret-0123456789abcdef0123456789abcdef
APP_URL=http://localhost:58080
BOOTSTRAP_OWNER_LOGIN=owner
BOOTSTRAP_OWNER_PASSWORD=owner-pass-12345
SEED_DEV_DATA=true
EOF
cat > "$S/t3.ports.yml" <<'EOF'
services:
  postgres:
    ports: !override ["127.0.0.1:55432:5432"]
  nginx:
    ports: !override ["127.0.0.1:58080:8080"]
EOF
DC="docker compose -p t3 --env-file $S/t3.env -f docker-compose.prod.yml -f docker-compose.standalone.yml -f $S/t3.ports.yml"
# Long-running services first (--wait needs running/healthy), then the one-shot seed.
$DC up -d --wait --wait-timeout 180 postgres redis backend nginx
$DC up -d seed && docker wait t3-seed-1 && $DC logs seed | tail -3
curl -s http://127.0.0.1:58080/api/health/version
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{"username":"oksana","password":"operator"}' http://127.0.0.1:58080/api/auth/login
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' $($DC ps -q)
docker inspect -f '{{.Name}} OOMKilled={{.State.OOMKilled}}' t3-postgres-1 t3-backend-1 t3-seed-1
# Second run of the seed against the same database: idempotency.
$DC run --rm seed | tail -2
```
Expected: `docker wait` prints `0`; `seed` logs end with `Dev seed applied (rows inserted this run): points=… users=…` (non-zero) and the sign-in hint; `/api/health/version` → `{"commit":"localtest"}`; login → `200`; every container's memory is well under its limit (`postgres` < 256MiB, `backend` < 384MiB) and all three `OOMKilled=false`; the **second** seed run prints all zeros (`points=0 products=0 … payouts=0`).

Then the restore side of the limit check — a dump/restore round trip inside the 256m Postgres:

```bash
$DC exec -T postgres pg_dump -U app app > "$S/t3.sql"
$DC exec -T postgres psql -U app -d postgres -c 'CREATE DATABASE restore_check;'
$DC exec -T postgres psql -U app -d restore_check -q < "$S/t3.sql" && echo "restore ok"
docker inspect -f 'OOMKilled={{.State.OOMKilled}}' t3-postgres-1
$DC down -v
```
Expected: `restore ok`, `OOMKilled=false`.

If any container is OOM-killed, raise that service's `mem_limit` by 64m, note the measured peak in the compose comment, and re-run — the spec's numbers are provisional until this step passes.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml docker-compose.standalone.yml
git commit -m "$(cat <<'EOF'
Make docker-compose.prod.yml the single Coolify-ready compose file

Images come from GHCR as sha-<commit> (SOURCE_COMMIT from Coolify, or an
explicit IMAGE_TAG); no host ports or custom network, so the same file
serves prod and per-PR previews behind Coolify's Traefik; per-service
mem_limit with the Node heap capped below it; a one-shot seed service for
previews. docker-compose.standalone.yml restores the loopback ports for a
VPS without Coolify.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `scripts/vps/bootstrap.sh`

**Files:**
- Create: `scripts/vps/bootstrap.sh`

**Interfaces:**
- Produces: an idempotent root script; run on the server in Task 12.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# One-time host preparation for the yagoda VPS. Idempotent: safe to re-run.
#   scp scripts/vps/bootstrap.sh root@188.245.146.122:/root/ && ssh root@188.245.146.122 bash /root/bootstrap.sh
# Does NOT install Coolify (its installer is run separately, see
# docs/coolify-deploy.md) and does NOT touch the firewall — Docker's published
# ports bypass UFW, so the firewall lives at Hetzner's edge, not on the host.
set -euo pipefail

SWAP_FILE=/swapfile
SWAP_SIZE_MB=2048

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

echo "== packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git jq >/dev/null

echo "== swap (${SWAP_SIZE_MB} MB at ${SWAP_FILE})"
if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  if [ ! -f "$SWAP_FILE" ]; then
    fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE"
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null
  fi
  swapon "$SWAP_FILE"
fi
grep -q "^${SWAP_FILE} " /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab

echo "== sysctl"
# Swap is a safety net, not a working mode: only page out under real pressure.
cat > /etc/sysctl.d/90-yagoda.conf <<'EOF'
vm.swappiness = 10
EOF
sysctl -q --system >/dev/null 2>&1 || echo "warning: sysctl --system failed (read-only /proc/sys? applies on next boot)"

echo "== backup directory"
install -d -m 750 /data/backups

echo "== done"
free -h
swapon --show
```

- [ ] **Step 2: Lint it**

Run: `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/vps/bootstrap.sh && chmod +x scripts/vps/bootstrap.sh && bash -n scripts/vps/bootstrap.sh && echo ok`
Expected: no shellcheck output, `ok`.

- [ ] **Step 3: Dry-run the idempotency logic in a container** (no root on the dev box needed)

```bash
docker run --rm -v "$PWD/scripts/vps/bootstrap.sh:/b.sh:ro" ubuntu:24.04 bash -c '
  apt-get update -qq >/dev/null && apt-get install -y -qq util-linux procps >/dev/null
  # fallocate/mkswap/swapon are not permitted in a container; stub them to test the flow.
  mkdir -p /stub
  printf "#!/bin/bash\ntouch \"\${!#}\"\n" > /stub/fallocate          # creates the file like the real one
  printf "#!/bin/sh\nexit 0\n" > /stub/mkswap
  printf "#!/bin/sh\nexit 0\n" > /stub/swapon                        # --show prints nothing -> "not active"
  chmod +x /stub/*
  PATH=/stub:$PATH bash /b.sh && PATH=/stub:$PATH bash /b.sh && grep -c "^/swapfile " /etc/fstab && stat -c %a /swapfile'
```
Expected: two runs succeed, `/etc/fstab` contains the swap line exactly once (`1`), and `/swapfile` has mode `600`.

- [ ] **Step 4: Commit**

```bash
git add scripts/vps/bootstrap.sh
git commit -m "$(cat <<'EOF'
Add idempotent VPS bootstrap (swap, sysctl, packages)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Atomic nightly backup — `scripts/vps/backup.sh` + systemd units

**Files:**
- Create: `scripts/vps/backup.sh`, `scripts/vps/yagoda-backup.service`, `scripts/vps/yagoda-backup.timer`, `scripts/vps/yagoda-backup.env.example`

**Interfaces:**
- Consumes: env file `/etc/yagoda-backup.env` with `PG_CONTAINER`, `UPLOADS_VOLUME`, `DB_USER`, `DB_NAME`, optional `BACKUP_DIR` (default `/data/backups`), `RETENTION_DAYS` (default 14). Values are filled in Task 16 from `docker ps` / `docker volume ls` on the server (Coolify names them `<service>-<uuid>` / `<uuid>_<volume>`).
- Produces: pairs `<STAMP>-db.sql.gz` + `<STAMP>-uploads.tar.gz`, never a lone half, never a `.partial` left behind on success.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Nightly backup of the yagoda prod stack: ONE logical snapshot = a pg_dump
# and a tar of the uploads volume taken back-to-back under one STAMP.
# media_files rows reference files that live only on the uploads volume, so
# the two halves are only meaningful together (docs/backup-restore.md).
#
# Atomic: both halves are written as *.partial, verified, and renamed into
# place only when BOTH succeeded; on any failure both partials are removed, so
# the backup directory never contains an unmatched file. flock serializes a
# manual run against the timer.
#
# Config: /etc/yagoda-backup.env (see yagoda-backup.env.example).
set -euo pipefail

CONFIG=${CONFIG:-/etc/yagoda-backup.env}
# shellcheck disable=SC1090
. "$CONFIG"
: "${PG_CONTAINER:?set in $CONFIG}" "${UPLOADS_VOLUME:?set in $CONFIG}"
: "${DB_USER:?set in $CONFIG}" "${DB_NAME:?set in $CONFIG}"
BACKUP_DIR=${BACKUP_DIR:-/data/backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
LOCK=${LOCK:-/run/lock/yagoda-backup.lock}

mkdir -p "$BACKUP_DIR" "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || { echo "another backup is running; skipping" >&2; exit 0; }

STAMP=$(date +%Y%m%d-%H%M%S)
DB="$BACKUP_DIR/$STAMP-db.sql.gz"
UP="$BACKUP_DIR/$STAMP-uploads.tar.gz"

cleanup_partials() { rm -f "$DB.partial" "$UP.partial"; }
trap 'cleanup_partials; echo "backup $STAMP FAILED" >&2' ERR

echo "backup $STAMP: database"
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$DB.partial"
gzip -t "$DB.partial"
gunzip -c "$DB.partial" | head -c 4096 | grep -q 'PostgreSQL database dump'

echo "backup $STAMP: uploads"
docker run --rm -v "$UPLOADS_VOLUME:/data:ro" alpine tar czf - -C /data . > "$UP.partial"
tar -tzf "$UP.partial" >/dev/null

mv "$DB.partial" "$DB"
mv "$UP.partial" "$UP"
trap - ERR
echo "backup $STAMP: ok ($(du -h "$DB" | cut -f1) db, $(du -h "$UP" | cut -f1) uploads)"

# Retention by pair: a pair is pruned when its db half is older than the window.
find "$BACKUP_DIR" -name '*-db.sql.gz' -mtime +"$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' old; do
    rm -f "$old" "${old%-db.sql.gz}-uploads.tar.gz"
    echo "pruned ${old##*/} and its uploads half"
  done
```

- [ ] **Step 2: Write the units and the env example**

`scripts/vps/yagoda-backup.service`:
```ini
[Unit]
Description=yagoda nightly backup (pg_dump + uploads tar, atomic pair)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/yagoda-backup.sh
```

`scripts/vps/yagoda-backup.timer`:
```ini
[Unit]
Description=Run yagoda backup nightly at 02:30

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

`scripts/vps/yagoda-backup.env.example`:
```bash
# Copy to /etc/yagoda-backup.env (mode 600) and fill in from the server:
#   docker ps --format '{{.Names}}' | grep postgres     -> PG_CONTAINER
#   docker volume ls --format '{{.Name}}' | grep uploads -> UPLOADS_VOLUME
PG_CONTAINER=postgres-REPLACE_WITH_COOLIFY_UUID
UPLOADS_VOLUME=REPLACE_WITH_COOLIFY_UUID_uploads_data
DB_USER=app
DB_NAME=app
BACKUP_DIR=/data/backups
RETENTION_DAYS=14
```

- [ ] **Step 3: Lint**

Run: `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/vps/backup.sh && chmod +x scripts/vps/backup.sh && echo ok`
Expected: `ok`.

- [ ] **Step 4: Test against a real local stack — success, atomicity on failure, lock**

```bash
S=/tmp/claude-1000/-home-dz-work-yagoda-starter/5335b35a-6b3a-4af7-a09d-0da1ab42e245/scratchpad
DC="docker compose -p t3 --env-file $S/t3.env -f docker-compose.prod.yml -f docker-compose.standalone.yml -f $S/t3.ports.yml"
$DC up -d --wait --wait-timeout 180 postgres backend
docker exec t3-backend-1 sh -c 'echo hello > /app/uploads/probe.txt'
cat > "$S/bk.env" <<EOF
PG_CONTAINER=t3-postgres-1
UPLOADS_VOLUME=t3_uploads_data
DB_USER=app
DB_NAME=app
BACKUP_DIR=$S/backups
RETENTION_DAYS=14
LOCK=$S/bk.lock
EOF
# 1) success: one pair, no partials
CONFIG=$S/bk.env bash scripts/vps/backup.sh && ls "$S/backups"
# 2) failure in the SECOND half leaves NO files behind (the db half was already
#    written as .partial). Docker auto-creates a missing named volume, so use an
#    INVALID volume name to make `docker run -v` itself fail.
sed 's/^UPLOADS_VOLUME=.*/UPLOADS_VOLUME="invalid volume name!"/' "$S/bk.env" > "$S/bk.bad.env"
CONFIG=$S/bk.bad.env bash scripts/vps/backup.sh; echo "exit=$?"; ls "$S/backups" | grep -c partial || true
# 3) lock: a second run while the first holds the lock skips
( exec 9>"$S/bk.lock"; flock 9; CONFIG=$S/bk.env bash scripts/vps/backup.sh; echo "locked exit=$?" )
$DC down -v
```
Expected: (1) exactly two files with the same stamp; (2) non-zero exit, `backup … FAILED` on stderr, `0` partials and still exactly the two files from (1); (3) prints `another backup is running; skipping` and `locked exit=0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/vps/backup.sh scripts/vps/yagoda-backup.service scripts/vps/yagoda-backup.timer scripts/vps/yagoda-backup.env.example
git commit -m "$(cat <<'EOF'
Add atomic nightly backup script and systemd timer

pg_dump and the uploads tar are one logical snapshot: written as partials,
verified, renamed together or removed together; flock keeps a manual run
from overlapping the timer; retention prunes by pair.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `scripts/ci/coolify-deploy.sh` + composite action

**Files:**
- Create: `scripts/ci/coolify-deploy.sh`, `scripts/ci/coolify-deploy.test.sh`, `.github/actions/coolify-deploy/action.yml`

**Interfaces:**
- Consumes env: `COOLIFY_URL` (e.g. `https://coolify.yagoda.webspirio.com`), `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID`, `EXPECTED_COMMIT` (40-char sha), `BASE_URL` (e.g. `https://pr-12.yagoda.webspirio.com`), optional `PR_NUMBER`, optional `SEED_USERNAME`/`SEED_PASSWORD` (readiness login), optional `DEPLOY_TIMEOUT_SEC` (900), `READY_TIMEOUT_SEC` (180).
- Consumes: `GET /health/version` (Task 2) → `.commit`.
- Produces: exit 0 only when Coolify reports `finished` **and** `/api/health/ready` is 200 **and** `/api/health/version.commit == EXPECTED_COMMIT` **and** (if `SEED_USERNAME` set) login returns 200/201. Writes `deployment_uuid=<uuid>` to `$GITHUB_OUTPUT` when that file exists. Stderr carries a one-line diagnosis (`image pull failed — check the GHCR credential on the server` when the deployment log mentions `pull access denied`/`manifest unknown`/`denied`).
- Coolify API assumed (verified by the spike, Task 15): `POST {COOLIFY_URL}/api/v1/deploy?uuid=…[&pr=N]&force=false` → `{"deployments":[{"deployment_uuid":"…"}]}`; `GET {COOLIFY_URL}/api/v1/deployments/{uuid}` → `{"status":"queued|in_progress|finished|failed|cancelled-by-user", "logs": "…"}`.

- [ ] **Step 1: Write the failing test** — a bash test that puts a fake `curl` first on `PATH`; the fake replays canned responses keyed by URL substring and records calls.

```bash
#!/usr/bin/env bash
# scripts/ci/coolify-deploy.test.sh — run: bash scripts/ci/coolify-deploy.test.sh
# Needs bash, jq. Locally: docker run --rm -v "$PWD:/w" -w /w alpine sh -c 'apk add -q bash jq curl && bash scripts/ci/coolify-deploy.test.sh'
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

# Fake curl: `-o <file>` and `-w '%{http_code}'` are honoured; the body comes from
# $T/responses/<key> where key is the first matching substring in URL_KEYS.
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=/dev/stdout; url=""; write_code=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2;;
    -w) write_code=1; shift 2;;
    -X|-H|-d|--max-time|--retry) shift 2;;
    -s|-S|-f|-L|--fail) shift;;
    http*) url=$1; shift;;
    *) shift;;
  esac
done
echo "$url" >> "$FAKE_CURL_LOG"
key=""
for k in $URL_KEYS; do case "$url" in *"$k"*) key=$k; break;; esac; done
body_file="$FAKE_RESPONSES/${key//\//_}"
code_file="$body_file.code"
[ -f "$body_file" ] || { echo "no canned response for $url" >&2; exit 7; }
cat "$body_file" > "$out"
[ $write_code -eq 1 ] && cat "${code_file:-/dev/null}" 2>/dev/null || { [ $write_code -eq 1 ] && echo 200; }
exit 0
EOF
chmod +x "$T/bin/curl"

export FAKE_CURL_LOG="$T/calls.log" FAKE_RESPONSES="$T/responses"
export URL_KEYS="/api/v1/deploy?uuid /api/v1/deployments/ /api/health/ready /api/health/version /api/auth/login"
mkdir -p "$FAKE_RESPONSES"
canned() { printf '%s' "$2" > "$FAKE_RESPONSES/${1//\//_}"; [ -n "${3:-}" ] && printf '%s' "$3" > "$FAKE_RESPONSES/${1//\//_}.code" || true; }

export COOLIFY_URL=https://coolify.test COOLIFY_API_TOKEN=t COOLIFY_APP_UUID=app1
export EXPECTED_COMMIT=$(printf 'a%.0s' {1..40}) BASE_URL=https://pr-5.test PR_NUMBER=5
export SEED_USERNAME=oksana SEED_PASSWORD=operator
export POLL_INTERVAL_SEC=0 DEPLOY_TIMEOUT_SEC=5 READY_TIMEOUT_SEC=5
export GITHUB_OUTPUT="$T/gh_out"

pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }
# env options (-u …) must precede the NAME=VALUE assignment.
run() { env "$@" PATH="$T/bin:$PATH" bash "$HERE/coolify-deploy.sh"; }

echo "# 1. happy path"
canned '/api/v1/deploy?uuid' '{"deployments":[{"deployment_uuid":"dep-1"}]}'
canned '/api/v1/deployments/' '{"status":"finished","logs":""}'
canned '/api/health/ready' '{"status":"ok"}' 200
canned '/api/health/version' "{\"commit\":\"$EXPECTED_COMMIT\"}" 200
canned '/api/auth/login' '{"access_token":"x"}' 200
: > "$FAKE_CURL_LOG"; : > "$GITHUB_OUTPUT"
check run
check grep -q 'deploy?uuid=app1&force=false&pr=5' "$FAKE_CURL_LOG"
check grep -q '^deployment_uuid=dep-1$' "$GITHUB_OUTPUT"

echo "# 2. Coolify says failed -> exit 1, pull hint when logs mention denied"
canned '/api/v1/deployments/' '{"status":"failed","logs":"Error response from daemon: pull access denied for ghcr.io/x"}'
check_fail run 2>"$T/err2"
check grep -q 'GHCR credential' "$T/err2"

echo "# 3. finished but wrong commit -> exit 1"
canned '/api/v1/deployments/' '{"status":"finished","logs":""}'
canned '/api/health/version' '{"commit":"bbbbbbbb"}' 200
check_fail run 2>"$T/err3"
check grep -q 'expected' "$T/err3"

echo "# 4. no PR_NUMBER -> production deploy URL has no &pr=, no seed login"
canned '/api/health/version' "{\"commit\":\"$EXPECTED_COMMIT\"}" 200
: > "$FAKE_CURL_LOG"
check run -u PR_NUMBER -u SEED_USERNAME
check_fail grep -q '&pr=' "$FAKE_CURL_LOG"
check_fail grep -q '/api/auth/login' "$FAKE_CURL_LOG"

echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker run --rm -v "$PWD:/w" -w /w alpine sh -c 'apk add -q bash jq curl && bash scripts/ci/coolify-deploy.test.sh'`
Expected: FAIL — `coolify-deploy.sh: No such file`.

- [ ] **Step 3: Write the script**

```bash
#!/usr/bin/env bash
# Deploy one Coolify application (production, or the preview for PR_NUMBER),
# wait for Coolify to finish, then prove the APPLICATION is up — Coolify's
# "finished" is not "serving": Traefik/DNS/container start-up leave a window,
# and for previews the seed still has to complete.
#
# Exit 0 only when ALL hold:
#   1. POST /api/v1/deploy accepted and GET /api/v1/deployments/<id> reached "finished";
#   2. GET $BASE_URL/api/health/ready is 200;
#   3. GET $BASE_URL/api/health/version .commit == EXPECTED_COMMIT;
#   4. (if SEED_USERNAME is set) POST $BASE_URL/api/auth/login succeeds — the seed ran.
#
# Env: COOLIFY_URL COOLIFY_API_TOKEN COOLIFY_APP_UUID EXPECTED_COMMIT BASE_URL
#      [PR_NUMBER] [SEED_USERNAME SEED_PASSWORD]
#      [DEPLOY_TIMEOUT_SEC=900] [READY_TIMEOUT_SEC=180] [POLL_INTERVAL_SEC=10]
set -euo pipefail

: "${COOLIFY_URL:?}" "${COOLIFY_API_TOKEN:?}" "${COOLIFY_APP_UUID:?}" "${EXPECTED_COMMIT:?}" "${BASE_URL:?}"
DEPLOY_TIMEOUT_SEC=${DEPLOY_TIMEOUT_SEC:-900}
READY_TIMEOUT_SEC=${READY_TIMEOUT_SEC:-180}
POLL_INTERVAL_SEC=${POLL_INTERVAL_SEC:-10}
AUTH=(-H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json")

fail() { echo "::error::$*" >&2; exit 1; }

# --- 1. trigger -------------------------------------------------------------
deploy_url="$COOLIFY_URL/api/v1/deploy?uuid=$COOLIFY_APP_UUID&force=false"
[ -n "${PR_NUMBER:-}" ] && deploy_url="$deploy_url&pr=$PR_NUMBER"
resp=$(curl -sS -X POST "${AUTH[@]}" "$deploy_url")
deployment_uuid=$(printf '%s' "$resp" | jq -r '.deployments[0].deployment_uuid // empty')
[ -n "$deployment_uuid" ] || fail "Coolify did not return a deployment_uuid: $resp"
echo "deployment $deployment_uuid queued (${PR_NUMBER:+preview pr=$PR_NUMBER}${PR_NUMBER:-production})"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "deployment_uuid=$deployment_uuid" >> "$GITHUB_OUTPUT"

# --- 2. wait for Coolify ----------------------------------------------------
deadline=$((SECONDS + DEPLOY_TIMEOUT_SEC))
status=""
while [ $SECONDS -lt $deadline ]; do
  d=$(curl -sS "${AUTH[@]}" "$COOLIFY_URL/api/v1/deployments/$deployment_uuid")
  status=$(printf '%s' "$d" | jq -r '.status // empty')
  case "$status" in
    finished) break ;;
    failed|cancelled-by-user)
      logs=$(printf '%s' "$d" | jq -r '.logs // ""')
      if printf '%s' "$logs" | grep -qiE 'pull access denied|manifest unknown|denied: |unauthorized'; then
        echo "::error::image pull failed — check the GHCR credential on the server (docs/coolify-deploy.md → Registry credentials)" >&2
      fi
      printf '%s\n' "$logs" | tail -n 40 >&2
      fail "Coolify deployment $deployment_uuid ended with status '$status'"
      ;;
  esac
  sleep "$POLL_INTERVAL_SEC"
done
[ "$status" = finished ] || fail "Coolify deployment $deployment_uuid still '$status' after ${DEPLOY_TIMEOUT_SEC}s"
echo "Coolify: finished"

# --- 3. the application itself ---------------------------------------------
probe() { # url -> http code (000 on connection failure)
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || echo 000
}
deadline=$((SECONDS + READY_TIMEOUT_SEC))
until [ "$(probe "$BASE_URL/api/health/ready")" = 200 ]; do
  [ $SECONDS -lt $deadline ] || fail "$BASE_URL/api/health/ready not 200 after ${READY_TIMEOUT_SEC}s"
  sleep "$POLL_INTERVAL_SEC"
done
echo "ready: 200"

served=$(curl -sS --max-time 10 "$BASE_URL/api/health/version" | jq -r '.commit // empty')
[ "$served" = "$EXPECTED_COMMIT" ] || fail "$BASE_URL serves commit '$served', expected '$EXPECTED_COMMIT'"
echo "version: $served"

if [ -n "${SEED_USERNAME:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H 'content-type: application/json' \
    -d "{\"username\":\"$SEED_USERNAME\",\"password\":\"${SEED_PASSWORD:?}\"}" "$BASE_URL/api/auth/login")
  case "$code" in 200|201) echo "seed login: $code" ;; *) fail "login as seeded user '$SEED_USERNAME' returned $code — did the seed run?" ;; esac
fi

echo "deployed $EXPECTED_COMMIT at $BASE_URL"
```

- [ ] **Step 4: Run the tests**

Run: `chmod +x scripts/ci/coolify-deploy.sh && docker run --rm -v "$PWD:/w" -w /w alpine sh -c 'apk add -q bash jq curl && bash scripts/ci/coolify-deploy.test.sh' && docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/ci/coolify-deploy.sh scripts/ci/coolify-deploy.test.sh`
Expected: `passed=10 failed=0`; shellcheck clean.

- [ ] **Step 5: The composite action**

```yaml
# .github/actions/coolify-deploy/action.yml
name: Deploy via Coolify and verify the application
description: >-
  Triggers a Coolify deployment (production, or the preview for pr-number),
  waits for it, then checks /api/health/ready, /api/health/version == commit,
  and optionally a seeded login. See scripts/ci/coolify-deploy.sh.
inputs:
  coolify-url: { required: true, description: Coolify base URL }
  coolify-api-token: { required: true, description: API token (deploy + read) }
  app-uuid: { required: true, description: Coolify application UUID }
  base-url: { required: true, description: Public URL the deploy must answer on }
  commit: { required: true, description: Full SHA the deployment must serve }
  pr-number: { required: false, default: '', description: PR number for a preview deploy }
  seed-username: { required: false, default: '', description: Seeded login to verify (previews) }
  seed-password: { required: false, default: '', description: Its password }
outputs:
  deployment-uuid:
    description: Coolify deployment UUID
    value: ${{ steps.deploy.outputs.deployment_uuid }}
runs:
  using: composite
  steps:
    - id: deploy
      shell: bash
      env:
        COOLIFY_URL: ${{ inputs.coolify-url }}
        COOLIFY_API_TOKEN: ${{ inputs.coolify-api-token }}
        COOLIFY_APP_UUID: ${{ inputs.app-uuid }}
        BASE_URL: ${{ inputs.base-url }}
        EXPECTED_COMMIT: ${{ inputs.commit }}
        PR_NUMBER: ${{ inputs.pr-number }}
        SEED_USERNAME: ${{ inputs.seed-username }}
        SEED_PASSWORD: ${{ inputs.seed-password }}
      run: bash "$GITHUB_ACTION_PATH/../../../scripts/ci/coolify-deploy.sh"
```

- [ ] **Step 6: Lint the action**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color .github/actions/coolify-deploy/action.yml; echo "exit=$?"`
Expected: no findings (actionlint only lints workflows by default; a clean parse and `exit=0` is enough here).

- [ ] **Step 7: Commit**

```bash
git add scripts/ci/coolify-deploy.sh scripts/ci/coolify-deploy.test.sh .github/actions/coolify-deploy/action.yml
git commit -m "$(cat <<'EOF'
Add coolify-deploy script and composite action

Triggers a Coolify deployment, waits for it, then verifies the application
itself: /ready is 200, /health/version serves the expected commit, and (for
previews) a seeded login works. Names an expired GHCR credential when the
deployment log shows a pull denial.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: GHCR cleanup script and weekly workflow

**Files:**
- Create: `scripts/ci/ghcr-cleanup.sh`, `scripts/ci/ghcr-cleanup.test.sh`, `.github/workflows/cleanup-images.yml`

**Interfaces:**
- Consumes: `gh` with `GH_TOKEN` having `packages: write`; env `GHCR_ORG=webspirio`, `PACKAGES="yagoda-starter-backend yagoda-starter-nginx"`, `KEEP_SHA_DAYS=30`, `OPEN_PRS` (space-separated PR numbers whose `pr-N` alias must survive), `DRY_RUN`.
- Produces: deletes package versions that are untagged, or tagged only `pr-N` with N not in `OPEN_PRS`, or whose tags are all `sha-*` and `created_at` older than `KEEP_SHA_DAYS`. Never deletes a version that carries any other tag.

- [ ] **Step 1: Write the failing test** — the decision logic lives in a jq filter, tested on a fixture:

```bash
#!/usr/bin/env bash
# scripts/ci/ghcr-cleanup.test.sh — run inside alpine with bash+jq (see coolify-deploy.test.sh header)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OLD=$(date -u -d '@'$(( $(date +%s) - 40*86400 )) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r $(( $(date +%s) - 40*86400 )) +%Y-%m-%dT%H:%M:%SZ)
fixture=$(cat <<EOF
[
 {"id":1,"created_at":"$NOW","metadata":{"container":{"tags":[]}}},
 {"id":2,"created_at":"$NOW","metadata":{"container":{"tags":["pr-7"]}}},
 {"id":3,"created_at":"$NOW","metadata":{"container":{"tags":["pr-8"]}}},
 {"id":4,"created_at":"$OLD","metadata":{"container":{"tags":["sha-aaaa"]}}},
 {"id":5,"created_at":"$NOW","metadata":{"container":{"tags":["sha-bbbb"]}}},
 {"id":6,"created_at":"$OLD","metadata":{"container":{"tags":["sha-cccc","pr-8"]}}},
 {"id":7,"created_at":"$OLD","metadata":{"container":{"tags":["keep-me"]}}}
]
EOF
)
got=$(printf '%s' "$fixture" | OPEN_PRS="8" KEEP_SHA_DAYS=30 bash "$HERE/ghcr-cleanup.sh" --select | sort -n | tr '\n' ' ')
# 1 untagged; 2 pr-7 closed; 4 old sha only. Kept: 3 (open pr), 5 (fresh sha), 6 (carries open pr alias), 7 (foreign tag)
[ "$got" = "1 2 4 " ] && echo "select: ok" || { echo "select: got '$got' want '1 2 4 '"; exit 1; }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker run --rm -v "$PWD:/w" -w /w alpine sh -c 'apk add -q bash jq coreutils && bash scripts/ci/ghcr-cleanup.test.sh'`
Expected: FAIL — script missing.

- [ ] **Step 3: Write the script**

```bash
#!/usr/bin/env bash
# Prune GHCR versions of this repo's images. Rules (spec §4.5):
#   - untagged versions: delete;
#   - versions whose tags are ONLY pr-<N> aliases for PRs not in OPEN_PRS: delete;
#   - versions whose tags are ONLY sha-* and older than KEEP_SHA_DAYS: delete;
#   - anything carrying any other tag (or an open PR's alias): keep.
# `--select` reads a versions JSON array on stdin and prints the ids to delete
# (used by the tests); without it, lists and deletes via `gh api`.
set -euo pipefail
GHCR_ORG=${GHCR_ORG:-webspirio}
PACKAGES=${PACKAGES:-"yagoda-starter-backend yagoda-starter-nginx"}
KEEP_SHA_DAYS=${KEEP_SHA_DAYS:-30}
OPEN_PRS=${OPEN_PRS:-}
DRY_RUN=${DRY_RUN:-false}

select_ids() {
  local cutoff
  cutoff=$(date -u -d "@$(( $(date +%s) - KEEP_SHA_DAYS*86400 ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -r "$(( $(date +%s) - KEEP_SHA_DAYS*86400 ))" +%Y-%m-%dT%H:%M:%SZ)
  jq -r --arg cutoff "$cutoff" --arg open "$OPEN_PRS" '
    ($open | split(" ") | map(select(length>0)) | map("pr-"+.)) as $openAliases
    | .[]
    | (.metadata.container.tags // []) as $tags
    | select(
        ($tags | length) == 0
        or ( ($tags | all(startswith("pr-"))) and ($tags | any(. as $t | $openAliases | index($t)) | not) )
        or ( ($tags | all(startswith("sha-"))) and (.created_at < $cutoff) )
      )
    | .id'
}

if [ "${1:-}" = --select ]; then select_ids; exit 0; fi

for pkg in $PACKAGES; do
  echo "== $pkg"
  versions=$(gh api --paginate -H "Accept: application/vnd.github+json" \
    "/orgs/$GHCR_ORG/packages/container/$pkg/versions?per_page=100" | jq -s 'add')
  ids=$(printf '%s' "$versions" | select_ids)
  [ -n "$ids" ] || { echo "nothing to prune"; continue; }
  for id in $ids; do
    tags=$(printf '%s' "$versions" | jq -r --argjson id "$id" '.[] | select(.id==$id) | .metadata.container.tags | join(",")')
    if [ "$DRY_RUN" = true ]; then echo "would delete $id [$tags]"; else
      gh api -X DELETE "/orgs/$GHCR_ORG/packages/container/$pkg/versions/$id" >/dev/null && echo "deleted $id [$tags]"
    fi
  done
done
```

- [ ] **Step 4: Run the test + shellcheck**

Run: `chmod +x scripts/ci/ghcr-cleanup.sh && docker run --rm -v "$PWD:/w" -w /w alpine sh -c 'apk add -q bash jq coreutils && bash scripts/ci/ghcr-cleanup.test.sh' && docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/ci/ghcr-cleanup.sh`
Expected: `select: ok`; shellcheck clean.

- [ ] **Step 5: The workflow**

```yaml
# .github/workflows/cleanup-images.yml
name: Cleanup images

on:
  schedule:
    - cron: '17 3 * * 1'   # Mondays 03:17 UTC
  workflow_dispatch:
    inputs:
      dry-run:
        description: Only list what would be deleted
        type: boolean
        default: true

permissions:
  contents: read
  packages: write
  pull-requests: read

jobs:
  prune:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - name: Prune GHCR
        env:
          GH_TOKEN: ${{ github.token }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry-run || 'false' }}
        run: |
          OPEN_PRS=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --limit 200 --json number --jq '[.[].number] | join(" ")')
          export OPEN_PRS
          bash scripts/ci/ghcr-cleanup.sh
```

- [ ] **Step 6: Lint the workflow**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/cleanup-images.yml`
Expected: no findings.

- [ ] **Step 7: Commit**

```bash
git add scripts/ci/ghcr-cleanup.sh scripts/ci/ghcr-cleanup.test.sh .github/workflows/cleanup-images.yml
git commit -m "$(cat <<'EOF'
Add weekly GHCR cleanup

Deletes untagged versions, pr-* aliases of closed PRs and sha-* images
older than 30 days; anything carrying another tag is kept.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `ci.yml` — the `docker` job builds on PR and main and pushes `sha-`/`pr-` tags

**Files:**
- Modify: `.github/workflows/ci.yml:1-20` (header comments, `on`), `:30-120` (`changes` filter set and its comment), `:228-285` (`docker` job)

**Interfaces:**
- Consumes: `APP_COMMIT` build-arg (Task 2).
- Produces: images `ghcr.io/webspirio/yagoda-starter-backend` and `…-nginx` tagged `sha-${{ github.sha }}` (always when pushed) and `pr-<N>` (PR only); job output `pushed` (`'true'`/`'false'`) consumed by Task 9. On PRs from forks and on skipped builds, `pushed=false`.

- [ ] **Step 1: Header — trigger and comment**

Replace lines 15–19 (the `permissions` comment + block) with:

```yaml
# The default token is read-only. The docker job raises itself to
# packages: write (it pushes to GHCR); the deploy jobs add pull-requests: write
# (sticky comment, label). Nothing else needs more than contents: read.
permissions:
  contents: read
```

- [ ] **Step 2: `changes` filter — add the deploy inputs**

In the comment block above `is_docker_input` (lines 59–69) replace the paragraph starting `# turbo.json and docker-compose*.yml are intentionally absent` with:

```yaml
        #   - docker-compose*.yml  Coolify deploys the compose file FROM THE PR
        #                          BRANCH, so it is a deploy input too
        #   - .github/workflows/** a workflow change must exercise the build
        #
        # turbo.json is intentionally absent: the Dockerfiles invoke workspace
        # builds directly. The diff is PR-wide (base...head), so once a PR
        # touches anything in this set, EVERY push to it builds — a later
        # docs-only commit does not leave a stale preview behind.
```

and change the `case` pattern to:

```bash
              backend/*|frontend/*|nginx/*|Dockerfile|*/Dockerfile|package.json|package-lock.json|.dockerignore|docker-compose*.yml|.github/workflows/*)
```

Also change `if: github.event_name == 'pull_request'` on the `changes` job — keep it (on `main` the docker job builds unconditionally).

- [ ] **Step 3: Rewrite the `docker` job** (replace everything from `  docker:` to the end of the file):

```yaml
  docker:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    # Independent from `checks` so both run in parallel. `always()` keeps this
    # job from being skipped when `changes` fails — a skipped required check
    # would hide a broken path detector.
    needs: [changes]
    if: ${{ always() }}

    # Pushes the two images to GHCR. sha-<commit> is the ONLY tag ever
    # deployed (Coolify pulls it, docs/coolify-deploy.md); pr-<N> is a human
    # convenience alias; there is deliberately no `latest`.
    #
    # Build steps run when the PR changed a Docker/deploy input, when the
    # detector did not finish (fail-closed), or on every push to main.
    # Fork PRs have no GITHUB_TOKEN write access: they build but do not push.
    permissions:
      contents: read
      packages: write

    outputs:
      pushed: ${{ steps.meta.outputs.push }}

    env:
      BUILD: >-
        ${{ github.event_name == 'push'
          || needs.changes.result != 'success'
          || needs.changes.outputs.docker == 'true' }}

    steps:
      - id: meta
        shell: bash
        env:
          IS_FORK: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository }}
          PR: ${{ github.event.pull_request.number }}
          SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
        run: |
          set -euo pipefail
          push=false
          if [ "$BUILD" = true ] && [ "$IS_FORK" != true ]; then push=true; fi
          echo "push=$push" >> "$GITHUB_OUTPUT"
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"
          # Cache scopes: PRs read prod's cache but write only their own, so
          # preview churn never evicts the seed main relies on.
          if [ "$GITHUB_EVENT_NAME" = push ]; then
            echo "scope=main" >> "$GITHUB_OUTPUT"
          else
            echo "scope=pr" >> "$GITHUB_OUTPUT"
          fi
          {
            echo "backend_tags<<EOF"
            echo "ghcr.io/${GITHUB_REPOSITORY,,}-backend:sha-$SHA"
            [ -n "$PR" ] && echo "ghcr.io/${GITHUB_REPOSITORY,,}-backend:pr-$PR"
            echo "EOF"
            echo "nginx_tags<<EOF"
            echo "ghcr.io/${GITHUB_REPOSITORY,,}-nginx:sha-$SHA"
            [ -n "$PR" ] && echo "ghcr.io/${GITHUB_REPOSITORY,,}-nginx:pr-$PR"
            echo "EOF"
          } >> "$GITHUB_OUTPUT"
          echo "build=$BUILD push=$push scope=$(grep -o 'scope=.*' "$GITHUB_OUTPUT" | tail -1) sha=$SHA"

      - uses: actions/checkout@v7
        if: env.BUILD == 'true'
        with:
          # Build the PR HEAD, not GitHub's synthetic merge commit: the image
          # is tagged sha-<head> and Coolify checks out that same head.
          ref: ${{ steps.meta.outputs.sha }}

      - uses: docker/setup-buildx-action@v4
        if: env.BUILD == 'true'

      - uses: docker/login-action@v4
        if: steps.meta.outputs.push == 'true'
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build (and push) backend image
        if: env.BUILD == 'true'
        uses: docker/build-push-action@v7
        with:
          context: .
          file: backend/Dockerfile
          target: prod
          push: ${{ steps.meta.outputs.push == 'true' }}
          tags: ${{ steps.meta.outputs.backend_tags }}
          build-args: |
            APP_COMMIT=${{ steps.meta.outputs.sha }}
          cache-from: |
            type=gha,scope=backend-main
            type=gha,scope=backend-${{ steps.meta.outputs.scope }}
          cache-to: type=gha,mode=max,scope=backend-${{ steps.meta.outputs.scope }}

      - name: Build (and push) nginx image
        if: env.BUILD == 'true'
        uses: docker/build-push-action@v7
        with:
          context: .
          file: nginx/Dockerfile
          push: ${{ steps.meta.outputs.push == 'true' }}
          tags: ${{ steps.meta.outputs.nginx_tags }}
          cache-from: |
            type=gha,scope=nginx-main
            type=gha,scope=nginx-${{ steps.meta.outputs.scope }}
          cache-to: type=gha,mode=max,scope=nginx-${{ steps.meta.outputs.scope }}
```

Also delete the old comment `# This starter ships no CD workflow, so image builds run on PRs only —` block (it is inside the replaced range).

- [ ] **Step 4: Lint**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/ci.yml`
Expected: no findings. (If actionlint objects to `${GITHUB_REPOSITORY,,}` it is shellcheck SC2296 inside actionlint — bash 4+ on ubuntu-latest supports it; add `# shellcheck disable=SC2296` above the `{` line only if flagged.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
Push CI-built images to GHCR as sha-<commit>

The docker job now runs on PRs and on main and pushes both images;
sha-<commit> is the only deployable tag, pr-<N> is an alias, no latest.
Cache scopes are split so preview builds cannot evict main's cache; the
compose files and workflows join the path filter because Coolify reads
the compose file from the PR branch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `ci.yml` — `deploy-preview` and `deploy-prod`

**Files:**
- Modify: `.github/workflows/ci.yml` (append two jobs)

**Interfaces:**
- Consumes: `needs.docker.outputs.pushed`, the composite action (Task 6), repo variable `COOLIFY_ENABLED` (`'true'` once Coolify exists — lets this land before the server is ready), secrets `COOLIFY_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID`, repo variables `PROD_URL` (`https://yagoda.webspirio.com`) and `PREVIEW_DOMAIN` (`yagoda.webspirio.com`).
- Produces: label `preview` on PRs with a live preview; sticky comment with marker `yagoda-preview`.

- [ ] **Step 1: Append the jobs**

```yaml
  # ---------------------------------------------------------------------------
  # CD. Both jobs deploy through Coolify's API and then verify the application
  # itself (scripts/ci/coolify-deploy.sh). They are gated on the repository
  # variable COOLIFY_ENABLED so the workflow is valid before the server exists.
  # ---------------------------------------------------------------------------

  deploy-preview:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [checks, db-checks, docker]
    # Internal PRs only (forks have no secrets), and only when an image for
    # this head was actually pushed. A preview is "the CI-passed commit": all
    # three jobs must be green.
    if: >-
      github.event_name == 'pull_request'
      && needs.docker.outputs.pushed == 'true'
      && vars.COOLIFY_ENABLED == 'true'
    # One preview allocation at a time across the whole repository, so the
    # cap check below cannot race another PR's deploy.
    concurrency:
      group: preview-allocation
      cancel-in-progress: false
    permissions:
      contents: read
      pull-requests: write
    env:
      # Provisional 6 (spec §1): recalibrated after Coolify's RSS is measured.
      # The repository variable PREVIEW_CAP overrides it without a commit —
      # used for recalibration and for testing the limit path.
      PREVIEW_CAP: ${{ vars.PREVIEW_CAP || 6 }}
      PR: ${{ github.event.pull_request.number }}
      HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      PREVIEW_URL: https://pr-${{ github.event.pull_request.number }}.${{ vars.PREVIEW_DOMAIN }}
      GH_TOKEN: ${{ github.token }}

    steps:
      - uses: actions/checkout@v7

      - name: Cap on live previews
        id: cap
        shell: bash
        run: |
          set -euo pipefail
          gh label create preview --color 0e8a16 --description "Has a live Coolify preview" --force >/dev/null
          live=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --label preview --limit 100 --json number --jq 'length')
          mine=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json labels --jq '[.labels[].name] | index("preview") != null')
          echo "live=$live mine=$mine cap=$PREVIEW_CAP"
          if [ "$mine" != true ] && [ "$live" -ge "$PREVIEW_CAP" ]; then
            echo "blocked=true" >> "$GITHUB_OUTPUT"
          else
            echo "blocked=false" >> "$GITHUB_OUTPUT"
          fi
          echo "live=$live" >> "$GITHUB_OUTPUT"

      - name: Comment — limit reached
        if: steps.cap.outputs.blocked == 'true'
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: yagoda-preview
          message: |
            **Preview not deployed — limit reached** (${{ steps.cap.outputs.live }}/${{ env.PREVIEW_CAP }} live previews).
            Close or merge an older PR with the `preview` label, then re-run this job.

      - name: Deploy preview
        id: deploy
        if: steps.cap.outputs.blocked != 'true'
        uses: ./.github/actions/coolify-deploy
        with:
          coolify-url: ${{ secrets.COOLIFY_URL }}
          coolify-api-token: ${{ secrets.COOLIFY_API_TOKEN }}
          app-uuid: ${{ secrets.COOLIFY_APP_UUID }}
          base-url: ${{ env.PREVIEW_URL }}
          commit: ${{ env.HEAD_SHA }}
          pr-number: ${{ env.PR }}
          # Demo credentials from backend/src/seed/dev-seed.data.ts — the seed
          # refuses NODE_ENV=production, so they never exist on prod.
          seed-username: oksana
          seed-password: operator

      - name: Comment — ready
        if: steps.cap.outputs.blocked != 'true' && success()
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: yagoda-preview
          message: |
            **Preview ready:** ${{ env.PREVIEW_URL }}
            Serving `sha-${{ env.HEAD_SHA }}` · sign in as `oksana` / `operator` (seed) · removed when this PR closes.

      - name: Label
        if: steps.cap.outputs.blocked != 'true' && success()
        run: gh pr edit "$PR" --repo "$GITHUB_REPOSITORY" --add-label preview

      - name: Comment — failed
        if: steps.cap.outputs.blocked != 'true' && failure()
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: yagoda-preview
          message: |
            **Preview deploy failed** for `sha-${{ env.HEAD_SHA }}` — see the `deploy-preview` job log.
            ${{ env.PREVIEW_URL }} may be serving an older commit.

  deploy-prod:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [checks, db-checks, docker]
    if: >-
      github.event_name == 'push'
      && github.ref == 'refs/heads/main'
      && needs.docker.outputs.pushed == 'true'
      && vars.COOLIFY_ENABLED == 'true'
    concurrency:
      group: deploy-prod
      cancel-in-progress: false
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/coolify-deploy
        with:
          coolify-url: ${{ secrets.COOLIFY_URL }}
          coolify-api-token: ${{ secrets.COOLIFY_API_TOKEN }}
          app-uuid: ${{ secrets.COOLIFY_APP_UUID }}
          base-url: ${{ vars.PROD_URL }}
          commit: ${{ github.sha }}
```

- [ ] **Step 2: Lint**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/ci.yml`
Expected: no findings.

- [ ] **Step 3: Sanity-check the skipped-build comment path**

The spec (§4.4) asks that a push whose build is skipped edits the comment. With `needs.docker.outputs.pushed == 'false'` the whole job is skipped, so add a tiny third job **before** `deploy-prod`:

```yaml
  preview-note-skipped:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: [docker]
    # The PR already had a preview (label) but this push changed nothing
    # deployable: say so instead of leaving a comment that implies the head is live.
    if: >-
      github.event_name == 'pull_request'
      && needs.docker.outputs.pushed == 'false'
      && contains(github.event.pull_request.labels.*.name, 'preview')
      && vars.COOLIFY_ENABLED == 'true'
    permissions:
      pull-requests: write
    steps:
      - uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: yagoda-preview
          message: |
            **Preview unchanged:** this push (`${{ github.event.pull_request.head.sha }}`) touched no deployable path, so
            https://pr-${{ github.event.pull_request.number }}.${{ vars.PREVIEW_DOMAIN }} still serves the previous deployed commit.
```

Re-run actionlint.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
Add Coolify deploy jobs for previews and production

deploy-preview runs after all three CI jobs for internal PRs, serializes
preview allocation, caps live previews by the `preview` label, and only
reports ready once the app answers /ready, serves the expected commit and
accepts a seeded login. deploy-prod does the same on push to main. Both
are gated on the COOLIFY_ENABLED repository variable.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Documentation — runbook and updated docs

**Files:**
- Create: `docs/coolify-deploy.md`
- Modify: `docs/vps-tls-setup.md:1-14, 124-133`, `docs/backup-restore.md:34-89`, `CLAUDE.md` («Deployment»), `backend/CLAUDE.md:153`, `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (append)

- [ ] **Step 1: Write `docs/coolify-deploy.md`**

```markdown
# Deploying with Coolify (production + PR previews)

The server `188.245.146.122` (Hetzner, 2 vCPU / 3.7 GiB, Ubuntu 26.04) runs
Coolify. Coolify does **not** build anything: `.github/workflows/ci.yml`
builds both images on every commit and pushes them to GHCR as
`sha-<commit>`; Coolify pulls that tag and runs `docker-compose.prod.yml`.
Design: `docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md`.

| Hostname | What |
|---|---|
| `https://yagoda.webspirio.com` | production (`main`) |
| `https://pr-<N>.yagoda.webspirio.com` | preview of PR `N`, seeded, removed on close |
| `https://coolify.yagoda.webspirio.com` | the Coolify panel |

## How a deploy happens

1. CI (`docker` job) pushes `ghcr.io/webspirio/yagoda-starter-{backend,nginx}:sha-<commit>`.
2. `deploy-prod` (push to `main`) or `deploy-preview` (internal PR, all CI jobs green)
   calls `POST /api/v1/deploy` on Coolify (`scripts/ci/coolify-deploy.sh`).
3. Coolify checks out the commit, sets `SOURCE_COMMIT`, and runs
   `docker compose up` on `docker-compose.prod.yml`, whose `image:` lines resolve
   to `sha-${SOURCE_COMMIT}`.
4. The job waits for Coolify, then checks `/api/health/ready`,
   `/api/health/version == sha-<commit>` and (previews) a seeded login, and only
   then comments «Preview ready» / passes.

Coolify's own auto-deploy is **off**; CI is the only trigger, so Coolify never
pulls a tag that has not been pushed yet. Previews are removed by Coolify's
GitHub App webhook when the PR closes.

## One-time server setup (done 2026-09-…; repeat only for a new server)

1. **Hetzner Cloud Firewall** (console): inbound TCP 22, 80, 443 only. Do this
   *before* installing Coolify — Docker publishes ports past UFW, and the panel
   would otherwise sit on `:8000` over plain HTTP.
2. `scp scripts/vps/bootstrap.sh root@188.245.146.122:/root/ && ssh root@188.245.146.122 bash /root/bootstrap.sh`
   (2 GB swap, `vm.swappiness=10`, `curl git jq`, `/data/backups`).
3. Coolify, unattended so nobody can grab the first-admin slot:
   ```bash
   ssh root@188.245.146.122 'PASS=$(openssl rand -base64 24); umask 077; printf "user=owner\nemail=<owner email>\npassword=%s\n" "$PASS" > /root/coolify-root-credentials; \
     env ROOT_USERNAME=owner ROOT_USER_EMAIL=<owner email> ROOT_USER_PASSWORD="$PASS" AUTOUPDATE=false \
     bash -c "curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"'
   ```
   Then in the panel (reach it once over an SSH tunnel: `ssh -N -L 8000:localhost:8000 root@188.245.146.122` → `http://localhost:8000`): *Settings → Instance domain* = `https://coolify.yagoda.webspirio.com`. Change the root password.
   `AUTOUPDATE=false`: update Coolify deliberately (Settings → Update) after reading its release notes.
4. **GitHub App** (Coolify → *Sources → + GitHub App*): organization `webspirio`,
   enable **Preview Deployments**; install it on `yagoda-starter` only.
5. **Registry credential for pulls.** Preferred: Coolify → *Settings → Docker
   registries* (if present in the installed version) → `ghcr.io`, a PAT with
   `read:packages`. Fallback: on the server
   `echo "<PAT>" | docker login ghcr.io -u <github user> --password-stdin`
   (credential lands in `/root/.docker/config.json`, mode 600). Either way note
   the PAT's **expiry date** here: `…`. Rotation: create the new PAT, repeat the
   login, then `docker pull ghcr.io/webspirio/yagoda-starter-nginx:sha-<any recent>` must succeed.
   GHCR PATs are *classic* tokens — fine-grained tokens cannot read packages.
6. **Application** (Coolify → project *yagoda* → *+ New → Private repository (GitHub App)*):
   repo `webspirio/yagoda-starter`, branch `main`, build pack **Docker Compose**,
   compose location `/docker-compose.prod.yml`. Then:
   - *General*: domain for service `nginx` = `https://yagoda.webspirio.com`; **Auto Deploy: off**;
     *Preview Deployments*: on, URL template `pr-{{pr_id}}.yagoda.webspirio.com`.
   - *Advanced*: **Include Source Commit** (`SOURCE_COMMIT`) on.
   - *Environment Variables* — production and preview sets below.
   - Traefik body size: *Custom labels* on `nginx` →
     `traefik.http.middlewares.yagoda-body.buffering.maxRequestBodyBytes=12582912`
     and `traefik.http.routers.<router>.middlewares=yagoda-body` (uploads are 10 MB; the
     internal nginx already allows 12 MB).
7. **GitHub repository settings**: secrets `COOLIFY_URL`, `COOLIFY_API_TOKEN`
   (Coolify → *Keys & Tokens → API tokens*, permissions `deploy` + `read`; add `write`
   only if the fallback below is in force), `COOLIFY_APP_UUID` (from the application URL);
   variables `COOLIFY_ENABLED=true`, `PROD_URL=https://yagoda.webspirio.com`,
   `PREVIEW_DOMAIN=yagoda.webspirio.com`.
8. **Backups**: `scp scripts/vps/backup.sh root@…:/usr/local/bin/yagoda-backup.sh`,
   the two unit files to `/etc/systemd/system/`, `yagoda-backup.env.example` → `/etc/yagoda-backup.env`
   (fill `PG_CONTAINER`, `UPLOADS_VOLUME` from `docker ps` / `docker volume ls`), then
   `systemctl daemon-reload && systemctl enable --now yagoda-backup.timer && systemctl start yagoda-backup.service`.
   Pairs land in `/data/backups`; restore per `docs/backup-restore.md`.

## Environment variables in Coolify

| Variable | Production | Preview | Note |
|---|---|---|---|
| `APP_URL` | `https://yagoda.webspirio.com` | `https://pr-{{pr_id}}.yagoda.webspirio.com`¹ | CORS allowlist |
| `JWT_SECRET` | 48+ random chars | different 48+ random chars | `openssl rand -base64 48` |
| `DB_PASSWORD` | random | random | |
| `BOOTSTRAP_OWNER_LOGIN` / `_PASSWORD` / `_FIRST_NAME` / `_LAST_NAME` | the real owner | `owner` / `preview-owner-1` / `Preview` / `Owner` | read once, on the first boot of an empty DB |
| `SEED_DEV_DATA` | *(absent)* | `true` | enables the one-shot `seed` service |
| `IMAGE_TAG` | *(absent)* | *(absent)* | **never set** unless the fallback below is in force |

¹ Coolify substitutes `{{pr_id}}` in the preview URL template; whether it does so
inside env values is checked in the spike. If it does not, set the preview
`APP_URL` to `https://yagoda.webspirio.com`: `APP_URL` only feeds the CORS
allowlist, and the SPA calls the API same-origin, so nothing user-visible
changes — only a cross-origin call to a preview API would be refused.

## When development slows down

Turn **Preview Deployments** off in the application (Coolify removes any live
previews on their PRs' close as before). Nothing else changes: Coolify keeps
running production, renewing TLS and taking the nightly backups. To leave
Coolify altogether, see the last section.

## Spike results (fill in during setup — spec §3.1 gates)

| Gate | Result |
|---|---|
| `SOURCE_COMMIT` interpolates in compose | |
| Preview `SOURCE_COMMIT` == PR head SHA | |
| Manual «Redeploy» keeps the same SHA | |
| Preview deleted on PR close with Auto Deploy off | |
| API lists previews (cap source) | |
| Coolify holds registry credentials | |

**Fallback (only if a `SOURCE_COMMIT` gate failed):** CI sets `IMAGE_TAG` in the
relevant env set via `PATCH /api/v1/applications/<uuid>/envs` right before
`deploy`, under the same `concurrency` group. Then **never press «Redeploy» on a
preview in the Coolify UI** — it would use whichever PR wrote `IMAGE_TAG` last;
re-run the PR's `deploy-preview` job instead. The `/api/health/version` check
turns a wrong image into a failed job, not a silent wrong preview.

## When a deploy goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `deploy-*` job: «image pull failed — check the GHCR credential» | PAT expired / removed | Rotate per step 5 |
| `deploy-*` job: Coolify `failed`, log shows compose error | compose file in that branch is invalid | `docker compose -f docker-compose.prod.yml config` locally |
| `serves commit 'X', expected 'Y'` | Coolify deployed another commit (fallback misuse, or Auto Deploy got switched on) | Check Auto Deploy is off; re-run the job |
| `/ready` never 200 | backend crash-loop | Coolify → application → logs; usually a missing env var |
| «Preview not deployed — limit reached» | 6 live previews | close/merge an older PR |
| Prod is wrong after a merge | | `git revert <merge>` + push. **This does not revert schema migrations** — see `docs/backup-restore.md` to restore last night's pair if a migration destroyed data. |

## Leaving Coolify

Same images, same compose: `docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d`
with `IMAGE_TAG=sha-<commit>` in `.env`, host nginx + Certbot per `docs/vps-tls-setup.md`,
data moved with `docs/backup-restore.md`. About 30 minutes.
```

- [ ] **Step 2: `docs/vps-tls-setup.md`** — replace lines 1–8 with:

```markdown
# VPS TLS termination without Coolify (host nginx + Certbot)

**Primary deployment is Coolify** (`docs/coolify-deploy.md`), whose Traefik
terminates TLS. This doc is the exit path: a plain VPS running
`docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml`,
which publishes the internal nginx on `127.0.0.1:8080`. A host-level terminator
has to sit in front of it to serve the app over HTTPS. This doc covers that
piece: host nginx + Certbot (Let's Encrypt) on Ubuntu.
```

and in §6 replace ``(`docker compose -f docker-compose.prod.yml up -d`)`` with ``(`IMAGE_TAG=sha-<commit> docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d`)``.

- [ ] **Step 3: `docs/backup-restore.md`** — replace the «Nightly backup with cron + pg_dump + tar» section (lines 34–89) with:

```markdown
## Nightly backup

`scripts/vps/backup.sh` (installed as `/usr/local/bin/yagoda-backup.sh` by the
Coolify runbook, run by `yagoda-backup.timer` at 02:30) takes ONE logical
snapshot: a `pg_dump` and a tar of the uploads volume under a single `STAMP`,
written as `.partial` files and renamed into place only when both succeeded and
verified — the directory never holds an unmatched half. `flock` keeps a manual
`systemctl start yagoda-backup.service` from overlapping the timer. Retention
(14 days) prunes by pair. Configuration lives in `/etc/yagoda-backup.env`
(`PG_CONTAINER`, `UPLOADS_VOLUME` — Coolify names them `postgres-<uuid>` and
`<uuid>_uploads_data`; check with `docker ps` / `docker volume ls`).

Output: `/data/backups/<STAMP>-db.sql.gz` + `/data/backups/<STAMP>-uploads.tar.gz`.

On a VPS without Coolify the same script works with the standalone stack's
names (`yagoda-prod-postgres-1`, `yagoda-prod_uploads_data`).
```

In the restore section, replace each `docker compose -f docker-compose.prod.yml exec -T postgres` with `docker exec -i "$PG_CONTAINER"` and `docker compose -f docker-compose.prod.yml stop backend` / `up -d backend` with a note: «under Coolify, stop/start the `backend` service from the application page (or `docker stop <backend-container>`)»; replace `web-starter-prod_uploads_data` with `"$UPLOADS_VOLUME"`.

- [ ] **Step 4: `CLAUDE.md`** — replace the «Deployment» section with:

```markdown
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
`docs/vps-tls-setup.md`. Whatever sits in front must allow request bodies of
at least ~12 MB: the app accepts image uploads up to 10 MB, and a smaller
limit returns 413 before the request reaches the app (Traefik: `buffering.maxRequestBodyBytes`; nginx: `client_max_body_size`).
```

- [ ] **Step 5: `backend/CLAUDE.md:153`** — in the multi-replica caveat replace «This starter ships no CD pipeline, so there is no automated pre-flight migration step;» with «CD deploys through Coolify (`docs/coolify-deploy.md`) with a single replica and no separate migration step;».

- [ ] **Step 6: Follow-ups** — append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown
## Learned from the Coolify deployment (2026-09-09)

- **Pre-migration `pg_dump` is required before the first destructive
  migration** (drop/rename column, type change, data rewrite). An image
  rollback (`git revert`) does not roll the schema back. Planned as a one-shot
  `predeploy-dump` compose service gated by `PREDEPLOY_DUMP=true` in the
  production env set, on which `backend` `depends_on … service_completed_successfully`
  — spec §9.
- **Off-box copy of `/data/backups`** — Hetzner Storage Box (rclone/sftp) or
  restic to S3; `docs/backup-restore.md` lists both. Until then a lost disk
  loses the backups too.
- **DBLab** — revisit when the production database exceeds ~1–2 GB, on a
  separate ≥ 8 GiB machine (ZFS/LVM pool, ARC capped).
- **Monitoring** — Coolify Sentinel + Telegram notifications; nothing alerts
  today when prod goes down.
- **Preview cap is a repo constant** (`PREVIEW_CAP` in `ci.yml`); recheck it
  against the measured Coolify RSS whenever Coolify is updated.
```

- [ ] **Step 7: Check links and commit**

Run: `grep -n "web-starter" CLAUDE.md docs/*.md docker-compose*.yml | grep -v superpowers || echo "no stale names"`
Expected: `no stale names` (or only intentional mentions).

```bash
git add docs/coolify-deploy.md docs/vps-tls-setup.md docs/backup-restore.md CLAUDE.md backend/CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "$(cat <<'EOF'
Document the Coolify deployment and update the standalone docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Review Phase A and open the draft PR (images start flowing)

**Files:** none new.

- [ ] **Step 1: Full local verification**

Run: `npm run lint && npm test && npm run build && docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: all green.

- [ ] **Step 2: Fresh-context code review** — invoke `superpowers:requesting-code-review` on `main..feat/coolify-deployment` with the spec path; fix blocking findings, commit each fix separately.

- [ ] **Step 3: Push and open a DRAFT PR** — the PR is needed *now* so the `docker` job pushes `sha-<head>` images that Task 15's spike deploys.

```bash
git push -u origin feat/coolify-deployment
gh pr create --draft --base main --title "Coolify deployment and CD (closes #10)" --body "$(cat <<'EOF'
## Summary
- CI builds both images once per commit and pushes `sha-<commit>` to GHCR; Coolify only pulls.
- `deploy-prod` on push to main, `deploy-preview` on green internal PRs (seeded, capped, verified against the app).
- `docker-compose.prod.yml` becomes the single Coolify-ready compose; `docker-compose.standalone.yml` keeps the no-Coolify path.
- Backend: empty `BOOTSTRAP_OWNER_*` no longer crash-loops; `GET /health/version`.
- Server scripts: bootstrap (swap), atomic nightly backup + timer.
- Runbook `docs/coolify-deploy.md`; spec `docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md`.

Deploy jobs are gated on the `COOLIFY_ENABLED` repository variable (unset until the server is ready).

## Test plan
- [ ] CI green; `docker` job pushed `sha-<head>` for both images (GHCR packages visible)
- [ ] Server: Tasks 12–16 of the plan (spike gates recorded in the runbook)
- [ ] Preview for this PR reaches «Preview ready», second push reseeds with 0 rows
- [ ] After merge: prod `/api/health/version` == merge SHA

Closes #10

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm the images exist**

Watch the run: `gh run watch --exit-status` then `gh api "/orgs/webspirio/packages/container/yagoda-starter-backend/versions" --jq '.[0].metadata.container.tags'`
Expected: contains `sha-<head sha>` and `pr-<N>`. If the first push is refused (`denied: installation not allowed to Create organization package`), the org owner must allow package creation for Actions in *Organization → Settings → Packages*; re-run the job.

---

## Phase B — server (each mutating step after the owner's go-ahead)

### Task 12: Firewall (owner) and host bootstrap

- [ ] **Step 1: Owner — Hetzner Cloud Firewall.** Ask: «Створи в Hetzner Console → Firewalls правило для сервера: inbound TCP 22, 80, 443 (з `0.0.0.0/0` та `::/0`), більше нічого; outbound — усе. Напиши, коли готово.» Verify from here: `nc -zv -w3 188.245.146.122 22` succeeds; `nc -zv -w3 188.245.146.122 8000` is refused/times out.

- [ ] **Step 2: Bootstrap** (after go-ahead)

```bash
scp scripts/vps/bootstrap.sh root@188.245.146.122:/root/bootstrap.sh
ssh root@188.245.146.122 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq && bash /root/bootstrap.sh'
ssh root@188.245.146.122 'swapon --show; sysctl vm.swappiness; ls -ld /data/backups'
```
Expected: `/swapfile … 2G`, `vm.swappiness = 10`, the directory exists. If the kernel was upgraded, reboot (`ssh root@… reboot`, wait, reconnect) before Task 13.

### Task 13: Coolify — unattended install and panel domain

- [ ] **Step 1: Owner input needed:** the admin e-mail for the Coolify root user.

- [ ] **Step 2: Install** (after go-ahead) — the command from the runbook step 3 with the owner's e-mail substituted. Takes ~3–5 min. Expected tail: `Congratulations! Your Coolify instance is ready to use.` Then:

```bash
ssh root@188.245.146.122 'docker ps --format "table {{.Names}}\t{{.Status}}"; cat /root/coolify-root-credentials'
```
Expected: `coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime`, `coolify-proxy` running (and `coolify-sentinel` if enabled).

- [ ] **Step 3: Panel over a tunnel and instance domain.** Open `ssh -N -L 8000:localhost:8000 root@188.245.146.122`; the **owner** logs in at `http://localhost:8000` with the credentials from step 2, sets *Settings → Instance's domain* to `https://coolify.yagoda.webspirio.com`, saves, and changes the root password. Verify: `curl -sI https://coolify.yagoda.webspirio.com | head -1` → `HTTP/2 200` (Let's Encrypt may take a minute).

- [ ] **Step 4: Record** the hostname/date in `docs/coolify-deploy.md` «One-time server setup (done …)» and commit on the branch.

### Task 14: Application in Coolify

- [ ] **Step 1: Owner — GitHub App and tokens** (runbook steps 4, 5, 7 minus the app UUID). The API token's permissions: `deploy` + `read` for now.

- [ ] **Step 2: Assistant — create the application** per runbook step 6, **but with branch `feat/coolify-deployment`** for the spike (switch to `main` in Task 17). Fill the non-secret rows of both env sets; the **owner enters the secret values** (`JWT_SECRET`, `DB_PASSWORD`, `BOOTSTRAP_OWNER_PASSWORD`) directly in the Coolify UI. Put the application UUID into the GitHub secret `COOLIFY_APP_UUID` and set the repository variables `PROD_URL`, `PREVIEW_DOMAIN`. **Leave `COOLIFY_ENABLED` unset until Task 15 passes.**

### Task 15: The spike — §3.1 gates

- [ ] **Step 1: Production-style deploy of the branch head.** In Coolify press *Deploy*. Watch the log; expected: images pulled as `ghcr.io/webspirio/yagoda-starter-backend:sha-<branch head>` — if the log shows `:sha-` (empty) → gate 1 **failed**. Then `curl -s https://yagoda.webspirio.com/api/health/version` must equal the branch head (`git rev-parse HEAD`).

- [ ] **Step 2: Preview of the draft PR.** Coolify → application → *Preview Deployments* → deploy for the PR number of the draft PR (Task 11). Expected: `https://pr-<N>.yagoda.webspirio.com/api/health/version` == PR head SHA (**gate 2**); login `oksana`/`operator` returns 200 (seed ran). Push an empty commit to the branch (`git commit --allow-empty -m "spike: second head" && git push`), wait for CI to push its image, redeploy the preview from the UI: version must now equal the **new** head (**gate 3**: a manual redeploy follows the current commit, not a stale one).

- [ ] **Step 3: Two previews do not collide; a closed PR's preview disappears.** Open a second throwaway draft PR **from the feature branch** (so its CI has the new `docker` job and pushes an image): `git checkout -b spike/second feat/coolify-deployment && git commit --allow-empty -m "spike: second preview" && git push -u origin spike/second && gh pr create --draft --fill --base main`. When its `docker` job has pushed, deploy its preview from Coolify's *Preview Deployments* page. Both `pr-<N>` hostnames answer 200 on `/api/health/ready`. Then close that PR (`gh pr close --delete-branch`): within a minute `ssh root@… docker ps` shows no `*-pr-<N2>` containers and `docker volume ls` no `*pr-<N2>*` volumes (**gate 4**, with Auto Deploy off).

- [ ] **Step 4: API surface.** `curl -s -H "Authorization: Bearer $TOKEN" https://coolify.yagoda.webspirio.com/api/v1/applications/<uuid> | jq 'keys'` — note whether previews are listed (**gate 5**); note whether *Settings* has a Docker registries page (**gate 6**).

- [ ] **Step 5: Record and act.** Fill the «Spike results» table in `docs/coolify-deploy.md`. Then:
  - all `SOURCE_COMMIT` gates pass → nothing changes; token stays `deploy`+`read`.
  - a `SOURCE_COMMIT` gate fails → add to `scripts/ci/coolify-deploy.sh`, before the trigger: `curl -sS -X PATCH "${AUTH[@]}" -H 'content-type: application/json' -d "{\"key\":\"IMAGE_TAG\",\"value\":\"sha-$EXPECTED_COMMIT\",\"is_preview\":${PR_NUMBER:+true}${PR_NUMBER:-false}}" "$COOLIFY_URL/api/v1/applications/$COOLIFY_APP_UUID/envs"`, extend the test with a canned `/envs` response asserting the call order, give the token `write`, and move `deploy-prod` into the `preview-allocation` concurrency group as well (both writers share `IMAGE_TAG` semantics only for previews, but serializing all deploys is the simpler invariant).
  - gate 4 fails → add `closed` to `on.pull_request.types`, guard every existing job with `github.event.action != 'closed'`, and add a `preview-remove` job that calls `DELETE /api/v1/applications/<uuid>/previews/<pr>` (confirm the exact path in the API docs of the installed version).
  - gate 5 passes → replace the label count in `deploy-preview` with the API count (keep the label as the visible mirror).
  Commit these adjustments on the branch; CI re-pushes the images.

- [ ] **Step 6: Enable CD.** `gh variable set COOLIFY_ENABLED --body true`. Push an empty commit; expected: `deploy-preview` on the draft PR reaches «Preview ready» with the label added.

### Task 16: Backups on the server and the Coolify RSS measurement

- [ ] **Step 1: Install** (after go-ahead) — runbook step 8 with the real container/volume names:

```bash
ssh root@188.245.146.122 'docker ps --format "{{.Names}}" | grep postgres; docker volume ls --format "{{.Name}}" | grep uploads'
scp scripts/vps/backup.sh root@188.245.146.122:/usr/local/bin/yagoda-backup.sh
scp scripts/vps/yagoda-backup.service scripts/vps/yagoda-backup.timer root@188.245.146.122:/etc/systemd/system/
scp scripts/vps/yagoda-backup.env.example root@188.245.146.122:/etc/yagoda-backup.env
ssh root@188.245.146.122 'chmod +x /usr/local/bin/yagoda-backup.sh; chmod 600 /etc/yagoda-backup.env; sed -i "s/^PG_CONTAINER=.*/PG_CONTAINER=<prod postgres container>/; s/^UPLOADS_VOLUME=.*/UPLOADS_VOLUME=<prod uploads volume>/" /etc/yagoda-backup.env; systemctl daemon-reload; systemctl enable --now yagoda-backup.timer; systemctl start yagoda-backup.service; ls -l /data/backups; systemctl list-timers yagoda-backup.timer'
```
Expected: one pair in `/data/backups`, timer scheduled for 02:30.

- [ ] **Step 2: Measure Coolify and recompute the cap**

```bash
ssh root@188.245.146.122 'docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" | grep -E "coolify|NAME"; free -m'
```
Sum the `coolify-*` rows. Cap = floor((3700 − 430 − Coolify − 200 − 900) / 200), bounded to [2, 8]. If it differs from 6: `gh variable set PREVIEW_CAP --body <n>` takes effect immediately; also change the default in `ci.yml` (`vars.PREVIEW_CAP || 6`) and the spec's §1 row so the repo documents the real number, and commit.

## Phase C — acceptance and PR

### Task 17: End-to-end acceptance (spec §6)

- [ ] **Step 1: Switch the Coolify application's branch to `main`** (after go-ahead), Auto Deploy still off.
- [ ] **Step 2: Preview path** — already exercised in Task 15/16: confirm the draft PR's comment shows «Preview ready» for the current head and the `preview` label is present; push a one-line docs-only commit and confirm the `preview-note-skipped` comment appears **only if** the PR-wide diff has no deployable paths (it does have them, so the build runs — confirm the comment updates to the new SHA instead).
- [ ] **Step 3: Mark the PR ready and merge** (owner's call; squash or merge per repo habit). Watch `deploy-prod`: `https://yagoda.webspirio.com/api/health/version` == merge SHA; owner signs in as the bootstrap owner.
- [ ] **Step 4: Rollback drill.** On `main`: `git commit --allow-empty -m "rollback drill" && git push` → prod redeploys to that SHA; then `git revert --no-edit HEAD && git push` → `/api/health/version` returns the revert commit's SHA and the app is unchanged. (Two prod deploys; both should complete in < 5 min.)
- [ ] **Step 5: Preview removal.** Confirm the merged PR's preview is gone (`docker ps` on the server, hostname returns Traefik 404).
- [ ] **Step 5a: Cap negative path** (before the PR is merged, while it still has the `preview` label): `gh variable set PREVIEW_CAP --body 0`, remove the label (`gh pr edit <N> --remove-label preview`), push an empty commit → the sticky comment must read «Preview not deployed — limit reached (0/0…)» and the job must end green (exit 0). Then `gh variable delete PREVIEW_CAP`, push another empty commit → «Preview ready» and the label is back. (With the label present a PR is never blocked by the cap on its own redeploy — that path was exercised by every earlier push.)
- [ ] **Step 6: Restore drill** (server): `ssh root@…`, take the latest pair, `docker exec -i <postgres> psql -U app -d postgres -c 'CREATE DATABASE drill;'`, `gunzip -c <db> | docker exec -i <postgres> psql -U app -d drill -q`, `docker exec <postgres> psql -U app -d drill -c 'select count(*) from users;'` → a number; `docker exec <postgres> psql -U app -d postgres -c 'DROP DATABASE drill;'`.

### Task 18: Close out

- [ ] **Step 1:** Ask the owner before commenting on issue #10; if yes: `gh issue comment 10 --body "Deployed via Coolify — runbook in docs/coolify-deploy.md, design in docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md. Prod: https://yagoda.webspirio.com. Previews: pr-<N>.yagoda.webspirio.com."` (the PR's «Closes #10» closes it on merge).
- [ ] **Step 2:** Delete the scratchpad images/containers created by Tasks 3 and 5 (`docker rmi ghcr.io/webspirio/yagoda-starter-*:sha-localtest yagoda-backend:t2`).
- [ ] **Step 3:** Save a memory note (feedback type) if the owner expressed preferences during Phase B worth keeping (e.g., how they want server steps confirmed).
