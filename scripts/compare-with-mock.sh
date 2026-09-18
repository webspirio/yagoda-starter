#!/usr/bin/env bash
# Opens the local branch (left) and the mock (right) side by side, each in its own
# Chromium profile so the two logins persist independently. Starts the mock's Vite
# dev server if it is not already answering. See docs/compare-with-mock.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STARTER_URL="${STARTER_URL:-http://localhost:5173}"
MOCK_DIR="${YAGODA_MOCK_DIR:-$(cd "$HERE/.." && pwd)/yagoda-crm}"
MOCK_PORT="${MOCK_PORT:-5174}"
MOCK_URL="http://localhost:${MOCK_PORT}"
PROFILES="${XDG_STATE_HOME:-$HOME/.local/state}/yagoda-compare"
# Half of a 1920-wide screen each; on Wayland the compositor decides placement, so tile
# the two windows with the WM (Super+Left / Super+Right) if they land on top of each other.
W="${COMPARE_WIDTH:-960}"
H="${COMPARE_HEIGHT:-1040}"
# The left window shows the MAIN worktree's checkout even when this script runs from a
# linked worktree, so label it from there.
MAIN_WORKTREE="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$HERE/.git")")"

up() { curl -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null; }

if ! up "$STARTER_URL"; then
  echo "The starter's dev server is not answering at $STARTER_URL — run: docker compose up -d" >&2
  exit 1
fi

if ! up "$MOCK_URL"; then
  if [ ! -d "$MOCK_DIR/node_modules" ]; then
    echo "The mock is not installed at $MOCK_DIR. Run:" >&2
    echo "  gh repo clone webspirio/yagoda-crm \"$MOCK_DIR\" && (cd \"$MOCK_DIR\" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci)" >&2
    exit 1
  fi
  echo "Starting the mock at $MOCK_URL (log: $MOCK_DIR/.dev.log)"
  (cd "$MOCK_DIR" && nohup npm run dev -- --port "$MOCK_PORT" --strictPort > .dev.log 2>&1 &)
  for _ in $(seq 1 40); do up "$MOCK_URL" && break; sleep 0.5; done
  up "$MOCK_URL" || { echo "The mock did not start; see $MOCK_DIR/.dev.log" >&2; exit 1; }
fi

BROWSER_BIN="${BROWSER_BIN:-$(command -v chromium || command -v google-chrome || command -v chromium-browser || true)}"
if [ -z "$BROWSER_BIN" ]; then
  xdg-open "$STARTER_URL"
  xdg-open "$MOCK_URL"
else
  mkdir -p "$PROFILES/local" "$PROFILES/mock"
  "$BROWSER_BIN" --user-data-dir="$PROFILES/local" --window-position=0,0 --window-size="$W,$H" --new-window "$STARTER_URL" >/dev/null 2>&1 &
  "$BROWSER_BIN" --user-data-dir="$PROFILES/mock" --window-position="$W,0" --window-size="$W,$H" --new-window "$MOCK_URL" >/dev/null 2>&1 &
fi

echo "left:  $STARTER_URL  — гілка $(git -C "$MAIN_WORKTREE" branch --show-current 2>/dev/null || echo '?')"
echo "right: $MOCK_URL  — мок $(git -C "$MOCK_DIR" log -1 --format='%h %ad' --date=short 2>/dev/null || echo '?')"
