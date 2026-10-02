#!/usr/bin/env bash
# scripts/ci/preview-links.test.sh — run: bash scripts/ci/preview-links.test.sh
# Needs bash, jq, awk. Expected: passed=<printed below> failed=0
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/preview-links.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }
# same <file> <expected text>: the file holds exactly the expected text.
same() { [ "$(cat "$1")" = "$2" ] || { printf 'want:\n%s\ngot:\n%s\n' "$2" "$(cat "$1")" >&2; return 1; }; }

S5='<!-- yagoda-preview:pr-5:start -->'; E5='<!-- yagoda-preview:pr-5:end -->'
S6='<!-- yagoda-preview:pr-6:start -->'; E6='<!-- yagoda-preview:pr-6:end -->'
printf '%s\n> new\n%s\n' "$S5" "$E5" > "$T/block"
: > "$T/empty"
NEW="$S5
> new
$E5"

# upsert <body> <block-file>: runs the pure rewrite, output in $T/out.
upsert() { printf '%s' "$1" | bash "$SCRIPT" block-upsert 5 "$2" > "$T/out"; }

echo "# 1. a body with no block gets the block appended after one blank line"
check upsert 'Hello' "$T/block"
check same "$T/out" "Hello

$NEW"

echo "# 2. an existing block is replaced in place; text after it survives"
check upsert "Intro
$S5
> old
$E5
Outro" "$T/block"
check same "$T/out" "Intro
$NEW
Outro"

echo "# 3. another PR's block is never touched"
check upsert "Intro
$S6
> six
$E6" "$T/block"
check same "$T/out" "Intro
$S6
> six
$E6

$NEW"

echo "# 4. an empty block removes ours and leaves no trailing blank lines"
check upsert "Intro

$S5
> old
$E5
" "$T/empty"
check same "$T/out" "Intro"

echo "# 5. a CRLF body (the web UI writes those): no CR survives, the author's lines do"
check upsert $'Line one\r\nLine two\r\n' "$T/block"
check same "$T/out" "Line one
Line two

$NEW"
check_fail grep -q $'\r' "$T/out"

echo "# 6. an empty body becomes the block alone"
check upsert '' "$T/block"
check same "$T/out" "$NEW"

echo "# 7. a start marker with no end marker: exit 3, nothing printed, never truncated"
rc=0; upsert "Intro
$S5
> old, and the author typed below it" "$T/block" || rc=$?
check [ "$rc" -eq 3 ]
check same "$T/out" ""

# ---------------------------------------------------------------------------
# Fake gh. KEY is "METHOD path" for `gh api` and "pr-view" for `gh pr view`. Every call
# is logged as KEY<TAB>FIELDS<TAB>STDIN, so a test asserts what was SENT, not only where.
# The response is $FAKE_GH/responses/<KEY with ' /?=&' as '_'>; a missing file is a
# failed call (exit 1), which is how gh reports an HTTP error.
mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -u
method=GET; path=""; fields=""; input=0
if [ "$1" = pr ]; then key=pr-view
else
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      -X) method=$2; shift 2 ;;
      -f|-F) fields="$fields $2"; shift 2 ;;
      --input) input=1; shift 2 ;;
      *) path=$1; shift ;;
    esac
  done
  key="$method $path"
fi
stdin=""; [ "$input" -eq 1 ] && stdin=$(cat)
printf '%s\t%s\t%s\n' "$key" "${fields# }" "$stdin" >> "$FAKE_GH/calls.log"
f="$FAKE_GH/responses/$(printf '%s' "$key" | tr ' /?=&' '_____')"
[ -f "$f" ] || { echo "fake gh: no response for $key" >&2; exit 1; }
cat "$f"
EOF
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" FAKE_GH="$T/gh"
export GITHUB_REPOSITORY=acme/app PR=5 HEAD_REF=feat/x HEAD_SHA=abcdef1234567890abcdef1234567890abcdef12
export PREVIEW_URL=https://pr-5.test STAGING_URL=https://staging.test SEED_USERNAME=oksana SEED_PASSWORD=operator
export GITHUB_SERVER_URL=https://github.com GITHUB_RUN_ID=42 GITHUB_OUTPUT="$T/gh_out"
unset DEPLOYMENT_ID COOLIFY_DEPLOYMENT_UUID 2>/dev/null || true

reset()   { rm -rf "$FAKE_GH"; mkdir -p "$FAKE_GH/responses"; : > "$FAKE_GH/calls.log"; : > "$GITHUB_OUTPUT"; }
respond() { printf '%s' "$2" > "$FAKE_GH/responses/$(printf '%s' "$1" | tr ' /?=&' '_____')"; }
called()  { cut -f1 "$FAKE_GH/calls.log" | grep -qxF "$1"; }
fields()  { awk -F'\t' -v k="$1" '$1 == k { print $2 }' "$FAKE_GH/calls.log"; }
sent()    { awk -F'\t' -v k="$1" '$1 == k { print $3 }' "$FAKE_GH/calls.log"; }
run()     { bash "$SCRIPT" "$@" > "$T/stdout" 2> "$T/stderr"; }
D=repos/acme/app/deployments
I=repos/acme/app/issues
# Closing references as `gh pr view --json closingIssuesReferences` returns them.
refs() { local out="" n r; for r in "$@"; do n=${r%%@*}; r=${r#*@}
  out="$out${out:+,}{\"number\":$n,\"repository\":{\"name\":\"${r#*/}\",\"owner\":{\"login\":\"${r%%/*}\"}}}"; done
  printf '{"closingIssuesReferences":[%s]}' "$out"; }
body_json() { jq -nc --arg b "$1" '{body: $b}'; }

echo "# 8. deploy-start: only THIS PR's live deployment goes inactive; the create body is exact"
reset
respond "GET $D" '[{"id":11,"payload":{"pr":5}},{"id":12,"payload":{"pr":6}},{"id":13,"payload":{"pr":5}},{"id":14,"payload":""}]'
respond "GET $D/11/statuses?per_page=1" '[{"state":"success"}]'
respond "GET $D/13/statuses?per_page=1" '[{"state":"inactive"}]'
respond "POST $D/11/statuses" '{}'
respond "POST $D" '{"id":99}'
respond "POST $D/99/statuses" '{}'
check run deploy-start
check [ "$(fields "GET $D")" = "environment=preview ref=feat/x per_page=100" ]
check [ "$(sent "POST $D/11/statuses" | jq -r '.state + " " + (.auto_inactive|tostring)')" = "inactive false" ]
check_fail called "POST $D/13/statuses"
check_fail called "GET $D/12/statuses?per_page=1"
check jq -e '.ref == "feat/x" and .environment == "preview" and .transient_environment == true
  and .production_environment == false and .auto_merge == false and .required_contexts == []
  and .task == "deploy:preview" and .payload == {pr: 5, sha: "abcdef1234567890abcdef1234567890abcdef12"}' \
  <<< "$(sent "POST $D")"
check [ "$(sent "POST $D/99/statuses" | jq -r '.state + " " + (.auto_inactive|tostring) + " " + .environment_url')" = "in_progress false https://pr-5.test" ]
check grep -qx "deployment_id=99" "$GITHUB_OUTPUT"

echo "# 9. deploy-start: a refused create is a warning and a non-zero exit, and no id is output"
reset
respond "GET $D" '[]'
check_fail run deploy-start
check grep -q '^::warning::' "$T/stderr"
check_fail grep -q deployment_id "$GITHUB_OUTPUT"

echo "# 10. deploy-finish: success carries the preview URL, this run's log and the Coolify uuid"
reset
respond "POST $D/99/statuses" '{}'
check env DEPLOYMENT_ID=99 COOLIFY_DEPLOYMENT_UUID=luewsvzz bash "$SCRIPT" deploy-finish success
check jq -e '.state == "success" and .auto_inactive == false and .environment_url == "https://pr-5.test"
  and .log_url == "https://github.com/acme/app/actions/runs/42"
  and .description == "sha-abcdef1 · coolify luewsvzz"' <<< "$(sent "POST $D/99/statuses")"

echo "# 11. deploy-finish without a deployment id calls nothing and exits 0"
reset
check run deploy-finish failure
check [ ! -s "$FAKE_GH/calls.log" ]

echo "# 12. issues ready: this repo's closing issue gets the block; a foreign repo's is never read"
reset
respond pr-view "$(refs '7@ACME/App' '8@acme/other')"
respond "GET $I/7" "$(body_json 'Bug report')"
respond "PATCH $I/7" '{}'
check run issues ready
READY=$(sent "PATCH $I/7" | jq -r .body)
check grep -qx 'Bug report' <<< "$READY"
check grep -qxF '> **🔍 Preview for #5:** https://pr-5.test' <<< "$READY"
check grep -qxF '> Commit `abcdef1` · sign in as `oksana` / `operator` · removed when the PR closes' <<< "$READY"
check_fail grep -q 'issues/8' "$FAKE_GH/calls.log"

echo "# 13. re-run on an unchanged commit, body stored with CRLF: no PATCH"
reset
respond pr-view "$(refs '7@acme/app')"
respond "GET $I/7" "$(body_json "$(printf '%s\n' "$READY" | awk '{ printf "%s\r\n", $0 }')")"
check run issues ready
check_fail called "PATCH $I/7"
check grep -q 'unchanged' "$T/stdout"

echo "# 14. one issue failing does not stop the next; a null body becomes the block alone"
reset
respond pr-view "$(refs '7@acme/app' '9@acme/app')"
respond "GET $I/9" '{"body":null}'
respond "PATCH $I/9" '{}'
check_fail run issues ready
check grep -q '^::warning::issue #7' "$T/stderr"
check [ "$(sent "PATCH $I/9" | jq -r .body | head -1)" = "$S5" ]

echo "# 15. issues failed: the warning replaces the commit line"
reset
respond pr-view "$(refs '7@acme/app')"
respond "GET $I/7" "$(body_json 'x')"
respond "PATCH $I/7" '{}'
check run issues failed
FAILED=$(sent "PATCH $I/7" | jq -r .body)
check grep -qxF '> ⚠️ The latest deploy (`abcdef1`) failed — the preview may still be serving an older commit.' <<< "$FAILED"
check grep -qxF '> Sign in as `oksana` / `operator` · removed when the PR closes' <<< "$FAILED"
check_fail grep -q 'Commit `' <<< "$FAILED"

echo "# 16. a PR that closes no issue: nothing to do, exit 0"
reset
respond pr-view '{"closingIssuesReferences":[]}'
check run issues ready
check grep -q 'closes no issue' "$T/stdout"

echo "# 17. closed, merged: the deployment goes inactive and the block points at staging"
reset
respond "GET $D" '[{"id":99,"payload":{"pr":5}}]'
respond "GET $D/99/statuses?per_page=1" '[{"state":"success"}]'
respond "POST $D/99/statuses" '{}'
respond pr-view "$(refs '7@acme/app')"
respond "GET $I/7" "$(body_json "$READY")"
respond "PATCH $I/7" '{}'
check run closed true
check [ "$(sent "POST $D/99/statuses" | jq -r .state)" = inactive ]
MERGED=$(sent "PATCH $I/7" | jq -r .body)
check grep -qxF '> ✅ #5 was merged — it will be on staging in a few minutes: https://staging.test' <<< "$MERGED"
check_fail grep -q 'Preview for' <<< "$MERGED"

echo "# 18. closed, not merged: the block is removed and the author's text is all that is left"
reset
respond "GET $D" '[]'
respond pr-view "$(refs '7@acme/app')"
respond "GET $I/7" "$(body_json "$READY")"
respond "PATCH $I/7" '{}'
check run closed false
check [ "$(sent "PATCH $I/7" | jq -r .body)" = "Bug report" ]

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
