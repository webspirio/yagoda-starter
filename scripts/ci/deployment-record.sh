#!/usr/bin/env bash
# A GitHub deployment record for `staging` or `production`, so the repository's
# *Deployments* page shows which commit each environment serves — written around the
# Coolify deploy that deploy-staging / deploy-prod already run and verify.
#
# Usage:
#   deployment-record.sh start                          create the record; status in_progress
#   deployment-record.sh finish success|failure|error   final status; on success every earlier
#                                                       live record goes inactive
#
# Env: GITHUB_REPOSITORY ENVIRONMENT SHA URL, [TAG] (production: the release; also the ref),
#      [PRODUCTION=true], DEPLOYMENT_ID (finish), [COOLIFY_DEPLOYMENT_UUID],
#      [GITHUB_SERVER_URL GITHUB_RUN_ID] [GITHUB_OUTPUT]; GH_TOKEN for gh itself.
#
# Why not a job-level `environment:`, which would be one line: deploy-staging finishes green
# when it SKIPS a superseded commit (a success record for a deploy that never happened); a
# workflow_dispatch rollback runs at main's tip, not at the release it deploys (the wrong
# commit on the record); and GitHub's auto_inactive never touches production records, so
# every release would stay «active». Hence the explicit ref and the explicit sweep below.
#
# Every failure is a ::warning:: and a non-zero exit; the workflow runs these steps with
# continue-on-error, so a red deploy job keeps meaning «the environment did not come up».
set -euo pipefail

warn() { echo "::warning::$*" >&2; }
usage() { sed -n '6,9p' "$0" >&2; exit 2; }
need() {
  local v
  for v in "$@"; do [ -n "${!v:-}" ] || { warn "deployment-record: $v is not set"; exit 1; }; done
}

# describe [state]: «v1.2.3 · sha-abcdef1 · coolify <uuid>», each part only when known.
describe() {
  local d="sha-${SHA:0:7}"
  if [ -n "${TAG:-}" ]; then d="$TAG · $d"; fi
  if [ -n "${COOLIFY_DEPLOYMENT_UUID:-}" ]; then d="$d · coolify $COOLIFY_DEPLOYMENT_UUID"; fi
  if [ "${1:-}" = error ]; then d="$d · run cancelled"; fi
  printf '%s' "$d"
}

# post_status <deployment id> <state> [description]. auto_inactive is false on every status:
# the sweep in finish does that job for both environments alike, production included.
post_status() {
  local log_url=""
  [ -n "${GITHUB_RUN_ID:-}" ] && log_url="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  jq -nc --arg state "$2" --arg env_url "${URL:-}" --arg log_url "$log_url" --arg d "${3:-}" '
      {state: $state, auto_inactive: false}
      + (if $state != "inactive" and $env_url != "" then {environment_url: $env_url} else {} end)
      + (if $log_url != "" then {log_url: $log_url} else {} end)
      + (if $d != "" then {description: $d} else {} end)' \
    | gh api -X POST "repos/$GITHUB_REPOSITORY/deployments/$1/statuses" --input - > /dev/null
}

start() {
  need GITHUB_REPOSITORY ENVIRONMENT SHA URL
  # The ref is the release TAG for production — so a rollback's record names the release it
  # deployed — and the exact commit for staging. auto_merge: false, because the default
  # merges the default branch into the ref; required_contexts: [], because the default
  # refuses (409) while this very run's checks are still pending.
  local id
  id=$(jq -nc --arg ref "${TAG:-$SHA}" --arg env "$ENVIRONMENT" --arg d "$(describe)" \
          --argjson prod "$([ "${PRODUCTION:-}" = true ] && echo true || echo false)" '
        {ref: $ref, environment: $env, transient_environment: false,
         production_environment: $prod, task: "deploy", auto_merge: false,
         required_contexts: [], description: $d}' \
      | gh api -X POST "repos/$GITHUB_REPOSITORY/deployments" --input - | jq -r '.id // empty') || id=""
  [ -n "$id" ] || { warn "could not create the $ENVIRONMENT deployment record for $(describe)"; exit 1; }
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "deployment_id=$id" >> "$GITHUB_OUTPUT"; fi
  post_status "$id" in_progress "$(describe)" || { warn "record $id was created, but in_progress was refused"; exit 1; }
  echo "$ENVIRONMENT record $id: in_progress"
}

# sweep: settle every record older than this one, so exactly one is live. It walks the
# environment's records newest first, page by page, until the first record that is already
# inactive: everything older than that was settled by the sweep that made it inactive. On
# the way it collects each LIVE record (success → inactive) and each record whose run never
# finished it — in_progress, queued, pending, or no status at all, after a lost runner or a
# timeout (→ error). `concurrency` serialises an environment's deploys, so no other run of
# it can still be going. Failures and errors are final and passed over.
#
# The collected records are settled OLDEST first. A sweep that fails part-way (the step is
# continue-on-error) thus only ever leaves records NEWER than any it made inactive, and the
# next deploy's walk still reaches them before it stops — a missed sweep repairs itself.
sweep() {
  local page=1 json n id state stop="" i
  local -a ids=() states=()
  while [ -z "$stop" ]; do
    json=$(gh api -X GET "repos/$GITHUB_REPOSITORY/deployments?environment=$ENVIRONMENT&per_page=100&page=$page") \
      || { warn "could not list the $ENVIRONMENT records (page $page)"; return 1; }
    for id in $(jq -r '.[].id' <<< "$json"); do
      [ "$id" = "$DEPLOYMENT_ID" ] && continue
      state=$(gh api "repos/$GITHUB_REPOSITORY/deployments/$id/statuses?per_page=1" | jq -r '.[0].state // "none"') \
        || { warn "could not read record $id's status"; return 1; }
      case "$state" in
        inactive) stop=1; break ;;
        success) ids+=("$id"); states+=(inactive) ;;
        in_progress|queued|pending|none) ids+=("$id"); states+=(error) ;;
      esac
    done
    n=$(jq length <<< "$json")
    [ "$n" -lt 100 ] && break
    page=$((page + 1))
  done
  for ((i = ${#ids[@]} - 1; i >= 0; i--)); do
    if [ "${states[$i]}" = inactive ]; then
      post_status "${ids[$i]}" inactive || { warn "could not mark record ${ids[$i]} inactive"; return 1; }
    else
      post_status "${ids[$i]}" error "never finished" || { warn "could not close unfinished record ${ids[$i]}"; return 1; }
    fi
    echo "$ENVIRONMENT record ${ids[$i]}: ${states[$i]}"
  done
}

finish() {
  if [ -z "${DEPLOYMENT_ID:-}" ]; then
    echo "no deployment id — start created none, so there is nothing to finish"
    return 0
  fi
  need GITHUB_REPOSITORY ENVIRONMENT SHA URL
  post_status "$DEPLOYMENT_ID" "$1" "$(describe "$1")" || { warn "could not mark record $DEPLOYMENT_ID $1"; exit 1; }
  echo "$ENVIRONMENT record $DEPLOYMENT_ID: $1"
  # Only a success replaces what is live; after a failure the previous release still serves.
  if [ "$1" = success ]; then sweep || exit 1; fi
}

case "${1:-}" in
  start) start ;;
  finish)
    case "${2:-}" in success|failure|error) finish "$2" ;; *) usage ;; esac ;;
  *) usage ;;
esac
