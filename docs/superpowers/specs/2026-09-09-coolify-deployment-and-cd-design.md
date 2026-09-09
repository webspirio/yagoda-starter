# Coolify Deployment & CD — Design Spec

**Date:** 2026-09-09 (revised the same day after the owner's review — «approve with changes»; the changes are folded in below, and §3.1 now names the gates after which the design is final).
**Closes:** GitHub issue #10 «CD / Deployment» (server bought 2026-09-09; DNS for `yagoda.webspirio.com` and `*.yagoda.webspirio.com` already resolves to `188.245.146.122`).
**Builds on:** `docker-compose.prod.yml`, `.github/workflows/ci.yml`, `docs/vps-tls-setup.md`, `docs/backup-restore.md` — all of which this spec reshapes rather than replaces.
**Mode:** brainstormed with the owner on 2026-09-09; every choice below was confirmed in that conversation. Numbers come from measurements taken that day (§2), not estimates, except where marked *estimate*.

## 0. Goal

A merge to `main` puts the app on `https://yagoda.webspirio.com` without anyone touching the server; every internal pull request whose CI is green gets its own `https://pr-<N>.yagoda.webspirio.com` with seeded demo data and disappears when the PR closes. The server keeps running production after development slows down, with nightly backups and a documented exit path that does not depend on Coolify.

Not in scope (§9): DBLab, release-tag deploys, pre-deploy `pg_dump` from the pipeline, off-box backup copies, monitoring/alerts.

## 1. Decisions, in one table

| Question | Decision | Why |
|---|---|---|
| Who terminates TLS and routes subdomains | Coolify's built-in Traefik | Wildcard DNS is already there; Let's Encrypt renewals, per-PR hostnames and the dashboard come for free. `docs/vps-tls-setup.md` (host nginx + Certbot) stays as the *exit path*, not the primary. |
| Where images are built | **GitHub Actions → GHCR. Coolify only pulls.** | The server has 2 vCPU / 3.7 GiB and no swap. A single image build peaks at 0.6–0.85 GiB and both images build concurrently under `docker compose build` (~1.5 GiB) — on the server that caps previews at ~3 and stalls production for minutes on every push. CI already builds both images on every PR with a GHA layer cache and throws them away (`push: false`). Pushing them makes one build serve CI, preview and prod, keeps artifacts in GHCR (so Coolify is replaceable), and gives immutable `sha-` tags. `travel-crm` reached the same decision after trying server builds (`docs/DEPLOY.md` there). |
| Deployment source of truth | **`sha-<full commit>` only.** `pr-<N>` is a human convenience alias that is never deployed; no `latest` is pushed. | One mutable path would undo the point of immutable artifacts. Nothing in the design reads `latest`; the exit path passes an explicit `IMAGE_TAG`. |
| Workflow layout | **One workflow, `ci.yml`, deploy jobs chained with `needs`** | SHA, PR number, job results and permissions are all in one payload; `workflow_run` would re-derive them and has different secret/fork semantics. Only the weekly image cleanup is a separate scheduled workflow. |
| Preview gate | **All three CI jobs green** (`checks`, `db-checks`, `docker`) | A preview is «the CI-passed commit», not a second notion of «ready». The few minutes saved by deploying after `docker` alone are not worth previews of code that fails lint or tests. |
| Postgres | **Inside the compose stack**, one per environment | One compose file must serve prod and previews (Coolify deploys a preview from the same file in the PR branch), and previews need their own DB. Coolify's scheduled backups only cover its standalone Database resources and would not cover `uploads_data`, which `docs/backup-restore.md` shows must be backed up *with* the DB. Attaching a compose stack to a Coolify DB needs a second network on every container — exactly the multi-network setup Coolify documents as a cause of intermittent HTTPS failures. |
| Backups | Nightly systemd timer on the host: one **atomic snapshot pair** (`pg_dump` + `tar` of `uploads_data`) to `/data/backups`, 14-day retention, `flock` | The existing doc's script, adapted to Coolify's container/volume names and hardened (§4.6). Off-box copy deferred (§9). |
| Production trigger | **Automatic on `push: main`**, after all three CI jobs pass | Two-person team in active development; `main` is already kept deployable by the stack-merge workflow. Release-tag deploys are a one-line trigger change later. |
| Preview data | **Seeded** via a one-shot `seed` service enabled by `SEED_DEV_DATA=true` in the *preview* env set; the seed is idempotent and runs on every preview deploy | A CRM preview without data tests the login form, not the feature. `dev-seed.cli.js` is already in the prod image (`nest build` compiles `src/seed/`), refuses `NODE_ENV=production`, accepts `postgres` as a local host, and is idempotent by the schema's own keys (`dev-seed.ts`: «existing rows are NEVER modified»; a repeat run inserts 0 rows). |
| Hostnames | `yagoda.webspirio.com` prod · `coolify.yagoda.webspirio.com` panel · `pr-<N>.yagoda.webspirio.com` previews | Confirmed by the owner. Panel port `:8000` is closed by the Hetzner Cloud Firewall once the domain works. |
| Concurrent previews | **Invariant: ≥ 0.8–1.0 GiB of RAM stays free under representative prod load.** Initial cap **6 (provisional)**, counted as *live previews* (§4.5), recalibrated once Coolify's real RSS is measured (§5.7). | §2: the biggest term in the budget (Coolify ≈ 0.9 GiB) is an estimate, so the number is not the decision — the invariant is. One constant in `ci.yml`. |
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

Budget: 3.7 − 0.43 (OS) − ~0.9 (Coolify: coolify, coolify-db, coolify-redis, coolify-realtime, coolify-proxy, sentinel — *estimate*, re-measured in §5.7) − 0.2 (prod) ≈ **2.1 GiB** → 6 previews use 1.2 GiB and leave ~0.9 GiB before swap, which satisfies the invariant in §1 only if the Coolify estimate holds. A 2 GB swapfile is a safety net, not a working mode.

Not yet measured, and verified in the plan before the limits are committed: Postgres under `mem_limit: 256M` during migrations + seed + a restore (the `shared_buffers` default of 128 MB fits, but the seed's scrypt hashing and `pg_restore` are the realistic peaks, not idle), and the backend under 384M with `NODE_OPTIONS=--max-old-space-size=256` so Node reports a heap error before the cgroup kills it.

## 3. Deployment flow

```
PR push ──► CI: checks │ db-checks │ docker (build + push GHCR: sha-<commit>, alias pr-<N>)
                └── all three green ──► deploy-preview (serialized, cap on LIVE previews)
                                         → Coolify API deploy(uuid, pr=N) → poll deployment
                                         → GET /api/health/ready (bounded retry)
                                         → GET /api/health/version == sha-<commit>
                                         → POST /api/auth/login as a seeded user (proves seed ran)
                                         → sticky PR comment: URL + deployed sha → label `preview`
main push ─► CI: all three green ──────► deploy-prod (concurrency: deploy-prod, no cancel)
                                         → Coolify API deploy(uuid) → poll deployment
                                         → /api/health/ready (bounded retry) → /api/health/version == sha
PR closed ─► Coolify GitHub App webhook ─► preview removed (containers, volumes, hostname)
```

«Deployment finished» in Coolify is not «application up»: Traefik routing, DNS and container start-up leave a short window after Coolify reports success, and for previews the seed still has to finish. Both jobs therefore end on the application's own endpoints with a bounded retry (e.g. 12 × 10 s), never on Coolify's status alone.

### 3.1 How Coolify learns the image tag — the gate that finalises the design

The compose file references `image: ghcr.io/${GHCR_REPO:-webspirio/yagoda-starter}-backend:sha-${SOURCE_COMMIT}`. Coolify documents `SOURCE_COMMIT` (opt-in per application) as the commit it has just checked out. The design is final only when a spike on the live instance confirms **three separate properties**:

1. `SOURCE_COMMIT` is available to compose `${}` interpolation (not only as a build-arg or a runtime env of the containers).
2. For a preview it equals the **PR head SHA** that CI built and pushed — not a merge commit, not the base branch.
3. A manual «Redeploy» from the UI resolves to the **same** SHA the preview was created from.

If all three hold, every deploy pulls exactly its own image and there is no shared state.

**If any fails — fallback, and its stated limits.** Coolify keeps one preview env set per application, not per PR, so a per-preview variable is not available; the fallback is an `IMAGE_TAG` variable written by CI through `PATCH /api/v1/applications/{uuid}/envs` (`is_preview` for previews) immediately before `deploy`, with both calls inside the same serialized `concurrency` group as the cap (§4.5) so set+deploy is atomic across the repo. This makes «Redeploy» from the Coolify UI **unsafe for previews** (it would use whichever PR wrote `IMAGE_TAG` last); the runbook says so, and the post-deploy `GET /api/health/version == sha` check (§4.3) turns any mismatch into a failed job and a red comment instead of a silently wrong preview. Production has one env set and is unaffected.

### 3.2 Races

Coolify's own webhook-triggered deploys are **off**. The only deploy trigger is CI, which runs after the image is pushed, so Coolify never pulls a tag that does not exist yet. The GitHub App webhook still deletes the preview on PR close; the spike confirms that deletion is not gated by the auto-deploy switch — if it is, a `pull_request: closed` job deletes the preview through the API instead (and the workflow's `pull_request.types` gains `closed`, with every other job guarded against it).

### 3.3 Authentication and secrets

- Push to GHCR: the job's `GITHUB_TOKEN` with `packages: write` on the `docker` job only (job-level, as the existing comment in `ci.yml` anticipates). No PAT.
- Pull on the server: **preferred** — Coolify's own registry-credentials feature, if the installed version has one, so the credential's lifecycle belongs to the deployment system (checked in the spike). **Otherwise** a one-time `docker login ghcr.io` as root with a fine-grained PAT scoped to `read:packages` on this repository's packages; the runbook then records the credential file (`/root/.docker/config.json`, mode 600), the PAT's expiry date, and a rotation procedure that ends with a test pull. The PAT expiring silently was `travel-crm`'s most frequent deploy failure; the deploy action names it explicitly when a deployment fails at pull.
- GitHub secrets: `COOLIFY_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID`. The token's permissions follow the spike: `deploy` + `read` on the primary path; `write` as well if the fallback (env PATCH) or API-side preview deletion is needed. Least privilege for whichever path is chosen, not both.
- Application secrets (`JWT_SECRET`, `DB_PASSWORD`, `BOOTSTRAP_OWNER_*`) live only in Coolify's env sets — separate for production and preview; preview adds `SEED_DEV_DATA=true`. Nothing secret is in the repo or in GitHub Actions.

### 3.4 Rollback — and what it does not roll back

`git revert` + push to `main` — the same path as any deploy, audited in git. `sha-*` tags are kept in GHCR for at least 30 days; `pr-*` aliases are deleted after the PR closes (§4.5). If the §3.1 fallback is chosen, rollback additionally gets a `workflow_dispatch` input `sha` that sets `IMAGE_TAG` and deploys without rebuilding.

**An image rollback is not a schema rollback.** `migrationsRun: true` applies pending migrations on start-up; a reverted image runs against whatever schema the newer image left. For additive migrations this is harmless. **Before the first destructive migration reaches `main`** (drop/rename column, type change, data rewrite), the deferred pre-migration dump (§9) becomes required, not optional — the mechanism is sketched there so it can be added without redesign.

## 4. Repository changes

### 4.1 `docker-compose.prod.yml` — the one compose file

Serves prod, previews and the no-Coolify exit path.

- Remove `networks: app_net` and every `ports:` entry. Coolify creates the stack network itself; it does not strip published ports, and `127.0.0.1:8080` / `127.0.0.1:5432` would collide between previews.
- `image:` lines use the tag mechanism fixed by the §3.1 spike; `GHCR_REPO` default becomes `webspirio/yagoda-starter` (the current `web-starter` does not match the repository and therefore the GHCR package names).
- `mem_limit` per service: backend 384M, postgres 256M, redis 64M, nginx 64M, seed 256M — verified under load per §2 before the numbers are committed. `backend` sets `NODE_OPTIONS=--max-old-space-size=256` (under 384m) and `seed` `--max-old-space-size=192` (under 256m), so the heap limit is below the cgroup limit and an OOM is a readable Node error, not a SIGKILL.
- New one-shot service `seed`: the backend image, `restart: "no"`, `depends_on: backend: condition: service_healthy`, command `sh -c '[ "$SEED_DEV_DATA" = true ] || exit 0; NODE_ENV=development node backend/dist/seed/dev-seed.cli.js'`. Exits immediately in prod, where the variable is absent. `NODE_ENV=development` is set only inside that guarded command, after the guard has already decided whether to run — it does not constitute a production guard by itself; the backend container keeps `production`.
  *Why the dependency points at the backend, not at Postgres:* the seed does not run migrations — `dev-seed.cli.ts` refuses to run while migrations are pending — and the only migration runner in the stack is the backend's start-up (`migrationsRun: true`). A healthy backend is the signal that the schema exists. Running `typeorm migration:run` inside the seed service instead would put two migration runners in a race on every deploy. The backend has no start-up dependency on seed data, so there is no cycle.
- The «this starter ships no CD workflow» comments are replaced with the current truth.

### 4.2 `docker-compose.standalone.yml` — new override (~15 lines)

Restores `127.0.0.1:8080` for nginx and `127.0.0.1:5432` for postgres. `docs/vps-tls-setup.md` and `docs/backup-restore.md` switch to `-f docker-compose.prod.yml -f docker-compose.standalone.yml`, with `IMAGE_TAG=sha-<commit>` given explicitly.

### 4.3 Backend — two small changes

- `backend/src/app.module.ts`: the four `BOOTSTRAP_OWNER_*` rules get `.empty('')`. Today `docker-compose.prod.yml` forwards them as `${VAR:-}`, i.e. an empty string, and `Joi.string().optional()` rejects `""` — a fresh prod stack without all four variables crash-loops (`"BOOTSTRAP_OWNER_LOGIN" is not allowed to be empty`, reproduced 2026-09-09). With `.empty('')` an empty string means «unset», the migration no-ops as designed, and `BOOTSTRAP_OWNER_PASSWORD=short` still fails `min(8)`. A unit test on the validation schema covers both.
- **`GET /health/version`** → `{ "commit": "<sha>" }`, read from `APP_COMMIT`, which `backend/Dockerfile` accepts as a build-arg and bakes into the `prod` stage as `ENV`; CI passes `APP_COMMIT=${{ github.sha }}`. This is what makes «which SHA is actually serving this hostname» observable from the outside — the deploy jobs assert it, the sticky comment shows it, and under the §3.1 fallback it is the check that catches a wrong `IMAGE_TAG`. Unauthenticated, like `live`/`ready`; a commit hash of a private repo is not a secret. The GHA layer cache is unaffected: the `ARG` is consumed only in the final stage, after `npm ci` and `dist` are built.

### 4.4 `.github/workflows/ci.yml` — the `docker` job grows, the deploy jobs are added

- `docker` runs on `pull_request` **and** `push: main`. `push: true` to GHCR; `permissions: packages: write` on this job only.
- Tags: always `sha-<full sha>`; on PR additionally the alias `pr-<N>`. No `latest`.
- GHA cache scopes split into `<image>-main` and `<image>-pr`; PR builds read from both and write only to `-pr`, so preview churn cannot evict the prod cache.
- The `changes` filter gains `docker-compose*.yml` and `.github/workflows/**` — the compose file is now a deploy input that Coolify reads from the PR branch. Its diff is **PR-wide** (`base...head`, as today), so once a PR touches anything deployable, *every* push to it builds and redeploys; the reviewer's «backend commit, then a README-only commit» case therefore keeps building. The one remaining edge — a PR whose deployable change is later reverted within the PR, leaving a docs-only diff — skips the build, and the job then edits the sticky comment to «preview reflects `sha-<old>`; the current head has no deployable changes». A docs-only PR never builds and never gets a preview: nothing to preview.
- Fork PRs (no secrets): build without push, no preview, CI stays green.

### 4.5 Deploy jobs (in `ci.yml`, via `needs`)

- **`deploy-preview`** — `needs: [checks, db-checks, docker]`, internal PRs only, `concurrency: preview-allocation` (`cancel-in-progress: false`) so allocation is serialized across the whole repository. Steps:
  1. **Cap on live previews**, not open PRs: count open PRs carrying the label `preview` (set by this job on first success, meaningless once the PR is closed). If ≥ cap and this PR does not already hold the label → sticky comment «preview limit reached (N/6); close or merge an older PR», exit 0. If the spike shows the Coolify API can list an application's previews, that count is used instead and the label stays as the visible mirror.
  2. `POST /api/v1/deploy?uuid=…&pr=N`; poll `GET /api/v1/deployments/{deployment_uuid}` until `finished` / `failed` (composite action `.github/actions/coolify-deploy`, modelled on `travel-crm`'s `coolify-wait-healthy`, with an explicit hint when the failure is an image pull).
  3. Readiness against the application, bounded retry: `GET https://pr-N.yagoda.webspirio.com/api/health/ready` → 200; `GET /api/health/version` → `commit == github.sha`; `POST /api/auth/login` with the seed operator credentials from `dev-seed.data.ts` → 200 (proves the seed completed; those credentials exist only where `SEED_DEV_DATA=true` is set — the preview env set — and that variable must never be set on production).
  4. Sticky comment with the URL and the deployed SHA; add the `preview` label. Any failure in 2–3 edits the comment to the failure and the job fails.
- **`deploy-prod`** — `push: main`, `needs` the same three jobs, `concurrency: deploy-prod, cancel-in-progress: false`; same action without `pr`; then the same bounded-retry readiness (`/ready` 200, `/version == sha`) against `https://yagoda.webspirio.com`.
- **`cleanup-images.yml`** — separate weekly workflow: delete `pr-*` aliases of closed PRs, untagged versions, and `sha-*` older than 30 days (`actions/delete-package-versions`).

### 4.6 Documentation and scripts

- **`docs/coolify-deploy.md`** (new runbook, structured like `ua-well-portal`'s `cd-setup.md`): server bootstrap, unattended Coolify install, application and env sets as a table, GitHub App, previews (including the «Redeploy from UI» caveat if the fallback is in force), backup timer, «when a deploy goes wrong», registry credential location/rotation/test, exit without Coolify.
- **`scripts/vps/bootstrap.sh`** — idempotent: 2 GB swapfile, `vm.swappiness=10`, `curl git jq`.
- **`scripts/vps/backup.sh`** + `backup.service` / `backup.timer` — the `backup-restore.md` script adapted to Coolify's container and volume names and made **atomic per snapshot**: one `STAMP` for the pair; both artifacts are written as `<STAMP>-db.sql.gz.partial` / `<STAMP>-uploads.tar.gz.partial` and renamed into place only after *both* succeeded and `pg_restore --list` / `tar -tzf` verified them; a failed half is deleted, so the directory never contains an unmatched file. `flock /run/lock/yagoda-backup` serializes a manual run against the timer. Retention prunes by pair. Off-box copy left as a marked TODO with the two options from the existing doc.
- **`CLAUDE.md`** Deployment section rewritten for Coolify; the 12 MB body-size paragraph stays, now pointing at the Traefik middleware.

## 5. Server-side operations

Order matters; each mutating step is run by the assistant over SSH only after the owner's explicit go-ahead. Browser steps are the owner's.

1. **Owner, Hetzner console:** Cloud Firewall on the server — inbound 22, 80, 443 only. *Before* installing Coolify: Docker's published ports bypass UFW, and `travel-crm`'s panel sat open on `:8000` over plain HTTP for a month.
2. **Assistant:** `apt update && apt upgrade`, `scripts/vps/bootstrap.sh`, verify `free -h` / `swapon --show`.
3. **Assistant:** Coolify **unattended** install with `ROOT_USERNAME` / `ROOT_USER_EMAIL` / `ROOT_USER_PASSWORD` — closes the «first visitor to `:8000` becomes admin» race. The password is generated on the server into `/root/coolify-root-credentials` (mode 600); the owner changes it at first login. `AUTOUPDATE=false`. Then the panel domain `coolify.yagoda.webspirio.com` through Traefik with TLS; `:8000` stays closed by the firewall. Note: the installer only checks `ID=ubuntu`, not the version — 26.04 passes but is not on Coolify's tested list.
4. **Owner, Coolify UI / GitHub:** GitHub App for the `webspirio` org (org admin needed) with Preview Deployments enabled; API token → GitHub secrets (permissions per §3.3, after the spike). Registry credentials per §3.3 — either in Coolify, or `docker login ghcr.io` on the server run by the owner via `! ssh …` so the PAT never passes through the chat.
5. **Assistant:** the application — Docker Compose build pack, repo through the GitHub App, branch `main`, compose `docker-compose.prod.yml`; nginx service domain `yagoda.webspirio.com`; preview template `pr-{{pr_id}}.yagoda.webspirio.com`; auto-deploy **off**; `SOURCE_COMMIT` **on**; Traefik request-body limit 12 MB (`buffering.maxRequestBodyBytes` middleware — same constraint `docs/vps-tls-setup.md` explains for nginx); env sets per the runbook table (secret values typed by the owner).
6. **Assistant:** the **§3.1 spike** — test deploys of prod and of one preview. Gates: the three `SOURCE_COMMIT` properties; preview removal on PR close with auto-deploy off; whether the API lists previews; whether Coolify holds registry credentials; no port conflicts between two previews. Each gate's outcome is written into the runbook and fixes the corresponding open point (§3.1 mechanism, §3.2 `closed` job, §3.3 credentials and token scope, §4.5 cap source).
7. **Assistant:** backup timer; first manual run; verify the pair; then measure Coolify's real RSS (`docker stats` over the `coolify-*` containers at idle and during a deploy) and recompute the cap against the §1 invariant.

## 6. Acceptance

- A PR with a trivial deployable change → green CI → comment with `https://pr-N.yagoda.webspirio.com` and `sha-<head>` → the page loads over HTTPS, `/api/health/version` returns that SHA, login as a seeded operator works; **a second push to the same PR** redeploys, the seed logs «rows inserted this run» as all zeros, and the same login still works; closing the PR removes containers and volumes.
- Merge to `main` → `deploy-prod` → `https://yagoda.webspirio.com/api/health/ready` returns 200 and `/api/health/version` returns the merge SHA; login as the bootstrap owner works.
- `git revert` + push → `/api/health/version` on production returns the reverted-to SHA.
- Backup: one night produces a `-db.sql.gz` / `-uploads.tar.gz` pair with the same stamp and no `.partial` files; a second run started while the first is running waits; a restore drill per `docs/backup-restore.md` into a scratch database on the same host boots the app.
- Limits: Postgres completes migrations + seed + a restore under `mem_limit: 256M`; the backend under 384M logs a Node heap error rather than being killed when pushed past `--max-old-space-size`.
- Negative paths: a fork PR gets no preview and CI stays green; a docs-only PR gets no build and no preview; with 6 labelled open PRs, a 7th gets the limit comment and no deploy; a PR that already holds `preview` is not blocked by the cap on its own redeploy.

## 7. Exit path without Coolify

Kept deliberately cheap: the same GHCR images (`IMAGE_TAG=sha-<commit>`), the same `docker-compose.prod.yml` plus `docker-compose.standalone.yml`, host nginx + Certbot per `docs/vps-tls-setup.md`, `pg_dump`/restore of the two volumes per `docs/backup-restore.md`. About a 30-minute maintenance window. This is the reason images are built in CI and not by Coolify.

## 8. What the sibling repos taught (applied here)

From `travel-crm`: CI builds → GHCR → Coolify pulls; the wait-for-deployment action; `concurrency: deploy-prod` without cancel; separate cache scopes for prod and preview; sticky PR comment; a hard preview cap; close the panel port with the edge firewall before install; expect the GHCR PAT to expire. From `ua-well-portal`: `sha-` tags with rebuild-free rollback; `GITHUB_TOKEN` instead of a long-lived PAT wherever the token's lifetime allows; migration pre-flight before `up` (deferred, §9). Not adopted: `travel-crm`'s custom Traefik labels + bash preview orchestration (single-container app, ours has four services) and `ua-well-portal`'s SSH `checkout --force` deploy (Coolify replaces it).

## 9. Out of scope — recorded as follow-ups

- **Pre-migration `pg_dump`.** Required before the first destructive migration (§3.4). Planned mechanism, compose-native so it needs no SSH from CI: a one-shot `predeploy-dump` service in the same compose file, gated by `PREDEPLOY_DUMP=true` in the *production* env set only, that `pg_dump`s to the `/data/backups` bind mount and on which `backend` has `depends_on: condition: service_completed_successfully` — so the dump is taken *before* the new image's migrations run, and a failed dump blocks the deploy instead of the migration.
- **DBLab** (issue #10's optional item). Needs a ZFS or LVM-thin pool on its own disk or file, ZFS ARC defaults to half of RAM, each clone is a full Postgres container (example config: `shared_buffers: 1GB`), postgres.ai's own tutorial uses an 8 GiB machine. Its value — testing migrations against a copy of *production* data — appears once production data exists and is large; today there is none and `db:seed` gives every preview a realistic dataset. Revisit when the database exceeds ~1–2 GB, on a separate machine. The postgres.ai Coolify guide's pattern (CI patches preview env through the API, then triggers `deploy` with the PR number) is the §3.1 fallback.
- Deploy on GitHub Release / `v*` tag (trigger change only).
- Off-box backup copy (Hetzner Storage Box via rclone vs. restic to S3).
- Monitoring and alerts (Coolify Sentinel + Telegram notifications).
