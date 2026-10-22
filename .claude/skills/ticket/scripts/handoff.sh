#!/usr/bin/env bash
# Usage: bash handoff.sh <issue-number> <pr-number> [reviewer-login]
# Hand-off AFTER the final issue comment is posted: unassign yourself, assign the reviewer
# on the issue, request their review on the PR, board → «Ready for review».
# No reviewer given → your review partner (review_pair in lib.sh).
source "$(dirname "$0")/lib.sh"
[[ $# -eq 2 || $# -eq 3 ]] || die "usage: handoff.sh <issue> <pr> [reviewer-login]"
n=$1 pr=$2
login=$(me)
reviewer=${3:-$(review_pair "$login")}
[[ -n "$reviewer" ]] || die "no review partner for $login in review_pair (lib.sh) — ask the user who reviews, then pass it"

[[ "$reviewer" != "$login" ]] || die "you cannot hand off to yourself"
pr_state=$(gh pr view "$pr" --repo "$REPO" --json state,isDraft --jq '"\(.state) draft=\(.isDraft)"')
[[ "$pr_state" == "OPEN draft=false" ]] || die "PR #$pr is $pr_state — hand off an open, non-draft PR"

run gh issue edit "$n" --repo "$REPO" --remove-assignee "$login" --add-assignee "$reviewer" >/dev/null
echo "issue #$n: $login → $reviewer"
run gh api -X POST "repos/$REPO/pulls/$pr/requested_reviewers" -f "reviewers[]=$reviewer" >/dev/null
echo "PR #$pr: review requested from $reviewer (re-request after every later push)"
set_status "$(issue_url "$n")" "Ready for review"
