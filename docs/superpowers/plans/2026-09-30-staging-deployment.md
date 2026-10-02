# Staging Deployment & Release-Gated Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every merge to `main` deploys a seeded staging environment automatically; production is deployed only by publishing a GitHub Release; PR previews keep working, now attached to the staging application.

**Architecture:** one new Coolify application (`yagoda-staging`, branch `main`, previews on) next to the existing one (`yagoda`, now tracking a `production` branch, previews off). `ci.yml` gains a `deploy-staging` job (the old `deploy-prod`, re-pointed), a rewritten `deploy-prod` that runs on `release`/`workflow_dispatch`, checks images, refuses schema rollbacks, moves `production` and deploys, and a `docker` job that also builds on release with a `vX.Y.Z` image tag. No application code or compose changes.

**Tech Stack:** GitHub Actions, bash (+ the repo's `scripts/ci/*.test.sh` style), Coolify 4.3.x REST API, Docker/GHCR.

**Spec:** `docs/superpowers/specs/2026-09-30-staging-deployment-design.md`

## Global Constraints

- Coolify never builds; the only image tag ever deployed is `sha-<full commit>` (releases add a `vX.Y.Z` alias to the same image).
- `docker-compose.prod.yml` is not touched; `npm run compose:check` must stay green.
- Every deploy job starts with `!cancelled()` and asserts its `needs` results (the skip-propagation lesson from `docs/coolify-deploy.md`).
- Secrets are generated on the server and posted to Coolify; they are never printed, never written to the repository, never pasted into chat.
- Ticket hygiene: branch `feat/186-staging-deployment`, PR title starts with `feat(cd):`, body has `Closes #186`, every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Coolify identifiers (read 2026-09-30): URL `https://coolify.yagoda.webspirio.com`; project `vdnyrbsagu4ekkhtlwct7hby`; server `gj5j8e0kqcamovacuynlsxkr`; destination `vxmuwsizdoxy1ofaeismrp0w`; GitHub App `knczywealfv7wvegax66ankx`; production application `znuzjhodijlqzg0covvgcoqk`.

## Review Focus

1. A `workflow_dispatch` whose `tag` does not exist, or names a commit not on `main` → `deploy-prod` must fail at «Resolve the release» before touching anything (Task 2 tests this by reading the step's guards; Task 6 exercises it live with a made-up tag).
2. A rollback that crosses a migration → refused with the runbook pointer; `production` unmoved (Task 1 tests the script; Task 6 exercises it with `v0.1.0`).
3. A first release when `production` does not exist yet → the guard passes («no production branch yet») and the branch is created, not force-updated (Task 1 test «no live»; Task 2's push step handles the empty-lease case).
4. The `docker` job on `workflow_dispatch` must build the **tag's** commit, not `main`'s HEAD (Task 2: `SHA` is resolved from the tag via the API).
5. A push to `main` while `STAGING_ENABLED` is unset → `deploy-staging` is skipped, nothing else changes; production must never be deployed by a push (Task 2: `deploy-prod`'s `if` names only `release`/`workflow_dispatch`).

---

### Task 1: `scripts/ci/release-guard.sh` — refuse a rollback across a migration

**Files:**
- Create: `scripts/ci/release-guard.sh`
- Create: `scripts/ci/release-guard.test.sh`

**Interfaces:**
- Produces: `bash scripts/ci/release-guard.sh LIVE_SHA TARGET_SHA MIGRATIONS_DIR ALLOW` — exit 0 = deploy may proceed, exit 1 = refused; `LIVE_SHA` may be empty (no `production` branch yet); `ALLOW` is the literal string `true` or `false`. Runs inside a git checkout that contains both commits; no network.

- [ ] **Step 1: Write the failing test**

`scripts/ci/release-guard.test.sh`:

```bash
#!/usr/bin/env bash
# scripts/ci/release-guard.test.sh — run: bash scripts/ci/release-guard.test.sh
# Needs bash, git. Expected: passed=10 failed=0
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
GUARD="$HERE/release-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }

# A throwaway repository with three commits on main and one on a side branch:
#   c1  base
#   c2  adds backend/src/migrations/1700000000000-AddThing.ts
#   c3  touches only a README
#   side (from c1): touches only a README
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
cd "$T"; git init -q -b main .
mkdir -p backend/src/migrations
echo base > README.md; git add -A; git commit -q -m c1; c1=$(git rev-parse HEAD)
echo 'export class AddThing1700000000000 {}' > backend/src/migrations/1700000000000-AddThing.ts; git add -A; git commit -q -m c2; c2=$(git rev-parse HEAD)
echo more >> README.md; git add -A; git commit -q -m c3; c3=$(git rev-parse HEAD)
git checkout -q -b side "$c1"; echo side >> README.md; git add -A; git commit -q -m side; side=$(git rev-parse HEAD); git checkout -q main

run() { bash "$GUARD" "$@" >"$T/out" 2>"$T/err"; }

echo "# 1. first release: no production branch yet -> allowed"
check run "" "$c2" backend/src/migrations false
check grep -q "no production branch yet" "$T/out"

echo "# 2. forward move -> allowed"
check run "$c1" "$c3" backend/src/migrations false

echo "# 3. same commit -> allowed"
check run "$c2" "$c2" backend/src/migrations false

echo "# 4. backward move that crosses no migration (c3 -> c2) -> allowed"
check run "$c3" "$c2" backend/src/migrations false

echo "# 5. backward move across a migration (c2 -> c1) -> refused, names the file and the runbook"
check_fail run "$c2" "$c1" backend/src/migrations false
check grep -q "1700000000000-AddThing.ts" "$T/err"
check grep -q "backup-restore.md" "$T/err"

echo "# 6. the same with allow_schema_rollback=true -> allowed with a warning"
check run "$c2" "$c1" backend/src/migrations true

echo "# 7. a sideways move (neither ancestor) -> refused"
check_fail run "$c3" "$side" backend/src/migrations false

echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
```

(Ten `check`/`check_fail` calls: 2 + 1 + 1 + 1 + 3 + 1 + 1. The header is documentation; the assertion is the final `[ "$fail" -eq 0 ]`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/ci/release-guard.test.sh`
Expected: every `check run …` fails with `FAIL (expected success)` because `scripts/ci/release-guard.sh` does not exist (bash prints «No such file»), final line `passed=… failed=…` with `failed` > 0, exit 1.

- [ ] **Step 3: Write the guard**

`scripts/ci/release-guard.sh`:

```bash
#!/usr/bin/env bash
# scripts/ci/release-guard.sh LIVE_SHA TARGET_SHA MIGRATIONS_DIR ALLOW
#
# Decides whether moving production from LIVE_SHA (the commit the `production`
# branch points at; empty before the first release) to TARGET_SHA (a release
# tag's commit) is safe with respect to database migrations. Migrations run on
# backend start-up (migrationsRun: true) and never roll back by themselves, so
# deploying OLDER code onto a NEWER schema is the one move this refuses — unless
# ALLOW is the literal `true`, which the workflow sets only from an explicit
# `allow_schema_rollback` input. Runs inside a checkout containing both commits;
# never touches the network. Exit 0 = proceed, exit 1 = refused.
set -euo pipefail
live=${1-}; target=${2:?TARGET_SHA}; dir=${3:?MIGRATIONS_DIR}; allow=${4:-false}

if [ -z "$live" ]; then
  echo "release-guard: no production branch yet — first release, nothing to compare"
  exit 0
fi
if [ "$live" = "$target" ]; then
  echo "release-guard: production is already at $target"
  exit 0
fi
if git merge-base --is-ancestor "$live" "$target"; then
  echo "release-guard: forward move $live -> $target"
  exit 0
fi
if ! git merge-base --is-ancestor "$target" "$live"; then
  echo "release-guard: $target is neither ahead of nor behind production ($live) — refusing a sideways move; releases are cut from main" >&2
  exit 1
fi
changed=$(git diff --name-only "$target" "$live" -- "$dir")
if [ -z "$changed" ]; then
  echo "release-guard: rollback $live -> $target crosses no migration"
  exit 0
fi
{
  echo "release-guard: rolling back production from $live to $target crosses these migrations:"
  echo "$changed" | sed 's/^/  /'
} >&2
if [ "$allow" = true ]; then
  echo "::warning::allow_schema_rollback=true — deploying $target onto a schema that is already at $live's level"
  exit 0
fi
cat >&2 <<'EOF'
Refusing. Migrations run on backend start-up and never roll back by themselves,
so the older code would start against the newer schema. Ship a hotfix release
instead (forward-fix), or restore last night's pair per docs/backup-restore.md;
rerun with allow_schema_rollback=true only after verifying the down path by
hand — see docs/coolify-deploy.md «Rolling back».
EOF
exit 1
```

`chmod +x scripts/ci/release-guard.sh scripts/ci/release-guard.test.sh`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/ci/release-guard.test.sh`
Expected: `passed=10 failed=0`, exit 0. Then `npm run -s test:ci-scripts` (runs every `scripts/ci/*.test.sh`) — all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/release-guard.sh scripts/ci/release-guard.test.sh
git commit -m "ci(release): guard that refuses a production rollback across a migration (#186)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `ci.yml` — release triggers, `deploy-staging`, release-gated `deploy-prod`, previews on the staging app

**Files:**
- Modify: `.github/workflows/ci.yml` — the `on:` block (lines 3–6), the `docker` job's `env.BUILD` and `meta` step (≈ lines 503–545), the `deploy-preview` job's `app-uuid` line (≈ 713), and the whole `deploy-prod` job (≈ 769–end).

**Interfaces:**
- Consumes: `scripts/ci/release-guard.sh` from Task 1 (`LIVE TARGET DIR ALLOW`), `.github/actions/coolify-deploy` (inputs `coolify-url`, `coolify-api-token`, `app-uuid`, `base-url`, `commit`, `seed-username`, `seed-password`).
- Produces: repository variables/secrets the workflow now reads — `STAGING_ENABLED`, `STAGING_URL`, `COOLIFY_STAGING_APP_UUID` (created in Task 5).

- [ ] **Step 1: Triggers**

Replace lines 3–6 (`on:` … `pull_request:`) with:

```yaml
on:
  push:
    branches: [main]
  pull_request:
  # Production is deployed ONLY from here: publishing a GitHub Release
  # (vX.Y.Z, cut from main) or re-deploying an existing release tag by hand —
  # docs/coolify-deploy.md «Releasing to production» / «Rolling back».
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: 'An existing release tag to (re)deploy to production, e.g. v0.2.0'
        required: true
        type: string
      allow_schema_rollback:
        description: 'Deploy even if this moves production BACKWARDS across a migration (you have verified the down path by hand)'
        required: false
        type: boolean
        default: false
```

- [ ] **Step 2: The `docker` job builds on release/dispatch too, from the tag's commit, with a `vX.Y.Z` alias**

Replace the `env:` block of the `docker` job:

```yaml
    env:
      BUILD: >-
        ${{ github.event_name == 'push'
          || github.event_name == 'release'
          || github.event_name == 'workflow_dispatch'
          || needs.changes.result != 'success'
          || needs.changes.outputs.docker == 'true' }}
```

In the `meta` step, replace the `env:` and the `run:` script with:

```yaml
        env:
          IS_FORK: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository }}
          PR: ${{ github.event.pull_request.number }}
          SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
          # A release names its commit through github.sha; a manual re-deploy
          # names a tag, and github.sha would be main's HEAD — resolve the tag.
          RELEASE_TAG: ${{ github.event.release.tag_name || inputs.tag }}
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          if [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]; then
            SHA=$(gh api "repos/$GITHUB_REPOSITORY/commits/$RELEASE_TAG" --jq .sha)
          fi
          push=false
          # Dependabot PRs build but never push — they would otherwise each hold
          # a preview slot and their token cannot write packages. Scoped to
          # pull_request on purpose: an auto-merged Dependabot PR arrives on
          # main as a push by the same actor, and suppressing the image there
          # would skip deploy-staging with no signal at all.
          dependabot=false
          if [ "$GITHUB_EVENT_NAME" = pull_request ] && [ "$GITHUB_ACTOR" = 'dependabot[bot]' ]; then dependabot=true; fi
          if [ "$BUILD" = true ] && [ "$IS_FORK" != true ] && [ "$dependabot" != true ]; then push=true; fi
          echo "push=$push" >> "$GITHUB_OUTPUT"
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"
          # Cache scopes: PRs read prod's cache but write only their own, so
          # preview churn never evicts the seed main relies on. Releases are
          # main commits, so they share main's scope.
          case "$GITHUB_EVENT_NAME" in push|release|workflow_dispatch) scope='main';; *) scope='pr';; esac
          echo "scope=$scope" >> "$GITHUB_OUTPUT"
          {
            echo "backend_tags<<EOF"
            echo "ghcr.io/${GITHUB_REPOSITORY,,}-backend:sha-$SHA"
            [ -n "$PR" ] && echo "ghcr.io/${GITHUB_REPOSITORY,,}-backend:pr-$PR"
            # A release tag on the image keeps it out of the weekly cleanup
            # (scripts/ci/ghcr-cleanup.sh deletes only pr-*/sha-*-only versions),
            # so a later re-deploy of this release always finds it.
            [ -n "$RELEASE_TAG" ] && echo "ghcr.io/${GITHUB_REPOSITORY,,}-backend:$RELEASE_TAG"
            echo "EOF"
            echo "nginx_tags<<EOF"
            echo "ghcr.io/${GITHUB_REPOSITORY,,}-nginx:sha-$SHA"
            [ -n "$PR" ] && echo "ghcr.io/${GITHUB_REPOSITORY,,}-nginx:pr-$PR"
            [ -n "$RELEASE_TAG" ] && echo "ghcr.io/${GITHUB_REPOSITORY,,}-nginx:$RELEASE_TAG"
            echo "EOF"
          } >> "$GITHUB_OUTPUT"
          echo "build=$BUILD push=$push scope=$scope sha=$SHA release_tag=${RELEASE_TAG:-}"
```

Leave the rest of the `docker` job as it is (the checkout already uses `ref: ${{ steps.meta.outputs.sha }}`, so a dispatch builds the tag's commit).

- [ ] **Step 3: `deploy-preview` points at the staging application**

Change the one line `app-uuid: ${{ secrets.COOLIFY_APP_UUID }}` inside the `deploy-preview` job (≈ line 713; NOT the one in `deploy-prod`) to:

```yaml
          app-uuid: ${{ secrets.COOLIFY_STAGING_APP_UUID }}
```

and, in the same job's leading comment block (the one starting «Internal PRs only»), append:

```yaml
    # Previews are previews OF THE STAGING APPLICATION: the GitHub App matches a
    # PR webhook to an application by its branch (= the PR's base, main), and
    # production tracks `production` — see docs/coolify-deploy.md §Environments.
```

- [ ] **Step 4: Replace the whole `deploy-prod` job with `deploy-staging` + the new `deploy-prod`**

Delete from the line `  deploy-prod:` to the end of the file and append:

```yaml
  deploy-staging:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [verify, docker]
    # `!cancelled()` is load-bearing, not decoration. A skip propagates DOWN the
    # needs graph transitively: `changes` skips itself on push, `docker` survives
    # only via `always()`, and every job downstream of it then inherits that skip
    # unless its own `if` contains a status function. Without this the gate
    # evaluated true and the job was skipped anyway, so a merge to main reported
    # success while nothing deployed. The needs' results are therefore asserted
    # explicitly, since `!cancelled()` no longer implies they passed.
    #
    # STAGING_ENABLED is a pause switch, like PREVIEWS_ENABLED: flip it to false
    # to stop staging deploys without a commit.
    if: >-
      !cancelled()
      && needs.verify.result == 'success'
      && needs.docker.result == 'success'
      && github.event_name == 'push'
      && github.ref == 'refs/heads/main'
      && vars.COOLIFY_ENABLED == 'true'
      && vars.STAGING_ENABLED == 'true'
    concurrency:
      group: deploy-staging
      cancel-in-progress: false
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7

      # `concurrency` serialises staging deploys but does not order them, and
      # this repo merges stacked PRs forward in quick succession. Without this
      # guard a slower run for an older commit deploys AFTER the newer one and
      # puts staging behind main — while staying green, because its own
      # /api/health/version assertion compares against its own SHA.
      - name: Skip if main has moved on
        id: tip
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          tip=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)
          if [ "$tip" = "$GITHUB_SHA" ]; then
            echo "superseded=false" >> "$GITHUB_OUTPUT"
          else
            echo "superseded=true" >> "$GITHUB_OUTPUT"
            echo "::notice::main is at $tip, not $GITHUB_SHA — its own run owns staging; skipping."
          fi

      # Staging is seeded (SEED_DEV_DATA=true in its env set), so the same
      # seeded-login assertion previews make proves the seed ran here too.
      - uses: ./.github/actions/coolify-deploy
        if: steps.tip.outputs.superseded != 'true'
        with:
          coolify-url: ${{ secrets.COOLIFY_URL }}
          coolify-api-token: ${{ secrets.COOLIFY_API_TOKEN }}
          app-uuid: ${{ secrets.COOLIFY_STAGING_APP_UUID }}
          base-url: ${{ vars.STAGING_URL }}
          commit: ${{ github.sha }}
          seed-username: oksana
          seed-password: operator

  # Production is deployed only from a published GitHub Release (or a manual
  # re-deploy of an existing release tag). Coolify's deploy API takes no git
  # ref — it deploys the application's branch HEAD — so the production
  # application tracks a `production` branch that ONLY this job moves, to the
  # tag's commit, right before the deploy call. Order matters: images verified
  # first, the schema-rollback guard second, the branch move third, the deploy
  # last, so a refusal leaves both the branch and production untouched.
  deploy-prod:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [verify, docker]
    if: >-
      !cancelled()
      && needs.verify.result == 'success'
      && needs.docker.result == 'success'
      && (github.event_name == 'release' || github.event_name == 'workflow_dispatch')
      && vars.COOLIFY_ENABLED == 'true'
    concurrency:
      group: deploy-prod
      cancel-in-progress: false
    permissions:
      contents: write # moves the `production` branch
      packages: read # docker manifest inspect against GHCR
    env:
      GH_TOKEN: ${{ github.token }}
      TAG: ${{ github.event.release.tag_name || inputs.tag }}
      ALLOW_SCHEMA_ROLLBACK: ${{ inputs.allow_schema_rollback == true && 'true' || 'false' }}
    steps:
      - uses: actions/checkout@v7
        with:
          # The guard diffs two commits and the tag, main and production must
          # all be reachable: full history, all branches, all tags.
          fetch-depth: 0

      - name: Resolve the release
        id: target
        run: |
          set -euo pipefail
          target=$(git rev-parse -q --verify "refs/tags/$TAG^{commit}") \
            || { echo "::error::no tag named '$TAG' — releases are published from an existing tag"; exit 1; }
          git merge-base --is-ancestor "$target" origin/main \
            || { echo "::error::$TAG ($target) is not on main — releases are cut from main; merge the hotfix first"; exit 1; }
          live=$(git rev-parse -q --verify origin/production 2>/dev/null || true)
          echo "sha=$target" >> "$GITHUB_OUTPUT"
          echo "live=$live" >> "$GITHUB_OUTPUT"
          echo "tag=$TAG target=$target production=${live:-<none yet>}"

      - name: Both images exist for the release
        env:
          SHA: ${{ steps.target.outputs.sha }}
        run: |
          set -euo pipefail
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
          for img in backend nginx; do
            docker manifest inspect "ghcr.io/${GITHUB_REPOSITORY,,}-$img:sha-$SHA" >/dev/null \
              || { echo "::error::ghcr.io/${GITHUB_REPOSITORY,,}-$img:sha-$SHA is missing — publish the release again so the docker job rebuilds it"; exit 1; }
          done

      - name: Refuse to roll back across a migration
        run: bash scripts/ci/release-guard.sh "${{ steps.target.outputs.live }}" "${{ steps.target.outputs.sha }}" backend/src/migrations "$ALLOW_SCHEMA_ROLLBACK"

      - name: Move `production` to the release
        env:
          SHA: ${{ steps.target.outputs.sha }}
          LIVE: ${{ steps.target.outputs.live }}
        run: |
          set -euo pipefail
          # --force-with-lease: a rollback moves the branch backwards, but only
          # from the commit this run read; a concurrent move fails the push.
          if [ -n "$LIVE" ]; then
            git push --force-with-lease="refs/heads/production:$LIVE" origin "$SHA:refs/heads/production"
          else
            git push origin "$SHA:refs/heads/production"
          fi

      - uses: ./.github/actions/coolify-deploy
        with:
          coolify-url: ${{ secrets.COOLIFY_URL }}
          coolify-api-token: ${{ secrets.COOLIFY_API_TOKEN }}
          app-uuid: ${{ secrets.COOLIFY_APP_UUID }}
          base-url: ${{ vars.PROD_URL }}
          commit: ${{ steps.target.outputs.sha }}
```

- [ ] **Step 5: Validate the workflow file**

Run:

```bash
node -e "const y=require('js-yaml');const w=y.load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log(Object.keys(w.jobs).join(' '));console.log('on:',Object.keys(w.on).join(' '))"
grep -n "COOLIFY_APP_UUID\|COOLIFY_STAGING_APP_UUID" .github/workflows/ci.yml
npm run -s verify
```

Expected: jobs `changes verify docker deploy-preview preview-note-skipped deploy-staging deploy-prod`; `on: push pull_request release workflow_dispatch`; `COOLIFY_STAGING_APP_UUID` appears twice (deploy-preview, deploy-staging) and `COOLIFY_APP_UUID` once (deploy-prod); `verify` fast tier green (`test:ci-scripts` now includes the guard test).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: staging on every merge, production only by release (#186)

deploy-staging is the old deploy-prod re-pointed at the staging application
(STAGING_ENABLED pause switch, seeded-login check). deploy-prod runs on a
published release or a manual tag: images must exist, the rollback guard
must pass, then production moves to the tag and Coolify deploys it. The
docker job builds on release too and tags the image vX.Y.Z so the weekly
cleanup never prunes a release. Previews are previews of the staging app.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Runbook and CLAUDE.md

**Files:**
- Modify: `docs/coolify-deploy.md` — «How a deploy happens» (§ starting line 17), steps 4 and 6 of «One-time server setup», «Environment variables in Coolify» (table starting line 156), «Memory» (§ line 201), «When a deploy goes wrong» (table starting line 480); add «Environments», «Staging», «Releasing to production», «Rolling back».
- Modify: `CLAUDE.md` — first paragraph of «## Deployment».

**Interfaces:** none (documentation). Every claim below is what Tasks 1–2 and 5 implement; do not add behaviour the workflow does not have.

- [ ] **Step 1: Replace the numbered list at the top of «How a deploy happens»**

Replace the four numbered items (from `1. CI (\`docker\` job) pushes` through `then comments «Preview ready» / passes.`) with:

```markdown
## Environments

| Environment | Git | Coolify application | Data | Deploy trigger | URL |
|---|---|---|---|---|---|
| production | branch `production` — moved only by releases | `yagoda` | real; no seed | a published GitHub Release `vX.Y.Z`, or a manual re-deploy of one (`workflow_dispatch`) | `https://yagoda.webspirio.com` |
| staging | branch `main` | `yagoda-staging` (environment `staging`) | demo seed + whatever testers add; persists across deploys | every push to `main` | `https://staging.yagoda.webspirio.com` |
| preview `N` | the PR's head | a preview of `yagoda-staging` | demo seed; torn down when the PR closes | `deploy-preview` on an internal PR | `https://pr-N.yagoda.webspirio.com` |

`main` is never deployed to production directly, and nobody pushes
`production` by hand: the release workflow fast-forwards it (or, for an
explicit rollback, force-moves it), so every move is a workflow run with a
log. Previews belong to the staging application because the GitHub App
matches a PR webhook to an application by its branch — the PR's base,
`main` — and production no longer tracks `main`.

## How a deploy happens

1. CI (`docker` job) pushes `ghcr.io/webspirio/yagoda-starter-{backend,nginx}:sha-<commit>`
   on every PR, every push to `main` and every release (a release also tags
   the same image `vX.Y.Z`).
2. `deploy-staging` (push to `main`), `deploy-preview` (internal PR, all CI
   jobs green) or `deploy-prod` (release) calls `POST /api/v1/deploy` on
   Coolify (`scripts/ci/coolify-deploy.sh`) for the matching application.
3. Coolify checks out the application's branch HEAD (`main` for staging and
   previews, `production` for production — which `deploy-prod` has just moved
   to the release commit), sets `SOURCE_COMMIT`, and runs `docker compose up`
   on `docker-compose.prod.yml`, whose `image:` lines resolve to
   `sha-${SOURCE_COMMIT}`.
4. The job waits for Coolify, then checks `/api/health/ready`,
   `/api/health/version == sha-<commit>` and (staging, previews) a seeded
   login, and only then passes / comments «Preview ready».
```

- [ ] **Step 2: Add the three release sections right after that list (before the paragraph starting «Coolify's own auto-deploy is **off**»)**

```markdown
## Releasing to production

A release is a GitHub Release published from `main`:

```bash
gh release create v0.3.0 --target main --generate-notes --title "v0.3.0"
```

The workflow then, in this order and stopping loudly at the first failure:
resolves the tag (it must exist and its commit must be on `main`); builds and
pushes the images for that commit with both the `sha-<commit>` and the
`v0.3.0` tag; checks both images are in GHCR; runs the schema-rollback guard
(below); moves `production` to the tag's commit; deploys the production
application and asserts `/api/health/version` equals the commit. Read the
`deploy-prod` job log for any of those steps; production is untouched until
the branch move, and the branch move is the last step before the deploy.

A hotfix is a normal PR to `main` followed by a release. Never tag a commit
that is not on `main` — the workflow refuses it.

## Rolling back

**Forward-fix first.** Migrations run on backend start-up
(`migrationsRun: true`) and never roll back by themselves, so deploying older
code onto a newer schema is the one move that can break production. The
default rollback is therefore a hotfix release (`v0.3.1`) that fixes or
reverts the change in code.

**Re-deploying an older release** — *Actions → CI → Run workflow* with
`tag = v0.2.0` — is allowed when no migration file changed between the
commit `production` points at and the target: `deploy-prod` runs
`scripts/ci/release-guard.sh`, which refuses a move backwards across
`backend/src/migrations/` and prints the files. `allow_schema_rollback=true`
turns that refusal into a warning; use it only after verifying the down path
by hand (or after restoring the pair from `docs/backup-restore.md`). A
release's images are `v*`-tagged, which the weekly cleanup never deletes, so
an old release always has its images.

**After a failed production deploy** the `production` branch may point at a
commit that is not live (the branch moves before the deploy call).
`/api/health/version` is the truth, never the branch: re-run the release
(same tag) or re-deploy the previous one; both move the branch again.

## Staging

Staging is `main`, always: every merge redeploys `yagoda-staging` within
minutes (`deploy-staging`, paused with `STAGING_ENABLED=false`). It boots with
the demo seed (`SEED_DEV_DATA=true`, idempotent) and keeps its Postgres and
uploads volumes across deploys, so test data accumulates until someone
resets it: Coolify → `yagoda-staging` → *Persistent Storage* → delete the
`pg-data` and `uploads-data` volumes → *Redeploy* (the next boot re-seeds).
It runs at the preview-sized memory defaults (see «Memory»); it is public,
like previews, and its owner password lives only in its Coolify env set.
```

- [ ] **Step 3: Move the preview settings from the production application to the staging one in «One-time server setup»**

In step 4 (the GitHub App), replace `enable **Preview Deployments**; install it on \`yagoda-starter\` only.` with `install it on \`yagoda-starter\` only (Preview Deployments are a per-application setting — see step 6).`

Replace step 6's first three bullets (`- *General*: …` through the `Watch Paths` bullet ending `it never pushes their images either).`) with:

```markdown
   - *General*: domain for service `nginx` = `https://yagoda.webspirio.com`; **Auto Deploy: off**;
     **Preview Deployments: off** (previews belong to the staging application);
     branch **`production`** — not `main`; only the release workflow moves it
     (`docs/coolify-deploy.md` «Releasing to production»).
   - *Advanced*: **Include Source Commit** (`SOURCE_COMMIT`) on; *Watch Paths* blank.
   - *Environment Variables* — the production set below.
   - **Staging application** `yagoda-staging` (project *yagoda*, environment
     `staging`, created 2026-09-30 through the API — the exact calls are in
     `docs/superpowers/plans/2026-09-30-staging-deployment.md`, Task 5): same
     repository through the App, branch **`main`**, Docker Compose,
     `/docker-compose.prod.yml`, domain for `nginx` =
     `https://staging.yagoda.webspirio.com`; **Auto Deploy off**;
     **Preview Deployments on**, URL template `pr-{{pr_id}}.yagoda.webspirio.com`,
     *PR deployment access: repository members only*; *Watch Paths* **blank** —
     a watch path also filters the PR webhook, and it returns *before* the
     preview record is created, so CI's deploy would be refused with
     «Pull request N not found». Two env sets: staging (its own) and preview.
```

- [ ] **Step 4: Environment-variable table gets a Staging column**

Replace the table under «## Environment variables in Coolify» (header row through the `SEED_MEM_LIMIT` row) with:

```markdown
| Variable | Production (`yagoda`) | Staging (`yagoda-staging`) | Preview (`yagoda-staging`, preview set) | Note |
|---|---|---|---|---|
| `APP_URL` | `https://yagoda.webspirio.com` | `https://staging.yagoda.webspirio.com` | `https://yagoda.webspirio.com`¹ | CORS allowlist |
| `JWT_SECRET` | 48+ random chars | different 48+ random chars | different again | `openssl rand -base64 48` |
| `DB_PASSWORD` | random | random | random | |
| `BOOTSTRAP_OWNER_LOGIN` / `_PASSWORD` / `_FIRST_NAME` / `_LAST_NAME` | the real owner | `owner` / *generated* / `Staging` / `Owner` | `owner` / *generated* / `Preview` / `Owner` | read once, on the first boot of an empty DB. Each password is generated on the server and lives only in its Coolify set — a password written into a repo doc is a password on every deploy forever |
| `PASSWORD_VAULT_KEY` | *(set it, or leave the feature off)* | *(optional)* | *(optional)* | `openssl rand -base64 32`. Lets the owner READ an issued password back on «Користувачі» (issue #11). Absent = the feature is off and passwords are hashed only. **Never change it after passwords have been issued** — the existing copies stop opening (logins keep working; each password has to be reissued to become readable again) |
| `SEED_DEV_DATA` | *(absent — or the empty row the parser creates by itself)* | `true` | `true` | enables the one-shot `seed` service — **the only thing that keeps demo data out of production; never set it in the production env set**. Written as `${SEED_DEV_DATA}` in the compose: with a `:-` default the parser hardcodes production's empty value into previews and the seed never runs (see below) |
| `IMAGE_TAG` | *(absent)* | *(absent)* | *(absent)* | **never set** unless the fallback below is in force |
| `POSTGRES_MEM_LIMIT` | `768m` | *(absent → 256m)* | *(absent → 256m)* | see «Memory» below |
| `BACKEND_MEM_LIMIT` / `BACKEND_HEAP_MB` | `768m` / `576` | *(absent → 384m / 256)* | *(absent → 384m / 256)* | the heap cap must stay well below the mem_limit, so an OOM is a Node error, not a SIGKILL |
| `REDIS_MEM_LIMIT` / `NGINX_MEM_LIMIT` | `128m` / `64m` | *(absent → 64m / 64m)* | *(absent → 64m / 64m)* | |
| `SEED_MEM_LIMIT` / `SEED_HEAP_MB` | *(irrelevant — no seed in prod)* | *(absent → 256m / 192)* | *(absent → 256m / 192)* | |
```

- [ ] **Step 5: «Memory» — the cap**

In the «Memory» section, replace the sentence starting `At ~0.25 GiB each,` through `no commit.` with:

```markdown
Staging runs at the same preview-sized defaults and is always on, so it is
the first tenant of that budget: ~0.25 GiB. At ~0.25 GiB per preview, the cap
of **11** (`PREVIEW_CAP`, `ci.yml`; 12 before staging existed) uses ~2.75,
which with staging's ~0.25 leaves ~2.5 GiB — well past the ≥0.8–1.0 GiB the
design requires. Raise the cap with `gh variable set PREVIEW_CAP --body <n>`
— it takes effect on the next run, with no commit.
```

- [ ] **Step 6: «When a deploy goes wrong» — three rows**

Append to the table (after the `Prod is wrong after a merge` row, which becomes `Prod is wrong after a release`):

```markdown
| Prod is wrong after a release | | re-deploy the previous release (*Run workflow* with its tag) or ship a hotfix release — «Rolling back». **Neither reverts schema migrations** — see `docs/backup-restore.md` to restore last night's pair if a migration destroyed data. |
| `deploy-prod`: «no tag named …» / «… is not on main» | the Release was published from a tag that does not exist or was not cut from `main` | delete the Release, tag the right `main` commit, publish again |
| `deploy-prod`: «rolling back production … crosses these migrations» | the target release is older than a migration that is live | forward-fix (hotfix release); or re-run with `allow_schema_rollback=true` after verifying the down path — «Rolling back» |
| Staging did not update after a merge | `deploy-staging` skipped (`STAGING_ENABLED` not `true`, or a newer merge superseded the run) | check the job's notice; the newer merge's own run owns staging |
```

- [ ] **Step 7: `CLAUDE.md` «Deployment» paragraph**

Replace the first paragraph of «## Deployment» (from `Production and PR previews run on one Hetzner VPS` through `design: \`docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md\`.`) with:

```markdown
Production, staging and PR previews run on one Hetzner VPS under **Coolify**,
which pulls images CI built — it never builds. `.github/workflows/ci.yml`
pushes `ghcr.io/webspirio/yagoda-starter-{backend,nginx}:sha-<commit>` on every
PR, on `main` and on every release. **`main` deploys staging automatically**
(`deploy-staging`, seeded demo data, `https://staging.yagoda.webspirio.com`);
**production is deployed only by publishing a GitHub Release `vX.Y.Z`**
(`deploy-prod`: the production application tracks a `production` branch that
only that job moves, after a guard that refuses rolling back across a
migration); previews (`deploy-preview`, internal PRs, all CI jobs green) are
previews of the staging application. Every deploy job verifies the
application (`/api/health/ready`, `/api/health/version`, a seeded login on
staging and previews). `sha-<commit>` is the only tag ever deployed. Runbook,
env tables, failure modes and measured timing/cache baselines:
`docs/coolify-deploy.md`; designs:
`docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md` and
`docs/superpowers/specs/2026-09-30-staging-deployment-design.md`.
```

- [ ] **Step 8: Verify and commit**

Run: `npm run -s verify` (the `documents`/`secrets` rows read the docs; all green) and `grep -n "deploy-prod (push to" docs/coolify-deploy.md CLAUDE.md` (expected: no matches).

```bash
git add docs/coolify-deploy.md CLAUDE.md
git commit -m "docs(coolify): environments, releasing, rolling back and staging (#186)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Whole-branch verification and the PR

**Files:** none new.

- [ ] **Step 1: Full local verification**

Run: `npm run -s verify:prepush` — expected: every row PASSED (`test:ci-scripts` includes `release-guard.test.sh`; `compose` unchanged).

- [ ] **Step 2: Push and open the PR (ready for review — the branch is verified)**

```bash
git push -u origin feat/186-staging-deployment
gh pr create --title "feat(cd): staging on every merge, production only by release" --body-file - <<'EOF'
Closes #186.

`main` → staging automatically (`deploy-staging`, seeded, `https://staging.yagoda.webspirio.com`); production only by a published GitHub Release (`deploy-prod` on `release`/`workflow_dispatch`: images checked, schema-rollback guard, `production` branch moved to the tag, deploy, `version == commit`); previews are previews of the staging application. Spec: `docs/superpowers/specs/2026-09-30-staging-deployment-design.md`; plan: `docs/superpowers/plans/2026-09-30-staging-deployment.md`.

Coolify/GitHub side (Task 5 of the plan) is done before this merges: staging application + env sets, production application on branch `production` with previews off, `production` branch at the live commit, `COOLIFY_STAGING_APP_UUID`, `STAGING_URL`, `STAGING_ENABLED`, `PREVIEW_CAP=11`.

Acceptance (Task 6): this merge deploys staging; a probe PR gets a preview on the staging app and is torn down on close; `v0.2.0` deploys production; a dispatch with `v0.1.0` is refused by the guard.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Then set the board status of #186 to «Ready for review» (`gh project item-edit --project-id PVT_kwDODgfJK84Bhrnv --id <item id of #186> --field-id PVTSSF_lADODgfJK84BhrnvzhgmeHQ --single-select-option-id e51fd3ac`).

---

### Task 5: Coolify and GitHub — the environment itself (executed by the lead, not a subagent)

**Files:** none in the repository. Every command below runs from the developer machine; server commands over `ssh root@188.245.146.122`. Nothing is printed that is secret.

**Interfaces:**
- Produces: repository secret `COOLIFY_STAGING_APP_UUID`, variables `STAGING_URL`, `STAGING_ENABLED`, `PREVIEW_CAP`; the `production` branch; a Coolify application `yagoda-staging`.

- [ ] **Step 1: A temporary Coolify API token, kept in the session scratchpad only**

```bash
S=/tmp/claude-1000/-home-dz-work-yagoda-starter/f5283e60-bc1c-4d30-bd74-4d8e066b0fd0/scratchpad
ssh root@188.245.146.122 'docker exec coolify php artisan tinker --execute="echo App\Models\User::find(0)->createToken(\"rollout-186\", [\"read\",\"write\",\"deploy\"])->plainTextToken;"' | tail -1 > "$S/coolify-token"; chmod 600 "$S/coolify-token"; wc -c "$S/coolify-token"
```

Expected: a byte count around 50; nothing else printed. (User id 0 is the instance owner.)

- [ ] **Step 2: Environment `staging` and the application**

```bash
C=https://coolify.yagoda.webspirio.com/api/v1; T="Authorization: Bearer $(cat $S/coolify-token)"
curl -sS -X POST "$C/projects/vdnyrbsagu4ekkhtlwct7hby/environments" -H "$T" -H 'content-type: application/json' -d '{"name":"staging"}' | jq -c .
curl -sS -X POST "$C/applications/private-github-app" -H "$T" -H 'content-type: application/json' -d '{
  "project_uuid":"vdnyrbsagu4ekkhtlwct7hby","server_uuid":"gj5j8e0kqcamovacuynlsxkr","environment_name":"staging",
  "destination_uuid":"vxmuwsizdoxy1ofaeismrp0w","github_app_uuid":"knczywealfv7wvegax66ankx",
  "git_repository":"webspirio/yagoda-starter","git_branch":"main","build_pack":"dockercompose",
  "docker_compose_location":"/docker-compose.prod.yml","name":"yagoda-staging","ports_exposes":"80",
  "is_auto_deploy_enabled":false,"instant_deploy":false,"is_preview_deployments_enabled":true,"is_pr_deployments_public_enabled":false
}' | jq -c . | tee "$S/staging-app.json"
UUID=$(jq -r .uuid "$S/staging-app.json"); echo "staging app uuid=$UUID"
curl -sS -X PATCH "$C/applications/$UUID" -H "$T" -H 'content-type: application/json' -d '{
  "docker_compose_domains":{"nginx":{"domain":"https://staging.yagoda.webspirio.com"}},
  "preview_url_template":"pr-{{pr_id}}.{{domain}}","watch_paths":""
}' | jq -c .
```

Expected: the environment call returns the new environment; the create call returns `{"uuid": "...", ...}`; the PATCH returns the updated fields. If the PATCH rejects `docker_compose_domains`'s shape, set the domain in the UI (application → *General* → domain for `nginx`) and re-check with `curl -sS "$C/applications/$UUID" -H "$T" | jq .docker_compose_domains`.

Verify the settings landed in the database exactly as the spec says:

```bash
ssh root@188.245.146.122 "docker exec -i coolify-db psql -U coolify -d coolify -At -c \"select a.uuid,a.name,a.git_branch,a.source_id,a.repository_project_id,a.docker_compose_domains,a.preview_url_template,s.is_auto_deploy_enabled,s.is_preview_deployments_enabled,s.is_pr_deployments_public_enabled,a.watch_paths from applications a join application_settings s on s.application_id=a.id where a.uuid='$UUID';\""
```

Expected: `git_branch=main`, `source_id=3`, `repository_project_id=1358062429`, the staging domain, `pr-{{pr_id}}.{{domain}}`, auto-deploy `f`, previews `t`, public previews `f`, watch paths empty. Fix any field with a SQL `UPDATE` on that row if the API did not set it (this is the same table edited in #68).

- [ ] **Step 3: Two env sets, values generated on the server**

```bash
gen() { ssh root@188.245.146.122 "openssl rand -base64 $1 | tr -d '\n'"; }
add() { # add KEY VALUE IS_PREVIEW
  curl -sS -o /dev/null -w "$1 preview=$3 -> %{http_code}\n" -X POST "$C/applications/$UUID/envs" -H "$T" -H 'content-type: application/json' \
    -d "$(jq -nc --arg k "$1" --arg v "$2" --argjson p "$3" '{key:$k,value:$v,is_preview:$p,is_literal:false,is_multiline:false,is_shown_once:false,is_buildtime:false,is_runtime:true}')"
}
for p in false true; do
  if [ "$p" = false ]; then url=https://staging.yagoda.webspirio.com; fn=Staging; else url=https://yagoda.webspirio.com; fn=Preview; fi
  add APP_URL "$url" $p
  add JWT_SECRET "$(gen 48)" $p
  add DB_PASSWORD "$(gen 36)" $p
  add BOOTSTRAP_OWNER_LOGIN owner $p
  add BOOTSTRAP_OWNER_PASSWORD "$(gen 18)" $p
  add BOOTSTRAP_OWNER_FIRST_NAME "$fn" $p
  add BOOTSTRAP_OWNER_LAST_NAME Owner $p
  add SEED_DEV_DATA true $p
done
curl -sS "$C/applications/$UUID/envs" -H "$T" | jq -r '.[]|"\(.key) preview=\(.is_preview) len=\(.value|length)"' | sort
```

Expected: 16 lines of `201`/`200`; the listing shows each key twice with non-zero lengths (`SEED_DEV_DATA` len 4, `APP_URL` len 28/37). No value is printed.

- [ ] **Step 4: `production` branch at the commit production serves, then the production application follows it**

```bash
LIVE=$(curl -s https://yagoda.webspirio.com/api/health/version | jq -r .commit); echo "live=$LIVE"
gh api -X POST repos/webspirio/yagoda-starter/git/refs -f ref=refs/heads/production -f sha="$LIVE" --jq .ref
curl -sS -X PATCH "$C/applications/znuzjhodijlqzg0covvgcoqk" -H "$T" -H 'content-type: application/json' -d '{"git_branch":"production","is_preview_deployments_enabled":false}' | jq -c .
ssh root@188.245.146.122 "docker exec -i coolify-db psql -U coolify -d coolify -At -c \"select a.name,a.git_branch,s.is_preview_deployments_enabled from applications a join application_settings s on s.application_id=a.id order by a.id;\""
```

Expected: `refs/heads/production`; then `yagoda|production|f` and `yagoda-staging|main|t`. Production keeps running: nothing was deployed.

- [ ] **Step 5: Repository secrets and variables**

```bash
gh secret set COOLIFY_STAGING_APP_UUID --body "$UUID"
gh variable set STAGING_URL --body https://staging.yagoda.webspirio.com
gh variable set STAGING_ENABLED --body true
gh variable set PREVIEW_CAP --body 11
gh variable list; gh secret list
```

Expected: the four appear; `PREVIEWS_ENABLED`, `COOLIFY_ENABLED`, `PROD_URL`, `PREVIEW_DOMAIN` unchanged.

- [ ] **Step 6: Revoke the temporary token**

```bash
ssh root@188.245.146.122 "docker exec -i coolify-db psql -U coolify -d coolify -At -c \"delete from personal_access_tokens where name='rollout-186' returning id;\""
rm -f "$S/coolify-token"
```

Expected: one id returned. Record in the PR body that the token existed for the rollout and is gone.

---

### Task 6: Acceptance — merge, staging, a preview, a release, a refused rollback

**Files:** `docs/coolify-deploy.md` (one follow-up line per observation, in the PR that closes #186 if it is still open, otherwise a docs commit).

- [ ] **Step 1: Merge the PR (merge commit) and watch `deploy-staging`**

```bash
gh pr merge <N> --merge
run=$(gh run list --branch main --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId'); gh run watch "$run"
gh run view "$run" --json jobs --jq '.jobs[]|"\(.name) \(.conclusion)"'
curl -s https://staging.yagoda.webspirio.com/api/health/version; curl -s -o /dev/null -w "\nlogin=%{http_code}\n" -X POST -H 'content-type: application/json' -d '{"username":"oksana","password":"operator"}' https://staging.yagoda.webspirio.com/api/auth/login
```

Expected: `deploy-staging success`, `deploy-prod` absent/skipped, staging serves the merge commit, `login=200`. On the server the staging backend's `BOOTSTRAP_OWNER_PASSWORD` hash equals the staging env set's row (compare `sha256sum` of the container env value with the decrypted row via `php artisan tinker`, as done in #184 — hashes only).

- [ ] **Step 2: A preview on the staging application, and its teardown**

Open a throwaway PR from `main` that touches `.dockerignore` (a comment line), wait for `deploy-preview` → «Preview ready», confirm on the server the containers are `*-<staging uuid>-pr-N` and `application_previews` holds one row with `application_id` = the staging application; close the PR; within ~2 minutes no `pr-N` container/volume/network remains and the row is gone. Delete the branch.

- [ ] **Step 3: The first release**

```bash
gh release create v0.2.0 --target main --generate-notes --title "v0.2.0"
run=$(gh run list --event release --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId'); gh run watch "$run"
gh run view "$run" --json jobs --jq '.jobs[]|"\(.name) \(.conclusion)"'
git fetch origin production; git rev-parse origin/production; git rev-parse v0.2.0^{commit}
curl -s https://yagoda.webspirio.com/api/health/version
```

Expected: `docker success`, `deploy-prod success`; `production` == the tag's commit == the served commit; the production seed container exited 0 with `SEED_DEV_DATA` empty; GHCR has `…-backend:v0.2.0` (`gh api orgs/webspirio/packages/container/yagoda-starter-backend/versions` needs `read:packages`; alternatively `docker manifest inspect` after `docker login ghcr.io`).

- [ ] **Step 4: The guard refuses `v0.1.0`**

```bash
gh workflow run ci.yml -f tag=v0.1.0 -f allow_schema_rollback=false
run=$(gh run list --event workflow_dispatch --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId'); gh run watch "$run" || true
gh run view "$run" --log 2>/dev/null | grep -E "release-guard|crosses these migrations|Refusing" | head -5
git fetch origin production; git rev-parse origin/production
```

Expected: `deploy-prod failure` at «Refuse to roll back across a migration», the migration files listed, `production` still at `v0.2.0`'s commit, production untouched.

- [ ] **Step 5: Record and close**

Append to «Rolling back» in `docs/coolify-deploy.md`: `Exercised 2026-09-30: a dispatch with \`v0.1.0\` was refused at the guard (migrations since v0.1.0 listed), \`production\` stayed at v0.2.0.` Commit on a small docs branch, PR, merge (this deploys staging once more — expected). Board: #186 → Done happens with the merge of the main PR. Remove the worktree and delete the merged branches.
