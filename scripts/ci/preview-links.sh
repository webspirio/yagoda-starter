#!/usr/bin/env bash
# Put a PR preview's link where people look (docs/superpowers/specs/2026-10-02-preview-links-design.md):
#   * a GitHub deployment in the shared `preview` environment, so the PR shows «View deployment»;
#   * a block at the end of the BODY of every issue the PR closes.
#
# Usage:
#   preview-links.sh deploy-start                   deactivate this PR's older deployments, create one
#   preview-links.sh deploy-finish success|failure|error  set the deployment's final status
#   preview-links.sh issues ready|failed            write the block into every closing issue
#   preview-links.sh closed true|false              (merged?) deactivate; block → staging, or removed
#   preview-links.sh block-upsert <pr> <block-file> [replace-only] < body   pure; prints the new body
#
# deploy-start, deploy-finish and issues do nothing once the PR is no longer open: a merge
# does not cancel a deploy-preview run already in flight, and without the check that run
# would overwrite what preview-closed.yml has just tidied — reviving the record and
# turning «merged» back into a link to a stack Coolify has removed.
#
# Env: GITHUB_REPOSITORY PR HEAD_REF HEAD_SHA PREVIEW_URL, and as each command needs them
#      DEPLOYMENT_ID [COOLIFY_DEPLOYMENT_UUID] [SEED_USERNAME SEED_PASSWORD] [STAGING_URL]
#      [GITHUB_SERVER_URL GITHUB_RUN_ID] [GITHUB_OUTPUT]; GH_TOKEN for gh itself.
#
# Every failure is a ::warning:: and a non-zero exit. deploy-preview runs these steps with
# continue-on-error: a red deploy-preview has to keep meaning «the preview is broken».
set -euo pipefail

warn() { echo "::warning::$*" >&2; }
usage() { sed -n '6,16p' "$0" >&2; exit 2; }
need() {
  local v
  for v in "$@"; do [ -n "${!v:-}" ] || { warn "preview-links: $v is not set"; exit 1; }; done
}
sha7() { printf '%s' "${HEAD_SHA:0:7}"; }

# upsert_block <pr> <block-file> [replace-only]: body on stdin, new body on stdout, no
# trailing newline. The block file's contents (markers included) replace this PR's first
# marker range in place, and any further copy of it is dropped (a lost update between two
# writers can leave two); with no range the block is appended after one blank line, or
# with replace-only the body is returned as it was. An empty file removes every range.
# CRLF becomes LF first, because a body written in the web UI carries CRLF and a marker
# line ending in \r would never match. A start marker with no end marker after it exits 3
# and prints nothing: the only other reading is «delete to the end of the body», and
# whatever follows that marker may be the author's own text.
upsert_block() {
  tr -d '\r' | awk -v start="<!-- yagoda-preview:pr-$1:start -->" \
                   -v end="<!-- yagoda-preview:pr-$1:end -->" -v bf="$2" -v mode="${3:-}" '
    BEGIN { blk = ""; while ((getline l < bf) > 0) blk = blk l "\n" }
    { line[++n] = $0 }
    END {
      # skip[i] marks every line inside a range; first[i] the start of the first range.
      ranges = 0; open_at = 0
      for (i = 1; i <= n; i++) {
        if (!open_at && line[i] == start) open_at = i
        else if (open_at && line[i] == end) {
          for (j = open_at; j <= i; j++) skip[j] = 1
          if (!ranges) first[open_at] = 1
          ranges++; open_at = 0
        }
      }
      if (open_at) exit 3
      out = ""
      for (i = 1; i <= n; i++) {
        if (first[i]) out = out blk
        if (!skip[i]) out = out line[i] "\n"
      }
      sub(/\n+$/, "", out)
      if (!ranges && blk != "" && mode != "replace-only") out = (out == "" ? "" : out "\n\n") blk
      sub(/\n+$/, "", out)
      printf "%s", out
    }'
}

# render_block ready|failed|merged|none: the block, markers included; nothing for none.
# A newline inside an issue body renders as a line break, so each quoted line stays a line.
render_block() {
  [ "$1" = none ] && return 0
  local seed="" Seed=""
  if [ -n "${SEED_USERNAME:-}" ]; then
    seed="sign in as \`$SEED_USERNAME\` / \`${SEED_PASSWORD:-}\` · "
    Seed="Sign in as \`$SEED_USERNAME\` / \`${SEED_PASSWORD:-}\` · removed when the PR closes"
  else
    Seed="Removed when the PR closes"
  fi
  printf '<!-- yagoda-preview:pr-%s:start -->\n' "$PR"
  case "$1" in
    ready)
      printf '> **🔍 Preview for #%s:** %s\n' "$PR" "$PREVIEW_URL"
      printf '> Commit `%s` · %sremoved when the PR closes\n' "$(sha7)" "$seed" ;;
    failed)
      # No «Commit» line: the preview may not be serving this commit at all.
      printf '> **🔍 Preview for #%s:** %s\n' "$PR" "$PREVIEW_URL"
      printf '> ⚠️ The latest deploy (`%s`) failed — the preview may still be serving an older commit.\n' "$(sha7)"
      printf '> %s\n' "$Seed" ;;
    merged)
      if [ -n "${STAGING_URL:-}" ]; then
        printf '> ✅ #%s was merged — it will be on staging in a few minutes: %s\n' "$PR" "$STAGING_URL"
      else
        printf '> ✅ #%s was merged.\n' "$PR"
      fi ;;
  esac
  printf '<!-- yagoda-preview:pr-%s:end -->\n' "$PR"
}

# --- deployment records ------------------------------------------------------
# ONE environment for every PR (spec D3), so «this PR's deployments» is a query: the
# PR's head branch as `ref`, confirmed by the payload's PR number.
own_deployments() {
  gh api -X GET "repos/$GITHUB_REPOSITORY/deployments" \
      -f environment=preview -f ref="$HEAD_REF" -f per_page=100 \
    | jq -r --argjson pr "$PR" '.[] | select(.payload.pr? == $pr) | .id'
}

# post_status <deployment id> <state> [description]. auto_inactive is false on EVERY
# status. GitHub's default already skips transient deployments, and every record here is
# transient — stating it means another PR's «View deployment» does not hang on that flag
# alone; this script deactivates its own PR's older records explicitly.
post_status() {
  local log_url=""
  [ -n "${GITHUB_RUN_ID:-}" ] && log_url="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  jq -nc --arg state "$2" --arg env_url "${PREVIEW_URL:-}" --arg log_url "$log_url" --arg d "${3:-}" '
      {state: $state, auto_inactive: false}
      + (if $state != "inactive" and $env_url != "" then {environment_url: $env_url} else {} end)
      + (if $log_url != "" then {log_url: $log_url} else {} end)
      + (if $d != "" then {description: $d} else {} end)' \
    | gh api -X POST "repos/$GITHUB_REPOSITORY/deployments/$1/statuses" --input - > /dev/null
}

deactivate_own() {
  local ids id state
  ids=$(own_deployments) || { warn "could not list #$PR's preview deployments"; return 1; }
  for id in $ids; do
    state=$(gh api "repos/$GITHUB_REPOSITORY/deployments/$id/statuses?per_page=1" | jq -r '.[0].state // "none"') \
      || { warn "could not read deployment $id's status"; return 1; }
    [ "$state" = inactive ] && continue
    post_status "$id" inactive || { warn "could not deactivate deployment $id"; return 1; }
    echo "deployment $id: inactive"
  done
}

# pr_is_open: false only when GitHub says the PR is closed or merged. A state that cannot
# be read is a warning and counts as open — losing a link is worse than a rare overwrite.
pr_is_open() {
  local state
  state=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json state | jq -r '.state // empty') || state=""
  if [ -z "$state" ]; then warn "could not read #$PR's state — carrying on as if it were open"; return 0; fi
  if [ "$state" != OPEN ]; then echo "#$PR is no longer open ($state) — preview-closed.yml owns its links now"; return 1; fi
}

deploy_start() {
  need GITHUB_REPOSITORY PR HEAD_REF HEAD_SHA PREVIEW_URL
  pr_is_open || return 0
  deactivate_own || exit 1
  # auto_merge: false — the default merges the default branch INTO the PR branch when it
  # is behind. required_contexts: [] — the default refuses (409) while this very run's
  # checks are still pending, which they always are at this point.
  local id
  id=$(jq -nc --arg ref "$HEAD_REF" --arg sha "$HEAD_SHA" --argjson pr "$PR" --arg d "sha-$(sha7)" '
        {ref: $ref, environment: "preview", transient_environment: true,
         production_environment: false, task: "deploy:preview", auto_merge: false,
         required_contexts: [], description: $d, payload: {pr: $pr, sha: $sha}}' \
      | gh api -X POST "repos/$GITHUB_REPOSITORY/deployments" --input - | jq -r '.id // empty') || id=""
  [ -n "$id" ] || { warn "could not create the preview deployment for #$PR — no «View deployment» for this run"; exit 1; }
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "deployment_id=$id" >> "$GITHUB_OUTPUT"; fi
  post_status "$id" in_progress "sha-$(sha7)" || { warn "deployment $id was created, but in_progress was refused"; exit 1; }
  echo "deployment $id: in_progress"
}

deploy_finish() {
  if [ -z "${DEPLOYMENT_ID:-}" ]; then
    echo "no deployment id — deploy-start created none, so there is nothing to finish"
    return 0
  fi
  need GITHUB_REPOSITORY PR HEAD_SHA PREVIEW_URL
  pr_is_open || return 0
  # D7: the Coolify uuid matches this record to the Coolify bot's comment for the same deploy.
  # `error` is a cancelled run: without it the record would sit at in_progress for good.
  local d
  d="sha-$(sha7)"
  if [ -n "${COOLIFY_DEPLOYMENT_UUID:-}" ]; then d="$d · coolify $COOLIFY_DEPLOYMENT_UUID"; fi
  if [ "$1" = error ]; then d="$d · run cancelled"; fi
  post_status "$DEPLOYMENT_ID" "$1" "$d" || { warn "could not mark deployment $DEPLOYMENT_ID $1"; exit 1; }
  echo "deployment $DEPLOYMENT_ID: $1"
}

# --- issue blocks ------------------------------------------------------------
closing_issues() {
  gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json closingIssuesReferences \
    | jq -r --arg repo "$GITHUB_REPOSITORY" '.closingIssuesReferences[]
        | select(((.repository.owner.login + "/" + .repository.name) | ascii_downcase) == ($repo | ascii_downcase))
        | .number'
}

# update_issue <number> <block-file> [replace-only]. The body is read immediately before the write, and
# nothing is written when the result equals what is there (CRLF aside) — a re-run must not
# keep stamping «edited» on someone else's issue.
update_issue() {
  local n=$1 bf=$2 mode=${3:-} raw new rc=0
  raw=$(gh api "repos/$GITHUB_REPOSITORY/issues/$n" | jq -r '.body // ""') \
    || { warn "issue #$n: could not read its body"; return 1; }
  new=$(printf '%s' "$raw" | upsert_block "$PR" "$bf" "$mode") || rc=$?
  if [ "$rc" -eq 3 ]; then
    warn "issue #$n: a yagoda-preview:pr-$PR start marker has no end marker — left untouched"
    return 1
  fi
  [ "$rc" -eq 0 ] || { warn "issue #$n: rewriting the body failed"; return 1; }
  if [ "$new" = "$(printf '%s' "$raw" | tr -d '\r')" ]; then echo "issue #$n: unchanged"; return 0; fi
  jq -nc --arg body "$new" '{body: $body}' \
    | gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/$n" --input - > /dev/null \
    || { warn "issue #$n: could not write its body"; return 1; }
  echo "issue #$n: updated"
}

# issues_cmd ready|failed|merged|none. Each issue on its own: one failure is a warning,
# and the rest are still written. `merged` only REPLACES a block: an issue this PR never
# wrote to (no preview ever deployed, or the label dropped by hand) is left alone.
issues_cmd() {
  local bf nums n rc=0
  bf=$(mktemp)
  render_block "$1" > "$bf"
  if ! nums=$(closing_issues); then
    warn "could not read the issues #$PR closes"; rm -f "$bf"; return 1
  fi
  if [ -z "$nums" ]; then
    echo "#$PR closes no issue in $GITHUB_REPOSITORY — nothing to update"; rm -f "$bf"; return 0
  fi
  local mode=""
  if [ "$1" = merged ]; then mode=replace-only; fi
  for n in $nums; do update_issue "$n" "$bf" "$mode" || rc=1; done
  rm -f "$bf"
  return $rc
}

closed_cmd() {
  need GITHUB_REPOSITORY PR HEAD_REF
  local rc=0
  deactivate_own || rc=1
  if [ "$1" = true ]; then issues_cmd merged || rc=1; else issues_cmd none || rc=1; fi
  return $rc
}

case "${1:-}" in
  deploy-start) deploy_start ;;
  deploy-finish)
    case "${2:-}" in success|failure|error) deploy_finish "$2" ;; *) usage ;; esac ;;
  issues)
    case "${2:-}" in
      ready|failed)
        need GITHUB_REPOSITORY PR HEAD_SHA PREVIEW_URL
        if pr_is_open; then issues_cmd "$2"; fi ;;
      *) usage ;;
    esac ;;
  closed)
    case "${2:-}" in true|false) closed_cmd "$2" ;; *) usage ;; esac ;;
  block-upsert) upsert_block "$2" "$3" "${4:-}" ;;
  *) usage ;;
esac
