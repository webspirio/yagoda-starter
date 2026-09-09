# Coolify Deployment & CD — Design Spec

**Date:** 2026-09-09
**Closes:** GitHub issue #10 «CD / Deployment» (server bought 2026-09-09; DNS for `yagoda.webspirio.com` and `*.yagoda.webspirio.com` already resolves to `188.245.146.122`).
**Builds on:** `docker-compose.prod.yml`, `.github/workflows/ci.yml`, `docs/vps-tls-setup.md`, `docs/backup-restore.md` — all of which this spec reshapes rather than replaces.
**Mode:** brainstormed with the owner on 2026-09-09; every choice below was confirmed in that conversation. Numbers come from measurements taken that day (§2), not estimates, except where marked *estimate*.

## 0. Goal

A merge to `main` puts the app on `https://yagoda.webspirio.com` without anyone touching the server; every internal pull request gets its own `https://pr-<N>.yagoda.webspirio.com` with seeded demo data and disappears when the PR closes. The server keeps running production after development slows down, with nightly backups and a documented exit path that does not depend on Coolify.

Not in scope (§9): DBLab, release-tag deploys, pre-deploy `pg_dump` from the pipeline, off-box backup copies, monitoring/alerts.

## 1. Decisions, in one table

| Question | Decision | Why |
|---|---|---|
| Who terminates TLS and routes subdomains | Coolify's built-in Traefik | Wildcard DNS is already there; Let's Encrypt renewals, per-PR hostnames and the dashboard come for free. `docs/vps-tls-setup.md` (host nginx + Certbot) stays as the *exit path*, not the primary. |
| Where images are built | **GitHub Actions → GHCR. Coolify only pulls.** | The server has 2 vCPU / 3.7 GiB and no swap. A single image build peaks at 0.6–0.85 GiB and both images build concurrently under `docker compose build` (~1.5 GiB) — on the server that caps previews at ~3 and stalls production for minutes on every push. CI already builds both images on every PR with a GHA layer cache and throws them away (`push: false`). Pushing them makes one build serve CI, preview and prod, keeps artifacts in GHCR (so Coolify is replaceable), and gives immutable `sha-` tags. `travel-crm` reached the same decision after trying server builds (`docs/DEPLOY.md` there). |
| Postgres | **Inside the compose stack**, one per environment | One compose file must serve prod and previews (Coolify deploys a preview from the same file in the PR branch), and previews need their own DB. Coolify's scheduled backups only cover its standalone Database resources and would not cover `uploads_data`, which `docs/backup-restore.md` shows must be backed up *with* the DB. Attaching a compose stack to a Coolify DB needs a second network on every container — exactly the multi-network setup Coolify documents as a cause of intermittent HTTPS failures. |
| Backups | Nightly systemd timer on the host: `pg_dump` + `tar` of `uploads_data` to `/data/backups`, 14-day retention | The existing doc's script, adapted to Coolify's container/volume names. Off-box copy deferred (§9). |
| Production trigger | **Automatic on `push: main`**, after all three CI jobs pass | Two-person team in active development; `main` is already kept deployable by the stack-merge workflow. Release-tag deploys are a one-line trigger change later. |
| Preview data | **Seeded** via a one-shot `seed` service enabled by `SEED_DEV_DATA=true` in the *preview* env set | A CRM preview without data tests the login form, not the feature. `dev-seed.cli.js` is already in the prod image (`nest build` compiles `src/seed/`), refuses `NODE_ENV=production`, and accepts `postgres` as a local host. |
| Hostnames | `yagoda.webspirio.com` prod · `coolify.yagoda.webspirio.com` panel · `pr-<N>.yagoda.webspirio.com` previews | Confirmed by the owner. Panel port `:8000` is closed by the Hetzner Cloud Firewall once the domain works. |
| Concurrent previews | **Cap of 6**, enforced in CI | §2: ~1 GiB of headroom stays without touching swap. One constant in `cd.yml`. |
| After development ends | Coolify stays as the prod runtime; preview deployments are switched off | ~0.9 GiB of overhead buys TLS renewal, dashboard, one-click redeploy. The server is already Hetzner's cheapest x86 tier, so freeing RAM saves nothing. The exit path (§7) stays documented. |

## 2. Capacity — measured 2026-09-09

Server: Hetzner `ubuntu-4gb-nbg1-3`, Ubuntu 26.04.1, 2 vCPU, 3.7 GiB RAM, 0 swap, 38 GB disk (35 free), nothing installed, only port 22 open, OS idle 0.43 GiB.

Prod images built from `main` HEAD (`0b296d2`), run with `docker-compose.prod.yml` locally:

| Container | idle RSS | after 300 requests incl. 60 scrypt logins |
|---|---|---|
| backend | 97 MiB | 108 MiB |
| postgres:16-alpine | 28 MiB | 28 MiB |
| redis:7-alpine | 9 MiB | 9 MiB |
| nginx (+ SPA) | 12 MiB | 13 MiB |
| **stack** | **~150 MiB** | **~160 MiB** |

Planning figure per stack: **0.2 GiB** (heap growth under real traffic). Image sizes: backend 487 MB, nginx 93 MB; `node_modules` layers are shared across tags until the lockfile changes.

Build peaks (cgroup `memory.peak`, `node:24-alpine`): frontend 816 MiB (`npm ci` alone 623), backend 603 MiB (all of it `npm ci`). This is why builds do not happen on the server.

Budget: 3.7 − 0.43 (OS) − ~0.9 (Coolify: coolify, coolify-db, coolify-redis, coolify-realtime, coolify-proxy, sentinel — *estimate*, re-measured in Plan task «measure Coolify») − 0.2 (prod) ≈ **2.1 GiB** → 6 previews use 1.2 GiB and leave ~0.9 GiB before swap. A 2 GB swapfile is a safety net, not a working mode.

## 3. Deployment flow

```
PR push ──► CI: checks │ db-checks │ docker (build + push GHCR: sha-<commit>, pr-<N>)
                                           └─► deploy-preview: cap ≤ 6 → Coolify API deploy(uuid, pr=N)
                                               → poll deployment → sticky PR comment with URL
main push ─► CI: all three green ──────────► deploy-prod: Coolify API deploy(uuid)
                                               → poll deployment → curl /api/health/ready
PR closed ─► Coolify GitHub App webhook ──► preview removed (containers, volumes, hostname)
```

### 3.1 How Coolify learns the image tag

The compose file references `image: ghcr.io/${GHCR_REPO:-webspirio/yagoda-starter}-backend:sha-${SOURCE_COMMIT}`. Coolify documents `SOURCE_COMMIT` (opt-in per application) as the commit it has just checked out — the PR head for a preview, `main` for prod. If it is available to compose `${}` interpolation, every deploy — including a manual «Redeploy» in the UI — pulls exactly its own image and there is no shared state.

**This is verified by the first server-side task of the plan (a 15-minute spike on the live instance).** Fallback if interpolation does not work: an `IMAGE_TAG` variable in the Coolify env set, written by CI through `PATCH /api/v1/applications/{uuid}/envs` (`is_preview` for previews) immediately before `deploy`, with the two calls wrapped in an Actions `concurrency: coolify-deploy` group (no cancel) so set+deploy is atomic across the repo. The fallback works but makes «Redeploy» from the UI unsafe for previews (it would use whichever PR wrote `IMAGE_TAG` last); the runbook states this if the fallback is chosen.

### 3.2 Races

Coolify's own webhook-triggered deploys are **off**. The only deploy trigger is CI, which runs after the image is pushed, so Coolify never pulls a tag that does not exist yet. The GitHub App webhook still deletes the preview on PR close; the spike confirms that deletion is not gated by the auto-deploy switch — if it is, a `pull_request: closed` job in `cd.yml` deletes the preview through the API instead.

### 3.3 Authentication and secrets

- Push to GHCR: the job's `GITHUB_TOKEN` with `packages: write` on the `docker` job only (job-level, as the existing comment in `ci.yml` anticipates). No PAT.
- Pull on the server: Coolify runs `docker compose` as root, so a one-time `docker login ghcr.io` as root with a fine-grained PAT scoped to `read:packages` on this repository's packages. The PAT expiring silently was `travel-crm`'s most frequent deploy failure; the deploy action's poll step names it explicitly when a deployment fails at pull, and the PAT's expiry date is recorded in the runbook.
- GitHub secrets: `COOLIFY_URL`, `COOLIFY_API_TOKEN` (permissions `deploy` + `read`), `COOLIFY_APP_UUID`.
- Application secrets (`JWT_SECRET`, `DB_PASSWORD`, `BOOTSTRAP_OWNER_*`) live only in Coolify's env sets — separate for production and preview; preview adds `SEED_DEV_DATA=true`. Nothing secret is in the repo or in GitHub Actions.

### 3.4 Rollback

`git revert` + push to `main` — the same path as any deploy, audited in git. `sha-*` tags are kept in GHCR for at least 30 days; `pr-*` tags are deleted after the PR closes (§5.3). If the §3.1 fallback is chosen, rollback additionally gets a `workflow_dispatch` input `sha` that sets `IMAGE_TAG` and deploys without rebuilding.

## 4. Repository changes

### 4.1 `docker-compose.prod.yml` — the one compose file

Serves prod, previews and the no-Coolify exit path.

- Remove `networks: app_net` and every `ports:` entry. Coolify creates the stack network itself; it does not strip published ports, and `127.0.0.1:8080` / `127.0.0.1:5432` would collide between previews.
- `image:` lines use the tag mechanism fixed by the §3.1 spike; `GHCR_REPO` default becomes `webspirio/yagoda-starter` (the current `web-starter` does not match the repository and therefore the GHCR package names).
- `mem_limit` per service: backend 384M, postgres 256M, redis 64M, nginx 64M, seed 256M. One preview cannot take the host down.
- New one-shot service `seed`: the backend image, `restart: "no"`, `depends_on: backend: condition: service_healthy`, command `sh -c '[ "$SEED_DEV_DATA" = true ] || exit 0; NODE_ENV=development node backend/dist/seed/dev-seed.cli.js'`. Exits immediately in prod, where the variable is absent. `NODE_ENV=development` applies to this process only; the backend container keeps `production`.
- The «this starter ships no CD workflow» comments are replaced with the current truth.

### 4.2 `docker-compose.standalone.yml` — new override (~15 lines)

Restores `127.0.0.1:8080` for nginx and `127.0.0.1:5432` for postgres. `docs/vps-tls-setup.md` and `docs/backup-restore.md` switch to `-f docker-compose.prod.yml -f docker-compose.standalone.yml`.

### 4.3 Backend — one fix

`backend/src/app.module.ts`: the four `BOOTSTRAP_OWNER_*` rules get `.empty('')`. Today `docker-compose.prod.yml` forwards them as `${VAR:-}`, i.e. an empty string, and `Joi.string().optional()` rejects `""` — a fresh prod stack without all four variables crash-loops (`"BOOTSTRAP_OWNER_LOGIN" is not allowed to be empty`, reproduced 2026-09-09). With `.empty('')` an empty string means «unset», the migration no-ops as designed, and `BOOTSTRAP_OWNER_PASSWORD=short` still fails `min(8)`. A unit test on the validation schema covers both.

### 4.4 `.github/workflows/ci.yml` — the `docker` job grows, nothing else moves

- Runs on `pull_request` **and** `push: main`. `push: true` to GHCR; `permissions: packages: write` on this job only.
- Tags: always `sha-<full sha>`; on PR also `pr-<N>`; on `main` also `latest`.
- GHA cache scopes split into `<image>-main` and `<image>-pr`; PR builds read from both and write only to `-pr`, so preview churn cannot evict the prod cache.
- The `changes` filter gains `docker-compose*.yml` and `.github/workflows/**` — the compose file is now a deploy input that Coolify reads from the PR branch. A PR that changes nothing in the set still skips the build and therefore gets no preview (nothing to preview).
- Fork PRs (no secrets): build without push, no preview.

### 4.5 `.github/workflows/cd.yml` — new

Chained after `CI` (`workflow_run`, or `needs` inside `ci.yml` — the plan picks whichever gives clean access to the `pull_request` payload; the behaviour below is fixed either way).

- **`deploy-preview`** — internal PRs only, after the `docker` job succeeds (does not wait for `checks`: preview speed matters more, and red tests are visible on the PR anyway). Steps: cap check (`gh pr list --state open --json number` count ≤ 6, else a sticky comment «preview limit reached, close older PRs» and a clean exit); `POST /api/v1/deploy?uuid=…&pr=N`; poll `GET /api/v1/deployments/{deployment_uuid}` until `finished` / `failed` (composite action `.github/actions/coolify-deploy`, modelled on `travel-crm`'s `coolify-wait-healthy`, with an explicit hint when the failure is an image pull); sticky comment with `https://pr-N.yagoda.webspirio.com`.
- **`deploy-prod`** — `push: main`, `needs` all three CI jobs, `concurrency: deploy-prod, cancel-in-progress: false`; same action without `pr`; after `finished`, `curl -f https://yagoda.webspirio.com/api/health/ready`.
- **`cleanup-images`** — weekly: delete `pr-*` tags of closed PRs, untagged versions, and `sha-*` older than 30 days (`actions/delete-package-versions`).

### 4.6 Documentation and scripts

- **`docs/coolify-deploy.md`** (new runbook, structured like `ua-well-portal`'s `cd-setup.md`): server bootstrap, unattended Coolify install, application and env sets as a table, GitHub App, previews, backup timer, «when a deploy goes wrong», PAT rotation, exit without Coolify.
- **`scripts/vps/bootstrap.sh`** — idempotent: 2 GB swapfile, `vm.swappiness=10`, `curl git jq`.
- **`scripts/vps/backup.sh`** + `backup.service` / `backup.timer` — the `backup-restore.md` script adapted to Coolify's container and volume names; off-box copy left as a marked TODO with the two options from the existing doc.
- **`CLAUDE.md`** Deployment section rewritten for Coolify; the 12 MB body-size paragraph stays, now pointing at the Traefik middleware.

## 5. Server-side operations

Order matters; each mutating step is run by the assistant over SSH only after the owner's explicit go-ahead. Browser steps are the owner's.

1. **Owner, Hetzner console:** Cloud Firewall on the server — inbound 22, 80, 443 only. *Before* installing Coolify: Docker's published ports bypass UFW, and `travel-crm`'s panel sat open on `:8000` over plain HTTP for a month.
2. **Assistant:** `apt update && apt upgrade`, `scripts/vps/bootstrap.sh`, verify `free -h` / `swapon --show`.
3. **Assistant:** Coolify **unattended** install with `ROOT_USERNAME` / `ROOT_USER_EMAIL` / `ROOT_USER_PASSWORD` — closes the «first visitor to `:8000` becomes admin» race. The password is generated on the server into `/root/coolify-root-credentials` (mode 600); the owner changes it at first login. `AUTOUPDATE=false`. Then the panel domain `coolify.yagoda.webspirio.com` through Traefik with TLS; `:8000` stays closed by the firewall. Note: the installer only checks `ID=ubuntu`, not the version — 26.04 passes but is not on Coolify's tested list.
4. **Owner, Coolify UI / GitHub:** GitHub App for the `webspirio` org (org admin needed) with Preview Deployments enabled; API token (`deploy` + `read`) → GitHub secrets. Fine-grained PAT `read:packages` → `docker login ghcr.io` on the server, run by the owner via `! ssh …` so the PAT never passes through the chat.
5. **Assistant:** the application — Docker Compose build pack, repo through the GitHub App, branch `main`, compose `docker-compose.prod.yml`; nginx service domain `yagoda.webspirio.com`; preview template `pr-{{pr_id}}.yagoda.webspirio.com`; auto-deploy **off**; `SOURCE_COMMIT` **on**; Traefik request-body limit 12 MB (`buffering.maxRequestBodyBytes` middleware — same constraint `docs/vps-tls-setup.md` explains for nginx); env sets per the runbook table (secret values typed by the owner).
6. **Assistant:** the **§3.1 spike** — a test deploy; confirm `SOURCE_COMMIT` interpolation, preview removal on close, no port conflicts. The result fixes the final `image:` line and whether a `closed` job is needed.
7. **Assistant:** backup timer; first manual run; verify with `pg_restore --list` / `tar -t`; then the Coolify RSS measurement that recalibrates the preview cap if needed.

## 6. Acceptance

- A PR with a trivial change → green CI → comment with `https://pr-N.yagoda.webspirio.com` → the page loads over HTTPS, login as a seeded user works, `/api/health/ready` returns 200; closing the PR removes containers and volumes.
- Merge to `main` → `deploy-prod` → `https://yagoda.webspirio.com/api/health/ready` returns 200; login as the bootstrap owner works.
- `git revert` + push → production is back on the previous image (checked via `docker inspect` on the server).
- Backup: one night produces a `-db.sql.gz` / `-uploads.tar.gz` pair; a restore drill per `docs/backup-restore.md` into a scratch database on the same host boots the app.
- Negative paths: a fork PR gets no preview and CI stays green; a 7th open PR gets the limit comment and no deploy.

## 7. Exit path without Coolify

Kept deliberately cheap: the same GHCR images, the same `docker-compose.prod.yml` plus `docker-compose.standalone.yml`, host nginx + Certbot per `docs/vps-tls-setup.md`, `pg_dump`/restore of the two volumes per `docs/backup-restore.md`. About a 30-minute maintenance window. This is the reason images are built in CI and not by Coolify.

## 8. What the sibling repos taught (applied here)

From `travel-crm`: CI builds → GHCR → Coolify pulls; the wait-for-deployment action; `concurrency: deploy-prod` without cancel; separate cache scopes for prod and preview; sticky PR comment; a hard preview cap; close the panel port with the edge firewall before install; expect the GHCR PAT to expire. From `ua-well-portal`: `sha-` tags with rebuild-free rollback; `GITHUB_TOKEN` instead of a long-lived PAT wherever the token's lifetime allows; migration pre-flight before `up` (deferred, §9). Not adopted: `travel-crm`'s custom Traefik labels + bash preview orchestration (single-container app, ours has four services) and `ua-well-portal`'s SSH `checkout --force` deploy (Coolify replaces it).

## 9. Out of scope — recorded as follow-ups

- **DBLab** (issue #10's optional item). Needs a ZFS or LVM-thin pool on its own disk or file, ZFS ARC defaults to half of RAM, each clone is a full Postgres container (example config: `shared_buffers: 1GB`), postgres.ai's own tutorial uses an 8 GiB machine. Its value — testing migrations against a copy of *production* data — appears once production data exists and is large; today there is none and `db:seed` gives every preview a realistic dataset. Revisit when the database exceeds ~1–2 GB, on a separate machine. The postgres.ai Coolify guide's pattern (CI patches preview env through the API, then triggers `deploy` with the PR number) is the §3.1 fallback.
- Deploy on GitHub Release / `v*` tag (trigger change only).
- `pg_dump` before every production migration run, from the pipeline.
- Off-box backup copy (Hetzner Storage Box via rclone vs. restic to S3).
- Monitoring and alerts (Coolify Sentinel + Telegram notifications).
