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

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
