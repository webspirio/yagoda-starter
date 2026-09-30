#!/usr/bin/env bash
# scripts/ci/release-guard.test.sh — run: bash scripts/ci/release-guard.test.sh
# Needs bash, git. Expected: passed=16 failed=0
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
GUARD="$HERE/release-guard.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check()      { if "$@";   then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected success): $*" >&2; fi; }
check_fail() { if ! "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (expected failure): $*" >&2; fi; }

# A throwaway repository with three commits on main and one on a side branch:
#   c1  base
#   c2  adds backend/src/migrations/1700000000000-AddThing.ts
#   c3  touches only a README
#   side (from c1): touches only a README
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
cd "$T"; git init -q -b main .
mkdir -p backend/src/migrations
echo base > README.md; git add -A; git commit -q -m c1; c1=$(git rev-parse HEAD)
echo 'export class AddThing1700000000000 {}' > backend/src/migrations/1700000000000-AddThing.ts; git add -A; git commit -q -m c2; c2=$(git rev-parse HEAD)
echo more >> README.md; git add -A; git commit -q -m c3; c3=$(git rev-parse HEAD)
git checkout -q -b side "$c1"; echo side >> README.md; git add -A; git commit -q -m side; side=$(git rev-parse HEAD); git checkout -q main

run() { bash "$GUARD" "$@" >"$T/out" 2>"$T/err"; }

echo "# 1. first release: no production branch yet -> allowed"
check run "" "$c2" backend/src/migrations false
check grep -q "no production branch yet" "$T/out"

echo "# 2. forward move -> allowed"
check run "$c1" "$c3" backend/src/migrations false

echo "# 3. same commit -> allowed"
check run "$c2" "$c2" backend/src/migrations false

echo "# 4. backward move that crosses no migration (c3 -> c2) -> allowed"
check run "$c3" "$c2" backend/src/migrations false

echo "# 5. backward move across a migration (c2 -> c1) -> refused, names the file and the runbook"
check_fail run "$c2" "$c1" backend/src/migrations false
check grep -q "1700000000000-AddThing.ts" "$T/err"
check grep -q "backup-restore.md" "$T/err"

echo "# 6. the same with allow_schema_rollback=true -> allowed with a warning"
check run "$c2" "$c1" backend/src/migrations true
check grep -q "1700000000000-AddThing.ts" "$T/err"
check grep -q "::warning::" "$T/out"

echo "# 7. a sideways move (neither ancestor) -> refused"
check_fail run "$c3" "$side" backend/src/migrations false

echo "# 8. release mode, backward move that crosses no migration (c3 -> c2) -> refused: a release only moves forward"
check_fail run "$c3" "$c2" backend/src/migrations false release
check grep -q "NEWER release" "$T/err"

echo "# 9. release mode, forward move (c1 -> c3) -> allowed"
check run "$c1" "$c3" backend/src/migrations false release

echo "# 10. dispatch mode, backward move that crosses no migration (c3 -> c2) -> allowed (a rollback)"
check run "$c3" "$c2" backend/src/migrations false dispatch

echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
