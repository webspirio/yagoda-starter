#!/usr/bin/env bash
# Usage: bash pr-for-issue.sh <issue-number>
# Lists every PR linked to the issue (Development panel or a closing keyword), with state,
# draft flag, author, head sha and the issues each PR closes — then says whether a
# REQUEST_CHANGES review is possible at all.
source "$(dirname "$0")/../../ticket/scripts/lib.sh"
[[ $# -eq 1 ]] || die "usage: pr-for-issue.sh <issue>"
n=$1
login=$(me)
gh issue view "$n" --repo "$REPO" --json state,assignees \
  --jq "\"issue #$n: \(.state), assignees: \([.assignees[].login] | join(\", \") | if .==\"\" then \"none\" else . end)\""
prs=$(gh api graphql -F n="$n" -f q="${REPO%%/*}" -f r="${REPO##*/}" -f query='
  query($q:String!,$r:String!,$n:Int!){ repository(owner:$q,name:$r){ issue(number:$n){
    closedByPullRequestsReferences(first:10, includeClosedPrs:true){ nodes{ number } } } } }' \
  --jq '.data.repository.issue.closedByPullRequestsReferences.nodes[].number')
# Fallback (the PR-body «Closes» often doesn't register here): PRs whose body names #N with a
# closing keyword — not every PR that merely contains the number.
if [[ -z "$prs" ]]; then
  while read -r pr; do
    [[ -n "$pr" ]] || continue
    gh pr view "$pr" --repo "$REPO" --json body --jq .body | closing_numbers | grep -qx "$n" && prs+="$pr "
  done < <(gh pr list --repo "$REPO" --state all --search "$n in:title,body" --json number --jq '.[].number')
fi
[[ -n "$prs" ]] || die "no PR found for #$n — ask the user"
for pr in $prs; do
  IFS=$'\t' read -r state author line < <(gh pr view "$pr" --repo "$REPO" \
    --json number,state,isDraft,author,headRefOid,title,closingIssuesReferences \
    --jq '[.state, .author.login, "PR #\(.number) \(.state) draft=\(.isDraft) author=\(.author.login) head=\(.headRefOid[0:7]) closes=\([.closingIssuesReferences[].number]|map("#"+tostring)|join(",")) — \(.title)"] | @tsv')
  echo "$line"
  if [[ "$state" != OPEN ]]; then
    echo "  → $state: GitHub refuses APPROVE/REQUEST_CHANGES here. Ask the user (new issue? COMMENT review?)."
  elif [[ "$author" == "$login" ]]; then
    echo "  → your own PR: you cannot request changes on it. Ask the user."
  else
    echo "  → reviewable: REQUEST_CHANGES possible."
  fi
done
