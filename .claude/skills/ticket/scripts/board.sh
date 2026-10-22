#!/usr/bin/env bash
# Usage: bash board.sh <issue-number> "<Status name>"
# Moves the issue's card on the Main board, e.g. "In progress", "Ready for review".
source "$(dirname "$0")/lib.sh"
[[ $# -eq 2 ]] || die "usage: board.sh <issue> \"<Status name>\""
set_status "$(issue_url "$1")" "$2"
