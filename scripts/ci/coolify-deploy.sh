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
#      [PR_NUMBER] [SEED_USERNAME SEED_PASSWORD] [BASIC_AUTH=user:pass]
#      [DEPLOY_TIMEOUT_SEC=900] [READY_TIMEOUT_SEC=180] [POLL_INTERVAL_SEC=10]
set -euo pipefail

: "${COOLIFY_URL:?}" "${COOLIFY_API_TOKEN:?}" "${COOLIFY_APP_UUID:?}" "${EXPECTED_COMMIT:?}" "${BASE_URL:?}"
DEPLOY_TIMEOUT_SEC=${DEPLOY_TIMEOUT_SEC:-900}
READY_TIMEOUT_SEC=${READY_TIMEOUT_SEC:-180}
POLL_INTERVAL_SEC=${POLL_INTERVAL_SEC:-10}
AUTH=(-H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json")
# Previews may sit behind a Traefik basicAuth middleware (docs/coolify-deploy.md).
# That middleware covers every path, so without credentials all three checks
# below get 401 and every preview deploy fails — the hardening and the
# verification have to know about each other.
#
# APP IS USUALLY EMPTY — BASIC_AUTH is set only for previews behind the
# middleware — WHICH IS WHY ITS THREE USES BELOW ARE SPELLED
# `${APP[@]+"${APP[@]}"}` AND NOT THE OBVIOUS `"${APP[@]}"`. Under `set -u`,
# bash 3.2 treats an empty array's `[@]` expansion as an UNBOUND VARIABLE and
# kills the script; bash 4.4+ expands it to nothing, as intended. CI is
# ubuntu/bash 5, so the naive form is correct there and fatal on a Mac, where
# /bin/bash is still 3.2 — and it went unseen because without `jq` the
# `test:ci-scripts` row SKIPS rather than running. `AUTH` above needs no guard:
# it is never empty. Do not "simplify" these three back.
APP=()
[ -n "${BASIC_AUTH:-}" ] && APP=(-u "$BASIC_AUTH")

fail() { echo "::error::$*" >&2; exit 1; }

# jq exits 5 on a non-JSON body. Coolify behind a restarting proxy answers HTML
# (502/504), and under `set -euo pipefail` that killed the script with no
# ::error:: line at all — a red job for a deployment that was usually fine, and
# it made the "did not return a deployment_uuid" diagnostic below unreachable.
jqr() { jq -r "$1" 2>/dev/null || true; }

# --- 1. trigger -------------------------------------------------------------
deploy_url="$COOLIFY_URL/api/v1/deploy?uuid=$COOLIFY_APP_UUID&force=false"
[ -n "${PR_NUMBER:-}" ] && deploy_url="$deploy_url&pr=$PR_NUMBER"
resp=$(curl -sS --max-time 30 -X POST "${AUTH[@]}" "$deploy_url")
deployment_uuid=$(printf '%s' "$resp" | jqr '.deployments[0].deployment_uuid // empty')
[ -n "$deployment_uuid" ] || fail "Coolify did not return a deployment_uuid: $resp"
if [ -n "${PR_NUMBER:-}" ]; then target="preview pr=$PR_NUMBER"; else target="production"; fi
echo "deployment $deployment_uuid queued ($target)"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "deployment_uuid=$deployment_uuid" >> "$GITHUB_OUTPUT"

# --- 2. wait for Coolify ----------------------------------------------------
deadline=$((SECONDS + DEPLOY_TIMEOUT_SEC))
status=""
while [ $SECONDS -lt $deadline ]; do
  # A transient network/API failure here must not kill the whole script — fall
  # back to an empty object, which parses to an empty status and just loops
  # again; the post-loop check below still catches a deployment that never
  # reaches "finished".
  d=$(curl -sS --max-time 30 "${AUTH[@]}" "$COOLIFY_URL/api/v1/deployments/$deployment_uuid" || echo '{}')
  status=$(printf '%s' "$d" | jqr '.status // empty')
  case "$status" in
    finished) break ;;
    failed|cancelled-by-user)
      # Read the log to CLASSIFY the failure, but never echo it: it carries the
      # stack's own environment, and JWT_SECRET/DB_PASSWORD live only in
      # Coolify's env sets, so GitHub's *** masking does not cover them.
      # Filtering that text was a leak waiting to be out-thought by a format we
      # did not anticipate; a link to the deployment shows the operator the
      # whole log where it is already access-controlled.
      logs=$(printf '%s' "$d" | jqr '.logs // ""')
      if printf '%s' "$logs" | grep -qiE 'pull access denied|manifest unknown|denied: |unauthorized'; then
        echo "::error::image pull failed — check the GHCR credential on the server (docs/coolify-deploy.md → Registry credentials)" >&2
      fi
      url=$(printf '%s' "$d" | jqr '.deployment_url // empty')
      [ -n "$url" ] || url="$COOLIFY_URL/project → application → Deployments → $deployment_uuid"
      echo "::error::deployment log: $url" >&2
      fail "Coolify deployment $deployment_uuid ended with status '$status'"
      ;;
    ''|queued|in_progress|running) ;;
    *)
      # Not terminal as far as we know, so keep waiting — but say so once,
      # otherwise an unexpected status is indistinguishable from a hang until
      # DEPLOY_TIMEOUT_SEC expires.
      [ "$status" = "${last_reported:-}" ] || echo "Coolify: unrecognised status '$status', still waiting" >&2
      last_reported=$status
      ;;
  esac
  sleep "$POLL_INTERVAL_SEC"
done
[ "$status" = finished ] || fail "Coolify deployment $deployment_uuid still '$status' after ${DEPLOY_TIMEOUT_SEC}s"
echo "Coolify: finished"

# --- 3. the application itself ---------------------------------------------
probe() { # url -> http code (curl prints 000 on connection failure)
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${APP[@]+"${APP[@]}"} "$1" || true
}
deadline=$((SECONDS + READY_TIMEOUT_SEC))
until [ "$(probe "$BASE_URL/api/health/ready")" = 200 ]; do
  [ $SECONDS -lt $deadline ] || fail "$BASE_URL/api/health/ready not 200 after ${READY_TIMEOUT_SEC}s"
  sleep "$POLL_INTERVAL_SEC"
done
echo "ready: 200"

# Retry until it MATCHES, not merely until it answers. /ready turning 200 does
# not mean Traefik has finished swinging routes to the new containers, so the
# first answer here can legitimately be the previous commit; a one-shot
# assertion turned that window into a failed deploy.
served=""
deadline=$((SECONDS + READY_TIMEOUT_SEC))
while :; do
  served=$(curl -sS --max-time 10 ${APP[@]+"${APP[@]}"} "$BASE_URL/api/health/version" 2>/dev/null | jqr '.commit // empty')
  [ "$served" = "$EXPECTED_COMMIT" ] && break
  [ $SECONDS -lt $deadline ] || fail "$BASE_URL serves commit '$served', expected '$EXPECTED_COMMIT'"
  sleep "$POLL_INTERVAL_SEC"
done
echo "version: $served"

if [ -n "${SEED_USERNAME:-}" ]; then
  body=$(jq -cn --arg u "$SEED_USERNAME" --arg p "${SEED_PASSWORD:?}" '{username:$u,password:$p}')
  # The seed only starts once the backend reports healthy, so this can be
  # polling a database the seed is still writing. Bound it like the others
  # rather than giving it three tries and a misleading "did the seed run?".
  code=""
  deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while :; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${APP[@]+"${APP[@]}"} -X POST -H 'content-type: application/json' \
      -d "$body" "$BASE_URL/api/auth/login" || true)
    case "$code" in 200|201) break ;; esac
    [ $SECONDS -lt $deadline ] || fail "login as seeded user '$SEED_USERNAME' returned $code — did the seed run?"
    sleep "$POLL_INTERVAL_SEC"
  done
  echo "seed login: $code"
fi

echo "deployed $EXPECTED_COMMIT at $BASE_URL"
