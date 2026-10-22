#!/usr/bin/env bash
# Usage: bash return-to-author.sh <pr-number>
# AFTER the REQUEST_CHANGES review and the issue comment are posted: for EVERY issue the PR
# closes, board → «In progress» and the issue goes back to the PR author (you are removed).
# Other assignees (e.g. the tester) are left alone.
source "$(dirname "$0")/../../ticket/scripts/lib.sh"
[[ $# -eq 1 ]] || die "usage: return-to-author.sh <pr>"
pr=$1
login=$(me)
author=$(gh pr view "$pr" --repo "$REPO" --json author --jq .author.login)
[[ "$author" != "$login" ]] || die "PR #$pr is your own — there is no one to return it to"
issues=$(gh pr view "$pr" --repo "$REPO" --json closingIssuesReferences --jq '.closingIssuesReferences[].number')
# The PR-body «Closes #N» often doesn't register here — fall back to the numbers in the body.
[[ -n "$issues" ]] || issues=$(gh pr view "$pr" --repo "$REPO" --json body --jq .body | closing_numbers)
[[ -n "$issues" ]] || die "PR #$pr names no issue it closes — ask the user which issue to return"
for n in $issues; do
  run gh issue edit "$n" --repo "$REPO" --add-assignee "$author" --remove-assignee "$login" >/dev/null
  echo "issue #$n: assigned back to $author"
  set_status "$(issue_url "$n")" "In progress"
done
