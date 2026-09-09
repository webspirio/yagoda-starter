#!/usr/bin/env bash
# scripts/ci/coolify-deploy.test.sh — run: bash scripts/ci/coolify-deploy.test.sh
# Needs bash, jq. Locally: docker run --rm -v "$PWD:/w" -w /w alpine sh -c 'apk add -q bash jq curl && bash scripts/ci/coolify-deploy.test.sh'
# Expected: passed=13 failed=0
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

# Fake curl: `-o <file>` and `-w '%{http_code}'` are honoured; the body comes from
# $T/responses/<key> where key is the first matching substring in URL_KEYS. Each
# call is logged as "$method $url $data" (method defaults to GET, data may be
# empty) so tests can assert what was sent, not only where.
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=/dev/stdout; url=""; write_code=0; method=GET; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2;;
    -w) write_code=1; shift 2;;
    -X) method=$2; shift 2;;
    -d) data=$2; shift 2;;
    -H|--max-time|--retry) shift 2;;
    -s|-S|-f|-L|--fail) shift;;
    http*) url=$1; shift;;
    *) shift;;
  esac
done
echo "$method $url $data" >> "$FAKE_CURL_LOG"
key=""
for k in $URL_KEYS; do case "$url" in *"$k"*) key=$k; break;; esac; done
body_file="$FAKE_RESPONSES/${key//\//_}"
code_file="$body_file.code"
[ -f "$body_file" ] || { echo "no canned response for $url" >&2; exit 7; }
cat "$body_file" > "$out"
[ $write_code -eq 1 ] && cat "${code_file:-/dev/null}" 2>/dev/null || { [ $write_code -eq 1 ] && echo 200; }
exit 0
EOF
chmod +x "$T/bin/curl"

export FAKE_CURL_LOG="$T/calls.log" FAKE_RESPONSES="$T/responses"
export URL_KEYS="/api/v1/deploy?uuid /api/v1/deployments/ /api/health/ready /api/health/version /api/auth/login"
mkdir -p "$FAKE_RESPONSES"
canned() { printf '%s' "$2" > "$FAKE_RESPONSES/${1//\//_}"; [ -n "${3:-}" ] && printf '%s' "$3" > "$FAKE_RESPONSES/${1//\//_}.code" || true; }

export COOLIFY_URL=https://coolify.test COOLIFY_API_TOKEN=t COOLIFY_APP_UUID=app1
# shellcheck disable=SC2155 # test fixture only; command-substitution exit status is irrelevant here
export EXPECTED_COMMIT=$(printf 'a%.0s' {1..40}) BASE_URL=https://pr-5.test PR_NUMBER=5
export SEED_USERNAME=oksana SEED_PASSWORD=operator
export POLL_INTERVAL_SEC=0 DEPLOY_TIMEOUT_SEC=5 READY_TIMEOUT_SEC=5
export GITHUB_OUTPUT="$T/gh_out"

pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }
# env options (-u …) must precede the NAME=VALUE assignment.
run() { env "$@" PATH="$T/bin:$PATH" bash "$HERE/coolify-deploy.sh"; }

echo "# 1. happy path"
canned '/api/v1/deploy?uuid' '{"deployments":[{"deployment_uuid":"dep-1"}]}'
canned '/api/v1/deployments/' '{"status":"finished","logs":""}'
canned '/api/health/ready' '{"status":"ok"}' 200
canned '/api/health/version' "{\"commit\":\"$EXPECTED_COMMIT\"}" 200
canned '/api/auth/login' '{"access_token":"x"}' 200
: > "$FAKE_CURL_LOG"; : > "$GITHUB_OUTPUT"
check run
check grep -q 'deploy?uuid=app1&force=false&pr=5' "$FAKE_CURL_LOG"
check grep -q '^deployment_uuid=dep-1$' "$GITHUB_OUTPUT"
check grep -q '^POST https://coolify.test/api/v1/deploy?uuid=app1&force=false&pr=5' "$FAKE_CURL_LOG"
check grep -q '^GET https://coolify.test/api/v1/deployments/dep-1' "$FAKE_CURL_LOG"
check grep -qF 'POST https://pr-5.test/api/auth/login {"username":"oksana","password":"operator"}' "$FAKE_CURL_LOG"

echo "# 2. Coolify says failed -> exit 1, pull hint when logs mention denied"
canned '/api/v1/deployments/' '{"status":"failed","logs":"Error response from daemon: pull access denied for ghcr.io/x"}'
check_fail run 2>"$T/err2"
check grep -q 'GHCR credential' "$T/err2"

echo "# 3. finished but wrong commit -> exit 1"
canned '/api/v1/deployments/' '{"status":"finished","logs":""}'
canned '/api/health/version' '{"commit":"bbbbbbbb"}' 200
check_fail run 2>"$T/err3"
check grep -q 'expected' "$T/err3"

echo "# 4. no PR_NUMBER -> production deploy URL has no &pr=, no seed login"
canned '/api/health/version' "{\"commit\":\"$EXPECTED_COMMIT\"}" 200
: > "$FAKE_CURL_LOG"
check run -u PR_NUMBER -u SEED_USERNAME
check_fail grep -q '&pr=' "$FAKE_CURL_LOG"
check_fail grep -q '/api/auth/login' "$FAKE_CURL_LOG"

echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
