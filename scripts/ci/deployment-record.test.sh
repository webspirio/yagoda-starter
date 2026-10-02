#!/usr/bin/env bash
# scripts/ci/deployment-record.test.sh — run: bash scripts/ci/deployment-record.test.sh
# Needs bash, jq. Expected: passed=<printed below> failed=0
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/deployment-record.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }

# Fake gh — the same contract as preview-links.test.sh's: KEY is "METHOD path"; like the
# real gh it defaults to GET, and to POST once a field or --input is given without -X.
# Every call is logged as KEY<TAB>FIELDS<TAB>STDIN; the response is
# $FAKE_GH/responses/<KEY with ' /?=&' as '_'>, and a missing file is a failed call.
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -u
method=""; path=""; fields=""; input=0
shift
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method=$2; shift 2 ;;
    -f|-F) fields="$fields $2"; shift 2 ;;
    --input) input=1; shift 2 ;;
    *) path=$1; shift ;;
  esac
done
if [ -z "$method" ]; then
  if [ -n "$fields" ] || [ "$input" -eq 1 ]; then method=POST; else method=GET; fi
fi
key="$method $path"
stdin=""; [ "$input" -eq 1 ] && stdin=$(cat)
printf '%s\t%s\t%s\n' "$key" "${fields# }" "$stdin" >> "$FAKE_GH/calls.log"
f="$FAKE_GH/responses/$(printf '%s' "$key" | tr ' /?=&' '_____')"
[ -f "$f" ] || { echo "fake gh: no response for $key" >&2; exit 1; }
cat "$f"
EOF
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" FAKE_GH="$T/gh"
export GITHUB_REPOSITORY=acme/app SHA=abcdef1234567890abcdef1234567890abcdef12
export GITHUB_SERVER_URL=https://github.com GITHUB_RUN_ID=42 GITHUB_OUTPUT="$T/gh_out"
unset TAG PRODUCTION DEPLOYMENT_ID COOLIFY_DEPLOYMENT_UUID 2>/dev/null || true

respond() { printf '%s' "$2" > "$FAKE_GH/responses/$(printf '%s' "$1" | tr ' /?=&' '_____')"; }
reset()   { rm -rf "$FAKE_GH"; mkdir -p "$FAKE_GH/responses"; : > "$FAKE_GH/calls.log"; : > "$GITHUB_OUTPUT"; }
called()  { cut -f1 "$FAKE_GH/calls.log" | grep -qxF "$1"; }
fields()  { awk -F'\t' -v k="$1" '$1 == k { print $2 }' "$FAKE_GH/calls.log"; }
sent()    { awk -F'\t' -v k="$1" '$1 == k { print $3 }' "$FAKE_GH/calls.log"; }
run()     { bash "$SCRIPT" "$@" > "$T/stdout" 2> "$T/stderr"; }
D=repos/acme/app/deployments
staging()    { export ENVIRONMENT=staging URL=https://staging.test; unset TAG PRODUCTION; }
production() { export ENVIRONMENT=production URL=https://app.test TAG=v1.2.3 PRODUCTION=true; }

echo "# 1. start, staging: the record names the exact commit and is not a production one"
reset; staging
respond "POST $D" '{"id":99}'
respond "POST $D/99/statuses" '{}'
check run start
check jq -e '.ref == "abcdef1234567890abcdef1234567890abcdef12" and .environment == "staging"
  and .transient_environment == false and .production_environment == false
  and .auto_merge == false and .required_contexts == [] and .task == "deploy"
  and .description == "sha-abcdef1"' <<< "$(sent "POST $D")"
check jq -e '.state == "in_progress" and .auto_inactive == false and .environment_url == "https://staging.test"
  and .log_url == "https://github.com/acme/app/actions/runs/42"' <<< "$(sent "POST $D/99/statuses")"
check grep -qx "deployment_id=99" "$GITHUB_OUTPUT"

echo "# 2. start, production: the ref is the release tag, and the record is a production one"
reset; production
respond "POST $D" '{"id":99}'
respond "POST $D/99/statuses" '{}'
check run start
check jq -e '.ref == "v1.2.3" and .environment == "production" and .production_environment == true
  and .description == "v1.2.3 · sha-abcdef1"' <<< "$(sent "POST $D")"

echo "# 3. start: a refused create is a warning and a non-zero exit, and no id is output"
reset; staging
check_fail run start
check grep -q '^::warning::' "$T/stderr"
check_fail grep -q deployment_id "$GITHUB_OUTPUT"

echo "# 4. finish success: the previous LIVE record goes inactive; failures between are skipped"
reset; production
export DEPLOYMENT_ID=99 COOLIFY_DEPLOYMENT_UUID=luewsvzz
respond "POST $D/99/statuses" '{}'
respond "GET $D" '[{"id":99},{"id":98},{"id":97},{"id":96}]'
respond "GET $D/98/statuses?per_page=1" '[{"state":"failure"}]'
respond "GET $D/97/statuses?per_page=1" '[{"state":"success"}]'
respond "POST $D/97/statuses" '{}'
check run finish success
check jq -e '.state == "success" and .auto_inactive == false and .environment_url == "https://app.test"
  and .description == "v1.2.3 · sha-abcdef1 · coolify luewsvzz"' <<< "$(sent "POST $D/99/statuses")"
check [ "$(fields "GET $D")" = "environment=production per_page=100" ]
check [ "$(sent "POST $D/97/statuses" | jq -r .state)" = inactive ]
check_fail called "POST $D/98/statuses"
check_fail called "GET $D/96/statuses?per_page=1"
check_fail called "GET $D/99/statuses?per_page=1"

echo "# 5. finish success: the walk stops at the first inactive record — older ones are settled"
reset; staging
respond "POST $D/99/statuses" '{}'
respond "GET $D" '[{"id":99},{"id":98},{"id":97}]'
respond "GET $D/98/statuses?per_page=1" '[{"state":"inactive"}]'
check run finish success
check_fail called "GET $D/97/statuses?per_page=1"
check_fail called "POST $D/98/statuses"

echo "# 6. finish failure: the previous live record stays live, nothing is listed"
reset; staging
respond "POST $D/99/statuses" '{}'
check run finish failure
check [ "$(sent "POST $D/99/statuses" | jq -r .state)" = failure ]
check_fail called "GET $D"

echo "# 7. finish error (the run was cancelled): said so in the description"
reset; staging
unset COOLIFY_DEPLOYMENT_UUID
respond "POST $D/99/statuses" '{}'
check run finish error
check jq -e '.state == "error" and .description == "sha-abcdef1 · run cancelled"' <<< "$(sent "POST $D/99/statuses")"

echo "# 8. finish success whose sweep fails: the success is already recorded, the exit says it"
reset; staging
respond "POST $D/99/statuses" '{}'
check_fail run finish success
check [ "$(sent "POST $D/99/statuses" | jq -r .state)" = success ]
check grep -q '^::warning::' "$T/stderr"

echo "# 9. finish without a deployment id calls nothing and exits 0"
reset; staging
unset DEPLOYMENT_ID
check run finish success
check [ ! -s "$FAKE_GH/calls.log" ]

echo "# 10. an unknown command or state is a usage error"
check_fail run finish maybe
check_fail run deploy

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
