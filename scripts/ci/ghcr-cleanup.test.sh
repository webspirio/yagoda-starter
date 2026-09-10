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
 {"id":7,"created_at":"$OLD","metadata":{"container":{"tags":["keep-me"]}}},
 {"id":8,"created_at":"$OLD","metadata":{"container":{"tags":["sha-dddd","pr-7"]}}},
 {"id":9,"created_at":"$NOW","metadata":{"container":{"tags":["sha-eeee","pr-7"]}}}
]
EOF
)
got=$(printf '%s' "$fixture" | OPEN_PRS="8" KEEP_SHA_DAYS=30 bash "$HERE/ghcr-cleanup.sh" --select | sort -n | tr '\n' ' ')
# 1 untagged; 2 pr-7 closed (pr-only, deleted immediately); 4 old sha only;
# 8 mixed sha+pr-7 (closed), old -> deleted once past the cutoff.
# Kept: 3 (open pr), 5 (fresh sha), 6 (carries open pr alias), 7 (foreign tag),
# 9 mixed sha+pr-7 (closed) but still fresh -> kept.
if [ "$got" = "1 2 4 8 " ]; then echo "select: ok"; else echo "select: got '$got' want '1 2 4 8 '"; exit 1; fi

# --- scenario 2: a package that 404s (not created yet / not accessible) must be
# skipped, not abort the whole run — the other package still gets pruned. ---------
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
printf '%s' "$fixture" > "$T/present.json"

# Fake gh: only understands the two `gh api` shapes ghcr-cleanup.sh issues.
# It reproduces real `gh api` stderr, because the script distinguishes a benign
# 404 from every other failure by exactly that text:
#   .../missing/ -> 404, the package CI has not pushed yet (skip, rc 0);
#   .../broken/  -> 401, an expired or under-scoped token (must turn the run red);
#   .../present/ -> the fixture above;
#   any -X DELETE -> no-op success (unreachable while DRY_RUN=true).
cat > "$T/bin/gh" <<EOF
#!/usr/bin/env bash
args="\$*"
case "\$args" in
  *"-X DELETE"*) exit 0;;
  *"/packages/container/missing/"*) echo "gh: Not Found (HTTP 404)" >&2; exit 1;;
  *"/packages/container/broken/"*) echo "gh: Bad credentials (HTTP 401)" >&2; exit 1;;
  *"/packages/container/present/"*) cat "$T/present.json"; exit 0;;
  *) echo "gh: unexpected call: \$args" >&2; exit 1;;
esac
EOF
chmod +x "$T/bin/gh"

set +e
out=$(PATH="$T/bin:$PATH" PACKAGES="missing present" OPEN_PRS="8" KEEP_SHA_DAYS=30 DRY_RUN=true bash "$HERE/ghcr-cleanup.sh")
rc=$?
set -e

ok=1
if [ "$rc" -ne 0 ]; then echo "guard: exit code $rc, want 0"; ok=0; fi
if ! printf '%s\n' "$out" | grep -q 'skipping'; then echo "guard: missing 'skipping' in output"; ok=0; fi
if ! printf '%s\n' "$out" | grep -q 'would delete 1 '; then echo "guard: missing 'would delete 1 '"; ok=0; fi
if ! printf '%s\n' "$out" | grep -q 'would delete 2 '; then echo "guard: missing 'would delete 2 '"; ok=0; fi
if ! printf '%s\n' "$out" | grep -q 'would delete 4 '; then echo "guard: missing 'would delete 4 '"; ok=0; fi
if printf '%s\n' "$out" | grep -q 'would delete 3'; then echo "guard: unexpected 'would delete 3'"; ok=0; fi
if [ "$ok" -eq 1 ]; then echo "guard: ok"; else echo "$out"; exit 1; fi

# --- scenario 3: a NON-404 failure (expired token, missing permission) must fail
# the run. Swallowing it is how a weekly cleanup reports green for months while
# GHCR fills up. `present` still gets pruned — one bad package does not stop the
# others — but the exit code carries the failure. ------------------------------
set +e
out=$(PATH="$T/bin:$PATH" PACKAGES="broken present" OPEN_PRS="8" KEEP_SHA_DAYS=30 DRY_RUN=true bash "$HERE/ghcr-cleanup.sh" 2>&1)
rc=$?
set -e

ok=1
if [ "$rc" -eq 0 ]; then echo "fail-loud: exit 0, want non-zero"; ok=0; fi
if printf '%s\n' "$out" | grep -q 'skipping'; then echo "fail-loud: a 401 was treated as a missing package"; ok=0; fi
if ! printf '%s\n' "$out" | grep -q 'Bad credentials'; then echo "fail-loud: gh's own error was not surfaced"; ok=0; fi
if ! printf '%s\n' "$out" | grep -q 'would delete 1 '; then echo "fail-loud: the healthy package was not pruned"; ok=0; fi
if [ "$ok" -eq 1 ]; then echo "fail-loud: ok"; else echo "$out"; exit 1; fi
