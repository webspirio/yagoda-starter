# Preview links where people look — design

**Date:** 2026-10-02 · **Status:** approved in chat (grilling + brainstorming, 2026-10-02)

## Problem

A PR preview (`https://pr-<N>.<PREVIEW_DOMAIN>`) is announced in exactly one place: the
sticky `github-actions` comment `deploy-preview` keeps on the PR. On a busy PR it sinks
under automated reviews and replies (#170 has 18 comments), and the people who test a
change — the issue authors — work in the ISSUE, not the PR. Nothing in GitHub's own UI
points at the preview: the repository has no environment and no deployment record.

## Outcome

1. Every PR with a live preview shows GitHub's own **«View deployment»** button, backed by
   a deployment record in a `preview` environment whose status follows the deploy that
   `deploy-preview` verified.
2. Every issue the PR closes carries a short block at the end of its BODY with the link,
   the commit, the demo sign-in, and what happens when the PR merges or closes.
3. The sticky PR comment is unchanged.

Out of scope: environments for staging and production (deferred, follow-ups doc), and
Coolify's own `yagoda-coolify-pr-preview[bot]` comment (untouched).

## Decisions (settled with the user)

| # | Decision |
|---|---|
| D1 | The issue block lives in the issue BODY between per-PR markers, not in a comment — a comment sinks the same way the PR comment does. |
| D2 | Block text is English. States: ready · failed (link kept, warning added) · merged (points at staging) · removed (closed unmerged). No block when the preview cap refuses the deploy. |
| D3 | ONE shared environment, `preview`. Deployments are `transient_environment: true` — GitHub's `auto_inactive` already skips transient records, so PR B's deploy cannot deactivate PR A's button — and every status states `auto_inactive: false` as well, so that does not hang on one flag; the script deactivates only its own PR's older deployments. A per-PR environment was rejected: hundreds would pile up, and deleting one needs an administration-scoped token in CI. |
| D4 | The sticky PR comment stays as it is (it is the only one of the three that notifies). |
| D5 | Staging/production environments are a follow-up, not this change. |
| D6 | The new steps are `continue-on-error: true` and report `::warning::`. A red `deploy-preview` means «the preview is broken» — the cap and re-runs are read off it — and must not start meaning «a link could not be written». |
| D7 | The GitHub deployment status `description` names the Coolify deployment uuid, so a GitHub record and the Coolify bot's comment for the same deploy can be matched by eye. |

## How it stays in sync with Coolify

The deployment record is written by the same job that triggers the Coolify deploy and
waits for it (`.github/actions/coolify-deploy`), so its status reflects THAT deployment —
and `success` is stricter than Coolify's 🟢: `/api/health/ready` answered, `/api/health/version`
returned this exact commit, and the seeded login worked. Coolify's push-time webhook deploy
(always red, `docs/coolify-deploy.md` «Failure modes») never reaches GitHub; until the job
starts, GitHub keeps showing the previous successful deployment, which is what is still
serving. Closing the PR fires both Coolify's stack removal (App webhook) and the new
workflow. Coolify's own «environments» (production/staging inside its project) are a
separate concept and are not mirrored; GitHub `preview` = previews of the Coolify
application `yagoda-staging`. A deploy started by hand in Coolify's UI is not recorded.

## Components

### `scripts/ci/preview-links.sh <command>`

Talks to GitHub through `gh api` (preinstalled on runners, already used in this job) and
parses with `jq`. Bash 3.2-safe like the other `scripts/ci` files.

| Command | Called from | Does |
|---|---|---|
| `deploy-start` | `deploy-preview`, after «Claim a preview slot» | marks this PR's previous non-inactive `preview` deployments `inactive`; creates a deployment; status `in_progress`; writes `deployment_id` to `GITHUB_OUTPUT` |
| `deploy-finish <success\|failure>` | `deploy-preview`, after «Deploy preview» | status `success`/`failure` with `environment_url`, `log_url` (this run), `description` |
| `issues <ready\|failed>` | `deploy-preview`, after «Deploy preview» | upserts the block in every closing issue of this repo |
| `closed <true\|false>` (merged?) | new workflow | deactivates this PR's deployments; merged → merged block, otherwise the block is removed |

Deployment create body: `ref` = the PR head branch, `environment: preview`,
`transient_environment: true`, `production_environment: false`, `task: deploy:preview`,
`payload: {pr, sha}`, **`auto_merge: false`** (the default would try to merge `main` into
the PR branch) and **`required_contexts: []`** (the default refuses with 409 while this
very run's checks are pending). «This PR's deployments» = `GET deployments?environment=preview&ref=<head branch>`
filtered on `payload.pr`.

The PR timeline is assumed to show a deployment whose `ref` is the PR's head branch. That
is checked on this change's own PR; the fallback is `ref` = head SHA.

### The issue block

Closing issues come from `gh pr view --json closingIssuesReferences`, filtered to this
repository (case-insensitive `owner/name`). Per issue: read the body immediately before
writing, transform, `PATCH` only when the normalised result differs from the normalised
original. Each issue is independent — one failure is a warning and the rest continue.

The transformation is a pure function of (body, PR number, new block or empty):

- markers: a whole line `<!-- yagoda-preview:pr-<N>:start -->` … `<!-- yagoda-preview:pr-<N>:end -->`;
- CRLF is normalised to LF first (web-UI bodies carry `\r\n`); a `null` body is empty;
- block present → replaced in place; absent → appended after one blank line; empty new
  block → removed; trailing blank lines are trimmed;
- another PR's block is never touched;
- a start marker with no end marker → body left untouched, warning (never delete from the
  marker to EOF: that could be the author's text).

Block texts (`<sha7>` = first seven characters of the head SHA):

```
ready:   > **🔍 Preview for #196:** https://pr-196.yagoda.webspirio.com
         > Commit `5f15c25` · sign in as `oksana` / `operator` · removed when the PR closes
failed:  > **🔍 Preview for #196:** https://pr-196.yagoda.webspirio.com
         > ⚠️ The latest deploy (`abc1234`) failed — the preview may still be serving an older commit.
         > Sign in as `oksana` / `operator` · removed when the PR closes
merged:  > ✅ #196 was merged — it will be on staging in a few minutes: https://staging.yagoda.webspirio.com
         (without STAGING_URL: «✅ #196 was merged.»)
```

GitHub renders a newline inside an issue body as a line break, so consecutive quoted
lines stay on separate lines without `<br>`. The failed block drops the «Commit» line on
purpose: the preview may not be serving that commit.

### `.github/workflows/preview-closed.yml`

`on: pull_request: types: [closed]`; runs only for a same-repository head with
`COOLIFY_ENABLED` and `PREVIEWS_ENABLED` both `true`. Not gated on the `preview` label: the
runbook has people drop it by hand to free a cap slot, and a PR without a preview costs one
no-op run, because on a merge the script only REPLACES an existing block. Permissions
`contents: read`, `deployments: write`, `issues: write`, `pull-requests: read`. Sparse
checkout of `scripts/ci` at the PR head SHA (a closed, unmerged PR may have no merge ref).
`concurrency: preview-closed-<N>`. It touches no server.

### `ci.yml` → `deploy-preview`

Adds `deployments: write`, three steps (all `continue-on-error: true`), and the env the
script reads. `deploy-finish` and `issues` run under `!cancelled() && steps.cap.outputs.blocked != 'true'`
so a failed deploy still records `failure` and the ⚠️; the state comes from
`steps.deploy.outcome`. They skip when `deploy-start` produced no deployment id (finish) —
a deployment is never created after the fact. The existing comment steps keep their
`success()`/`failure()` conditions: a `continue-on-error` step cannot flip either.

### Races handled after review

- **A merge while `deploy-preview` is still running.** A merge does not cancel that run, so
  `deploy-start`, `deploy-finish` and `issues` first check that the PR is still `OPEN` and do
  nothing otherwise; an unreadable state counts as open (a warning). Without it the late run
  revived the record and turned «merged» back into a link to a removed stack.
- **A cancelled run** posts `error` on its record (`if: cancelled()`), instead of leaving it
  `in_progress`.
- **Two copies of one PR's block** (a lost update between two writers): the first range is
  replaced, the rest dropped.

## Testing

`scripts/ci/preview-links.test.sh`, collected by `test:ci-scripts`'s glob and by
`testfiles`. A fake `gh` serves canned JSON keyed by method + path and logs every call with
its fields and stdin, so tests assert what was SENT. Cases: the block function (append,
replace, other PR untouched, remove, CRLF, null/empty body, unchanged → no PATCH,
malformed marker → untouched); `deploy-start` deactivates only this PR's live deployments
and sends `auto_merge:false`, `required_contexts:[]`, `transient_environment:true`;
`deploy-finish` sends `auto_inactive:false`; foreign-repo closing issues ignored; one
failing issue does not stop the next; `closed` merged / unmerged. No sleeps, no network.

`npm run verify` (fast tier) is the gate for the script. It cannot see GitHub: the real
proof is this change's own PR (the button, the issue block) and its merge (the merged
block, the deployment going inactive).

The `test:ci-scripts` row's `proves` names two scripts by hand while three already exist;
it is rewritten to name the glob instead (verify skill, rule 6).

## Docs

`docs/coolify-deploy.md` (where the link appears, the `preview` environment, the new
workflow, a failure-mode row), one sentence in `CLAUDE.md` «Deployment», and the deferred
staging/production environments in the follow-ups doc.
