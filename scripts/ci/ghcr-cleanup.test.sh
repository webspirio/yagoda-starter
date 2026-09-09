#!/usr/bin/env bash
# scripts/ci/ghcr-cleanup.test.sh — run inside alpine with bash+jq (see coolify-deploy.test.sh header)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OLD=$(date -u -d '@'$(( $(date +%s) - 40*86400 )) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r $(( $(date +%s) - 40*86400 )) +%Y-%m-%dT%H:%M:%SZ)
fixture=$(cat <<EOF
[
 {"id":1,"created_at":"$NOW","metadata":{"container":{"tags":[]}}},
 {"id":2,"created_at":"$NOW","metadata":{"container":{"tags":["pr-7"]}}},
 {"id":3,"created_at":"$NOW","metadata":{"container":{"tags":["pr-8"]}}},
 {"id":4,"created_at":"$OLD","metadata":{"container":{"tags":["sha-aaaa"]}}},
 {"id":5,"created_at":"$NOW","metadata":{"container":{"tags":["sha-bbbb"]}}},
 {"id":6,"created_at":"$OLD","metadata":{"container":{"tags":["sha-cccc","pr-8"]}}},
 {"id":7,"created_at":"$OLD","metadata":{"container":{"tags":["keep-me"]}}}
]
EOF
)
got=$(printf '%s' "$fixture" | OPEN_PRS="8" KEEP_SHA_DAYS=30 bash "$HERE/ghcr-cleanup.sh" --select | sort -n | tr '\n' ' ')
# 1 untagged; 2 pr-7 closed; 4 old sha only. Kept: 3 (open pr), 5 (fresh sha), 6 (carries open pr alias), 7 (foreign tag)
[ "$got" = "1 2 4 " ] && echo "select: ok" || { echo "select: got '$got' want '1 2 4 '"; exit 1; }
