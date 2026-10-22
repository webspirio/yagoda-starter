#!/usr/bin/env bash
# Usage: bash wait-bot.sh <pr-number> [max-minutes=40]
# Blocks until the review bot has reviewed the PR's current head commit — re-read on every
# poll, so a push during the wait moves the target — then prints its
# verdict and blocking line. Run it in the background and continue on its exit.
# Exit 0 = reviewed, 2 = timed out (prints TIMEOUT — never silent), 1 = error.
source "$(dirname "$0")/lib.sh"
[[ $# -ge 1 ]] || die "usage: wait-bot.sh <pr> [max-minutes]"
pr=$1 cap=${2:-40}
draft=$(gh pr view "$pr" --repo "$REPO" --json isDraft --jq .isDraft)
[[ "$draft" == false ]] || die "PR #$pr is a draft — the bot ignores drafts; run gh pr ready first"
short=""
deadline=$(( $(date +%s) + cap * 60 ))
while (( $(date +%s) < deadline )); do
  sha=$(gh pr view "$pr" --repo "$REPO" --json headRefOid --jq .headRefOid)
  if [[ "${sha:0:7}" != "$short" ]]; then
    [[ -z "$short" ]] || echo "head moved $short → ${sha:0:7}; waiting for the new head"
    short=${sha:0:7}
  fi
  body=$(gh api "repos/$REPO/issues/$pr/comments" --paginate \
    --jq "[.[] | select(.user.login==\"$BOT_LOGIN\" and (.body|contains(\"auto-review: $short\")))] | last | .body // empty" || true)
  if [[ -n "$body" ]]; then
    echo "bot reviewed $short:"
    grep -E '\*\*(Verdict|Blocking)\*\*' <<<"$body" || echo "(no verdict line — read the comment)"
    exit 0
  fi
  sleep 30
done
echo "TIMEOUT: no $BOT_LOGIN review of $short within $cap min — check the PR by hand"
exit 2
