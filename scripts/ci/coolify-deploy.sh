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
resp=$(curl -sS --max-time 30 -X POST "${AUTH[@]}" "$deploy_url")
deployment_uuid=$(printf '%s' "$resp" | jq -r '.deployments[0].deployment_uuid // empty')
[ -n "$deployment_uuid" ] || fail "Coolify did not return a deployment_uuid: $resp"
if [ -n "${PR_NUMBER:-}" ]; then target="preview pr=$PR_NUMBER"; else target="production"; fi
echo "deployment $deployment_uuid queued ($target)"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "deployment_uuid=$deployment_uuid" >> "$GITHUB_OUTPUT"

# --- 2. wait for Coolify ----------------------------------------------------
deadline=$((SECONDS + DEPLOY_TIMEOUT_SEC))
status=""
while [ $SECONDS -lt $deadline ]; do
  d=$(curl -sS --max-time 30 "${AUTH[@]}" "$COOLIFY_URL/api/v1/deployments/$deployment_uuid")
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
  body=$(jq -cn --arg u "$SEED_USERNAME" --arg p "${SEED_PASSWORD:?}" '{username:$u,password:$p}')
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H 'content-type: application/json' \
    -d "$body" "$BASE_URL/api/auth/login")
  case "$code" in 200|201) echo "seed login: $code" ;; *) fail "login as seeded user '$SEED_USERNAME' returned $code — did the seed run?" ;; esac
fi

echo "deployed $EXPECTED_COMMIT at $BASE_URL"
