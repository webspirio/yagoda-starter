# Staging Deployment & Release-Gated Production — Design Spec

Issue #186 (moved from ua-well-portal#236). Extends
`2026-09-09-coolify-deployment-and-cd-design.md`; everything that spec settled
(one compose file, CI-built `sha-<commit>` images, Coolify never builds, the
`SERVICE_NAME_*` and bare-`${KEY}` rules from #180/#184) stays in force.

## 0. Goal

The client needs a **clean production**: real data only, new functionality
arriving in deliberate releases. Everything merged to `main` must appear
automatically on a **staging** environment with seeded demo data and whatever
test data testers accumulate, so «Ready for PO» / «Client review» happens
there, not on production. PR previews keep working exactly as they do today.

## 1. Decisions, in one table

| Question | Decision | Why |
|---|---|---|
| What deploys staging | every push to `main` (merge), automatically | the ticket's one requirement |
| What deploys production | a **GitHub Release** `vX.Y.Z` published from `main` (`release: published`), or a `workflow_dispatch` naming an existing release tag | releases are already the repo's practice (`v0.1.0`, 2026-09-21); a Release is a deliberate, auditable act |
| How Coolify learns the release commit | the production application tracks a `production` branch that **only the release workflow moves**, to the tag's commit | Coolify's deploy API accepts no git ref — it deploys the application's branch HEAD, and loads the compose from that branch too |
| Where previews live | on the **staging** application, not the production one | the GitHub App matches PR webhooks to applications by `git_branch == base branch (main)`; once production tracks `production` it would never see a PR |
| Staging data | `SEED_DEV_DATA=true` (idempotent demo seed on first boot), persistent volumes between deploys | same as previews; testers' data survives redeploys; «reset» is a manual volume delete |
| Rollback | **forward-fix by default** (hotfix release). Direct redeploy of an older tag is allowed only when no migration changed between the live commit and the target — enforced in CI, overridable by an explicit input | migrations run on backend start-up and never roll back by themselves |
| Basic auth on staging/previews | not in scope (unchanged) | same exposure class as today's previews, already documented in the runbook |
| Memory budget | staging at the preview-sized defaults (~0.25 GiB) → `PREVIEW_CAP` 12 → 11 | the cap is the only enforcement of the free-memory invariant |

## 2. Environment model

| Environment | Git | Coolify application | Data | Deploy trigger | URL |
|---|---|---|---|---|---|
| production | branch `production` (moved by releases only) | `yagoda` (existing) | real, no seed | Release `vX.Y.Z` / dispatch with a tag | `https://yagoda.webspirio.com` |
| staging | branch `main` | `yagoda-staging` (new, environment `staging`) | seed + test data, persistent | every push to `main` | `https://staging.yagoda.webspirio.com` |
| preview `N` | PR head | preview of `yagoda-staging` | seed, torn down on close | `deploy-preview` on internal PRs | `https://pr-N.yagoda.webspirio.com` |

`main` is never deployed to production directly. Humans never push
`production`; the release workflow fast-forwards it (or, for an explicit
rollback, force-moves it) and every move is a workflow run with a log.

## 3. Coolify

### 3.1 Production application `yagoda` (existing)

- **Branch `main` → `production`.** Done once, before the CI change merges, with
  `production` already created at the commit production is serving (read from
  `/api/health/version`), so nothing redeploys until the first release.
- **Preview Deployments: off.** The PR webhook must not create preview records
  here any more (it would not match anyway once the branch changes).
- Env set unchanged. Auto Deploy stays off. Watch Paths stay blank.

### 3.2 Staging application `yagoda-staging` (new)

Created through the Coolify API (`POST /api/v1/applications/private-github-app`),
in project `yagoda`, a new environment `staging`, on the same server:

- source: GitHub App `yagoda-coolify-pr-preview`; repository
  `webspirio/yagoda-starter`; branch `main`; build pack Docker Compose; compose
  location `/docker-compose.prod.yml`; domain for service `nginx`
  `https://staging.yagoda.webspirio.com` (the wildcard DNS already resolves);
- Auto Deploy **off**; Watch Paths **blank**; *Include Source Commit* **on**;
- **Preview Deployments on**, URL template `pr-{{pr_id}}.yagoda.webspirio.com`,
  *PR deployment access: repository members only* — i.e. exactly the preview
  configuration the production application carries today, moved here;
- two env sets, both with values generated at creation time and stored only in
  Coolify:
  - *staging* (the application's own set): `APP_URL=https://staging.yagoda.webspirio.com`,
    `JWT_SECRET`, `DB_PASSWORD`, `BOOTSTRAP_OWNER_LOGIN/_PASSWORD/_FIRST_NAME/_LAST_NAME`,
    `SEED_DEV_DATA=true`; no memory overrides (preview-sized defaults);
  - *preview*: the same keys with their own values, `APP_URL` as the previews
    have it today (production's value — CORS allowlist only).
- Compose needs no change: `SERVICE_NAME_*` are unsuffixed for the staging
  deploy and suffixed for its previews; per-environment keys are bare
  `${KEY}` (#184), so each env set is honoured. `npm run compose:check` keeps
  guarding both.

### 3.3 Server-side operations (done by the implementer with root SSH)

Creating the application, its env sets and settings goes through the Coolify
REST API with a **temporary API token** minted on the server
(`php artisan tinker`, abilities `read`, `write`, `deploy`), used only for
this rollout and revoked at the end. Secrets are generated on the server
(`openssl rand`) and posted straight to the API — they are never printed or
written to the repository. The production branch switch and the preview toggle
on the production application are one `PATCH` each (or one SQL `UPDATE`, as in
#68; either way recorded in the runbook).

## 4. Repository changes

### 4.1 `.github/workflows/ci.yml`

Triggers gain `release: { types: [published] }` and
`workflow_dispatch` with inputs `tag` (required) and `allow_schema_rollback`
(boolean, default `false`).

| Job | Trigger | Change |
|---|---|---|
| `verify` | unchanged (every event) | none |
| `changes` | PRs only | none |
| `docker` | every event | builds and pushes on `push` to `main` **and** on `release`; on release the images carry `sha-<commit>` **and** `vX.Y.Z` (a `v*` tag is never pruned by `cleanup-images`). On `workflow_dispatch` it does not build: a release's images exist by construction |
| `deploy-staging` | `push` to `main` | **new** — the current `deploy-prod` job, renamed and pointed at `COOLIFY_STAGING_APP_UUID` / `vars.STAGING_URL`, gated by `vars.COOLIFY_ENABLED && vars.STAGING_ENABLED`, keeping the «main has moved on — skip» guard, its own concurrency group, and the seeded-login check (`oksana`/`operator`) |
| `deploy-preview` | PRs | app UUID becomes `COOLIFY_STAGING_APP_UUID`; nothing else |
| `deploy-prod` | `release` / `workflow_dispatch` | **rewritten** (below) |
| `preview-note-skipped` | PRs | none |

`deploy-prod` on a release, in order — each step fails the job loudly:

1. **Resolve the target.** `TAG` = the release's tag or the dispatch input;
   `TARGET_SHA` = the tag's commit. The tag must exist and its commit must be
   an ancestor of `origin/main` (releases are cut from `main`; a hotfix is
   merged to `main` first, then released).
2. **Images exist.** `docker manifest inspect` for both
   `ghcr.io/…-{backend,nginx}:sha-<TARGET_SHA>`. On `release` they were just
   pushed by `docker` (`needs: [verify, docker]`); on dispatch they must
   already exist — a release image is `v*`-tagged and therefore never pruned.
3. **Schema-rollback guard** (`scripts/ci/release-guard.sh`, unit-tested like
   the other CI scripts). `LIVE_SHA` = the commit `production` points at. If
   `TARGET_SHA` is an ancestor of `LIVE_SHA` (a move backwards) **and**
   `git diff --name-only TARGET_SHA..LIVE_SHA -- backend/src/migrations/` is
   non-empty, the job stops: «rolling back across a migration; ship a hotfix
   release (forward-fix) or restore per docs/backup-restore.md; rerun with
   allow_schema_rollback=true only if you have verified the down path». The
   input `allow_schema_rollback=true` turns the stop into a warning.
4. **Move `production`.** `git push origin TARGET_SHA:refs/heads/production`
   (`--force-with-lease` against `LIVE_SHA`, since a rollback moves it
   backwards). Done with the workflow's `GITHUB_TOKEN` (`contents: write`);
   a push by that token triggers no other workflow, which is what we want.
5. **Deploy and verify.** The existing `coolify-deploy` action against
   `COOLIFY_APP_UUID` / `vars.PROD_URL` with `commit: TARGET_SHA`: it waits
   for Coolify, then asserts `/api/health/ready` and
   `/api/health/version == TARGET_SHA`. No seeded login on production.

Concurrency group `deploy-prod`, `cancel-in-progress: false`. The `changes`
skip-propagation lesson from the first spec still applies: both deploy jobs
start with `!cancelled()` and assert their `needs` results.

### 4.2 `scripts/ci/release-guard.sh` (new, with `release-guard.test.sh`)

Pure bash, no network: takes `LIVE_SHA`, `TARGET_SHA`, the migrations path and
the override flag; prints the verdict and exits 0/1. The test fixture is a
throwaway git repository with two commits, one adding a migration file, so
the four cases (forward, backward-without-migration, backward-across-migration,
backward-across-migration-with-override) are each asserted.

### 4.3 Repository variables and secrets

| Name | Kind | Value |
|---|---|---|
| `COOLIFY_STAGING_APP_UUID` | secret | the new application's UUID |
| `STAGING_URL` | variable | `https://staging.yagoda.webspirio.com` |
| `STAGING_ENABLED` | variable | `true` (a pause switch, like `PREVIEWS_ENABLED`) |
| `PREVIEW_CAP` | variable | `11` |

`COOLIFY_APP_UUID`, `PROD_URL`, `COOLIFY_ENABLED`, `PREVIEWS_ENABLED` keep
their meaning.

### 4.4 Documentation

- `docs/coolify-deploy.md`: the environment model table (§2); «How a deploy
  happens» rewritten for the three paths; a **«Releasing to production»**
  section (cut a release with `gh release create vX.Y.Z --target main
  --generate-notes`; what the workflow checks; how to read a failure); a
  **«Rolling back»** section (forward-fix first; the guard; when a dispatch
  with an older tag is acceptable; `production` may briefly point at a commit
  that is not live after a failed deploy — `/api/health/version` is the truth);
  a **«Staging»** section (what it is for, the reset procedure = delete the
  application's volumes in Coolify, memory); the env-variable table gains a
  *Staging* column; «Memory» gets the recalibrated cap; the preview setup
  steps move from the production application to the staging one.
- `CLAUDE.md` «Deployment»: `main` → staging automatically; production only
  by Release; previews on the staging application.
- This spec and the plan under `docs/superpowers/`.

## 5. Transition — no production downtime

1. Create `production` on GitHub at the commit production serves.
2. Coolify: production application → branch `production`, previews off.
3. Coolify: create `yagoda-staging`, both env sets, previews on.
4. Repository: secrets and variables from §4.3.
5. Merge the PR. Its merge commit runs the **new** workflow: `deploy-staging`
   deploys staging for the first time; `deploy-prod` does not run (no
   release).
6. Verify staging and a preview (§6), then publish `v0.2.0` — the first
   release-gated production deploy.

Between steps 2 and 5 no PR gets a preview (production's previews are off,
the staging application has none until step 3 and CI still points at the old
UUID until step 5). That window is minutes long and is executed in one
sitting.

## 6. Acceptance

- Push to `main` → `deploy-staging` green; `https://staging…/api/health/version`
  equals the pushed commit; seeded login 200; the staging stack's
  `BOOTSTRAP_OWNER_PASSWORD` hash equals the staging env set's row.
- Open a PR → its preview comes up under the staging application (seeded,
  `pr-N.…`), closes with the PR (containers, volumes, network, record gone).
- Publish `v0.2.0` → `docker` pushes `sha-<c>` + `v0.2.0`; `deploy-prod`
  moves `production` and deploys; `/api/health/version == c`; the production
  seed container exits 0 with `SEED_DEV_DATA` empty (no demo data).
- `workflow_dispatch` with `tag=v0.1.0` → stops at the schema-rollback guard
  with the documented message (migrations landed since); nothing deployed and
  `production` unmoved.
- The next nightly backup still targets the production Postgres
  (`com.docker.compose.project=<production UUID>`).
- `npm run verify` green, including `test:ci-scripts` with the new guard's
  tests and `compose` (compose unchanged).

## 7. Risks and what bounds them

- **A failed production deploy after `production` moved** leaves the branch
  ahead of what is live. Bounded by the same rule as any failed deploy today:
  `/api/health/version` is the truth; rerun the release (same or previous tag).
- **A rollback across a migration** is refused by the guard; forward-fix is
  the documented path; the override exists for the case where the down path
  was verified by hand.
- **Preview cleanup** is the GitHub App's `closed` webhook, per application:
  the staging application is connected to the same App, so the mechanism
  verified on #179/#181/#183/#185 applies unchanged — and is re-verified in §6.
- **Image retention**: a release's images are `v*`-tagged, which the weekly
  cleanup never deletes; a dispatch therefore always finds them.
- **Disk**: staging adds a fourth Postgres volume and an uploads volume on the
  38 GB disk; the follow-up in the foundation-slice list («disk, not RAM, is
  the tighter preview budget») gains one more tenant and stays open.

## 8. Out of scope

Basic auth on staging/previews; a scheduled reset of staging data; a copy of
production data on staging; Coolify rolling updates; release notes tooling
(release-please) — each a separate ticket if wanted.
