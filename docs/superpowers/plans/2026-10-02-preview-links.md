# Preview links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PR preview gets GitHub's «View deployment» button and a link block in every issue the PR closes, kept current through deploy, failure, merge and close.

**Architecture:** One bash script, `scripts/ci/preview-links.sh`, owns every GitHub write (deployment records, issue bodies) behind four commands. The block rewrite is a pure function exposed as a fifth command, so tests can drive it without a fake API. `deploy-preview` calls the script around its existing Coolify deploy, and a new `preview-closed.yml` calls it when the PR closes.

**Tech Stack:** bash (3.2-safe), `gh api`, `jq`, POSIX awk, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-preview-links-design.md`

## Global Constraints

- Environment name: `preview`. Every deployment is `transient_environment: true`, `production_environment: false`, `auto_merge: false`, `required_contexts: []`, `task: deploy:preview`, `payload: {pr, sha}`. Every status is written with `auto_inactive: false`.
- Markers are whole lines: `<!-- yagoda-preview:pr-<N>:start -->` and `<!-- yagoda-preview:pr-<N>:end -->`.
- Block text is English (spec «Block texts»).
- The new `deploy-preview` steps are `continue-on-error: true` and report problems with `::warning::`.
- No untrusted `${{ }}` inside `run:`. Branch names and other PR-controlled values go through `env:`.
- Bash 3.2: no `mapfile`, no associative arrays, no `${x,,}`. Empty arrays use `${a[@]+"${a[@]}"}`.
- No hand-written counts in `scripts/verify/registry.mjs` prose (verify rule 5).

## Review Focus

1. **CRLF issue bodies** (written in the web UI). The block is still found and replaced, and the user's text survives. → Task 1 test «CRLF».
2. **An issue the user edited and broke the markers in** (start marker without an end marker). The body is left alone and never truncated. → Task 1 test «malformed».
3. **Re-running the job on an unchanged commit.** No edit is written to the issue when nothing changed. → Task 2 test «unchanged → no PATCH».
4. **Another PR closing the same issue.** Its block is untouched by ours. → Task 1 test «other PR's block».
5. **A PR whose branch name contains `/`** (`feat/x`). The deployment list query is URL-encoded by `gh -f`, and the create body carries the raw ref. → Task 2 fixture uses `feat/x`.

---

### Task 1: block rewrite (pure)

**Files:**
- Create: `scripts/ci/preview-links.sh` (dispatch plus `upsert_block`)
- Create: `scripts/ci/preview-links.test.sh` (harness plus block cases)

**Interfaces:**
- Produces: `preview-links.sh block-upsert <pr> <block-file> < body`. It prints the new body on stdout with no trailing newline. Exit 0, or exit 3 when the start marker has no end marker (prints nothing).
- `upsert_block <pr> <block-file>` (shell function, stdin → stdout) is used by Task 2.

- [ ] Step 1: write the test harness (`check`/`check_fail`, `$T` tmpdir, `passed=N failed=M` summary in the house style of `release-guard.test.sh`) and these cases:
  - append to `Hello`;
  - replace in place, with text after the block preserved;
  - another PR's block untouched;
  - empty block file → block removed, no trailing blank lines;
  - CRLF body → no `\r` in output, user lines intact;
  - empty body → the block alone;
  - start without end → exit 3.
- [ ] Step 2: `bash scripts/ci/preview-links.test.sh` → FAIL (script missing).
- [ ] Step 3: implement `upsert_block` as `tr -d '\r' | awk …`. The awk script:
  - collects lines;
  - finds this PR's first start and the first end after it;
  - exits 3 on start-without-end;
  - emits lines with the start..end range replaced by the block file's contents (or dropped);
  - appends after one blank line when there was no range;
  - trims trailing newlines.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit `feat(ci): preview-links.sh — the issue block rewrite`.

### Task 2: deployment records and issue updates

**Files:**
- Modify: `scripts/ci/preview-links.sh`
- Modify: `scripts/ci/preview-links.test.sh` (fake `gh`)

**Interfaces:**
- Consumes: `upsert_block`.
- Produces (env as in the script header):
  - `deploy-start` writes `deployment_id=<id>` to `$GITHUB_OUTPUT`;
  - `deploy-finish success|failure` reads `DEPLOYMENT_ID`, plus optional `COOLIFY_DEPLOYMENT_UUID`;
  - `issues ready|failed`;
  - `closed true|false`.
  - Exit non-zero plus `::warning::` on any failure. `deploy-finish` without `DEPLOYMENT_ID` exits 0 without calling anything.

Fake `gh`:
- Logs one line per call: `KEY<TAB>FIELDS<TAB>STDIN`. KEY is `METHOD path` for `gh api` and `pr-view` for `gh pr view`.
- Serves `$FAKE_GH/responses/<sanitised KEY>`. A missing response file, or a `.fail` marker, makes it exit 1.
- The script sends one-line JSON (`jq -nc … | gh api … --input -`).

- [ ] Step 1: add the cases:
  - deploy-start deactivates only this PR's non-inactive deployment (fixture: PR 5's live one, PR 5's already inactive one, and PR 6's), creates with the Global Constraints body, posts `in_progress`, and writes `deployment_id=99`;
  - deploy-start create failure → non-zero, warning, no output line;
  - deploy-finish success → status body carries `auto_inactive:false`, `environment_url`, `log_url` and the Coolify uuid in `description`;
  - deploy-finish with no id → exit 0, zero calls;
  - issues ready → only this repo's issue is read and patched, the body carries the URL and `sha7`, and the foreign-repo issue is never read;
  - unchanged → no PATCH;
  - first issue's GET fails → the second is still patched, overall non-zero;
  - issues failed → `⚠️ The latest deploy`;
  - no closing issues → exit 0;
  - closed true → merged text plus the staging URL, and the deployment deactivated;
  - closed false → block removed.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement `render_block`, `own_deployments`, `post_status`, `deactivate_own`, `closing_issues`, `update_issue`, and the four commands.
- [ ] Step 4: run → PASS; `npm run test:ci-scripts` → PASS.
- [ ] Step 5: commit `feat(ci): preview-links.sh — deployment records and issue blocks`.

### Task 3: wire the workflows

**Files:**
- Modify: `.github/workflows/ci.yml` (`deploy-preview`: `deployments: write`; `HEAD_REF`, `SEED_USERNAME`, `SEED_PASSWORD` in the job env, with the deploy step's `with:` reading them; three new steps)
- Create: `.github/workflows/preview-closed.yml`

- [ ] Step 1: `deploy-preview` changes:
  - after «Claim a preview slot», `Deployment record — start` (`id: gh-deployment`, `if: steps.cap.outputs.blocked != 'true'`, `continue-on-error: true`);
  - after the comment steps, `Deployment record — finish` and `Preview link in the closing issues`, both `if: "!cancelled() && (steps.deploy.outcome == 'success' || steps.deploy.outcome == 'failure')"` and `continue-on-error: true`, with the state derived from `steps.deploy.outcome`.
- [ ] Step 2: `preview-closed.yml` as specified: `pull_request: closed`; same-repo + `preview` label + both vars; least-privilege permissions; per-PR concurrency; sparse checkout of `scripts/ci` at the head SHA.
- [ ] Step 3: lint the YAML. Run `npx --yes actionlint` if available, otherwise parse it with `node -e` through `yaml` from node_modules.
- [ ] Step 4: commit `feat(ci): a deployment record and an issue block for every preview`.

### Task 4: docs and the verify row

**Files:**
- Modify: `scripts/verify/registry.mjs` (`test:ci-scripts` `proves`/`blindSpot`: name the glob, 40–80 words, no numbers)
- Modify: `docs/coolify-deploy.md` (step 4 of «How a deploy happens», a paragraph on where the link appears, two rows in «When a deploy goes wrong»)
- Modify: `CLAUDE.md` «Deployment» (one sentence)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (deferred staging/production environments)

- [ ] Step 1: edit the files.
- [ ] Step 2: `npm run verify`. Paste the verdict line.
- [ ] Step 3: commit `docs(cd): where a preview's link appears, and the verify row names its glob`.

### Task 5: prove it on GitHub

- [ ] Open a tracking issue, then push and open the PR with `Closes #<issue>`.
- [ ] After `deploy-preview`, check:
  - the PR timeline shows «View deployment»;
  - `gh api repos/{owner}/{repo}/deployments` lists one `preview` record whose latest status is `success`;
  - the issue body carries the block.
- [ ] If the button is missing with `ref` = branch, switch to `ref` = head SHA (spec fallback) and re-run.
- [ ] `preview-closed.yml` is proven only by the merge. Say so in the PR.
