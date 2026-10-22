#!/usr/bin/env bash
# Usage: bash start.sh <issue-number> <branch>     e.g.  bash start.sh 265 fix/265-profile-avatar
#
# Takes the ticket: refuses a closed issue, assigns you, board → «In progress», creates
# the branch through the issue's Development panel (so the merge closes the issue), and
# a sibling worktree ../yagoda-<N> with the main checkout's .env copied in.
# It does NOT post the «взято в роботу» comment (that text is yours) and does NOT run
# `npm ci` (minutes — run it in the background yourself; the last line prints the command).
source "$(dirname "$0")/lib.sh"
[[ $# -eq 2 ]] || die "usage: start.sh <issue> <type/N-slug>"
n=$1 branch=$2
[[ "$branch" =~ ^[a-z]+/${n}- ]] || die "branch should look like feat/${n}-short-slug (type/N-slug), got «$branch»"

state=$(gh issue view "$n" --repo "$REPO" --json state --jq .state)
[[ "$state" == OPEN ]] || die "#$n is $state — ask the user which ticket they meant before writing anything"

main=$(main_checkout)
wt="$(dirname "$main")/yagoda-$n"
[[ ! -e "$wt" ]] || die "$wt already exists — reuse it or remove it first"
[[ -f "$main/.env" ]] || die "no .env in the main checkout $main — copy .env.example and fill it first"

# Branch and worktree first: if any of them fails, the issue is not left assigned and
# «In progress» with nothing behind it.
run timeout 60 gh issue develop "$n" --repo "$REPO" --base main --name "$branch" >/dev/null
run git -C "$main" fetch -q origin "$branch"
run git -C "$main" worktree add -q "$wt" "$branch"
run cp "$main/.env" "$wt/.env"

login=$(me)
run gh issue edit "$n" --repo "$REPO" --add-assignee "$login" >/dev/null
echo "assigned: $login"
set_status "$(issue_url "$n")" "In progress"

db="$(echo "$branch" | tr '/-' '__')_test"
cat <<EOF
worktree: $wt (branch $branch, .env copied)
next:
  - post «взято в роботу» on #$n: what will and will NOT be done
  - (cd $wt && npm ci)            # background it — it takes minutes
  - TEST_DB_NAME=$db for every test:db run AND every git push from this worktree
EOF
