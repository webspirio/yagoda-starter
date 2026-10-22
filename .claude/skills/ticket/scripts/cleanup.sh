#!/usr/bin/env bash
# Usage: bash cleanup.sh <issue-number>
# After the PR is MERGED (or closed unmerged), from the main checkout: removes ../yagoda-<N> and its local branch, if the tree is clean.
# Never closes the issue and never touches the board — see the skill's «After the merge».
source "$(dirname "$0")/lib.sh"
[[ $# -eq 1 ]] || die "usage: cleanup.sh <issue>"
n=$1
main=$(main_checkout)
wt="$(dirname "$main")/yagoda-$n"
[[ -d "$wt" ]] || die "no worktree at $wt"
branch=$(git -C "$wt" branch --show-current)
# PR state, not `merge-base --is-ancestor`: a squash merge is never an ancestor.
state=$(gh pr list --repo "$REPO" --head "$branch" --state all --json state --jq '.[0].state // "NONE"')
[[ "$state" == MERGED || "$state" == CLOSED ]] || die "PR for $branch is $state — not removing the worktree"
[[ -z "$(git -C "$wt" status --porcelain)" ]] || die "$wt has uncommitted changes — look before removing"
run git -C "$main" worktree remove "$wt"
run git -C "$main" branch -D "$branch"
db="$(echo "$branch" | tr '/-' '__')_test"
echo "removed $wt and local $branch. Remote branch kept (team policy undecided)."
echo "if you used it: DROP DATABASE IF EXISTS $db;"
