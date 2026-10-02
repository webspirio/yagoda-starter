#!/usr/bin/env bash
# Put a PR preview's link where people look (docs/superpowers/specs/2026-10-02-preview-links-design.md):
#   * a GitHub deployment in the shared `preview` environment, so the PR shows «View deployment»;
#   * a block at the end of the BODY of every issue the PR closes.
#
# Usage:
#   preview-links.sh block-upsert <pr> <block-file> < body   pure; prints the new body
#
# Every failure is a ::warning:: and a non-zero exit. deploy-preview runs these steps with
# continue-on-error: a red deploy-preview has to keep meaning «the preview is broken».
set -euo pipefail

# upsert_block <pr> <block-file>: body on stdin, new body on stdout, no trailing newline.
# The block file's contents (markers included) replace this PR's marker range in place, or
# are appended after one blank line when there is none; an empty file removes the range.
# CRLF becomes LF first, because a body written in the web UI carries CRLF and a marker
# line ending in \r would never match. A start marker with no end marker after it exits 3
# and prints nothing: the only other reading is «delete to the end of the body», and
# whatever follows that marker may be the author's own text.
upsert_block() {
  tr -d '\r' | awk -v start="<!-- yagoda-preview:pr-$1:start -->" \
                   -v end="<!-- yagoda-preview:pr-$1:end -->" -v bf="$2" '
    BEGIN { blk = ""; while ((getline l < bf) > 0) blk = blk l "\n" }
    { line[++n] = $0 }
    END {
      s = 0; e = 0
      for (i = 1; i <= n; i++) {
        if (!s && line[i] == start) s = i
        else if (s && !e && line[i] == end) e = i
      }
      if (s && !e) exit 3
      out = ""
      for (i = 1; i <= n; i++) {
        if (s && i == s) { out = out blk; i = e; continue }
        out = out line[i] "\n"
      }
      sub(/\n+$/, "", out)
      if (!s && blk != "") out = (out == "" ? "" : out "\n\n") blk
      sub(/\n+$/, "", out)
      printf "%s", out
    }'
}

case "${1:-}" in
  block-upsert) upsert_block "$2" "$3" ;;
  *) echo "usage: $0 block-upsert <pr> <block-file>" >&2; exit 2 ;;
esac
