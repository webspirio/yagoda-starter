---
name: ticket-review
description: >
  Use when asked to review a teammate's PR for an issue of this repository — «зроби ревʼю на
  тікет N», «глянь PR колеги», «залиш коментар в issue та pr і зроби request changes» —
  including posting the result on the PR and the issue and returning the ticket to its
  author. Not for reviewing your own PR (that is the ticket skill's review step).
---

# Reviewing a teammate's ticket PR

No grilling/brainstorming here — a review builds nothing.

Two readers, two posts: the **PR author** gets one technical review on the PR (that review
IS the «коментар в PR» users ask for); the
**tester/PM** (Ліна `linaokhrimenko`) gets a plain comment on the issue. Scripts live in
`.claude/skills/ticket-review/scripts/` and share the ticket skill's `lib.sh`
(`DRY_RUN=1` prints writes).

## 1. Find the PR — and whether a review is possible

`bash .claude/skills/ticket-review/scripts/pr-for-issue.sh <N>` lists the linked PRs with state, author, head sha and
the issues each closes, and says per PR whether `REQUEST_CHANGES` is possible.
- PR **merged/closed** → GitHub refuses approve/request-changes. Stop and ask the user
  (a new issue for the findings? a COMMENT review?). Don't reopen anything yourself.
- PR **by the user themselves** → can't request changes on your own PR. Ask.
- Several PRs → ask which one, unless only one is open.

## 2. Review

`/code-review <PR>` (or a fresh agent with `superpowers:requesting-code-review`; with
neither installed, a fresh general agent given the diff) plus the domain skills. Read the
issue's acceptance criteria and the PR body. Check its verification claims (verdict lines
pasted, skips named, no widened baseline).
- The user's request already says to post («залиш коментар… request changes») → post.
- Otherwise → report the findings in Ukrainian and ask before posting anything.

## 3. Post on the PR — ONE review

`gh pr diff <PR>` first: a finding goes **inline only if its line is inside a diff hunk**
(else the whole call fails with 422). Findings in untouched files go into the review body
as `path:line` with a link pinned to the head sha:
`https://github.com/webspirio/yagoda-starter/blob/<head sha>/<path>#L<line>`.

```bash
gh api -X POST repos/webspirio/yagoda-starter/pulls/<PR>/reviews --input review.json --jq .html_url
# review.json:
# {"commit_id":"<head sha>","event":"REQUEST_CHANGES",
#  "body":"<Ukrainian, technical: Блокуюче / Застарілі доки / Не блокує; untouched-file findings with path:line>",
#  "comments":[{"path":"<file>","line":<new-file line>,"side":"RIGHT","body":"<finding>"}]}
```

No separate PR comment. Images: upload with `bash .claude/skills/ticket/scripts/shots.sh` and use the
URL (reviews have no `--attach`).

## 4. Post on the issue — for the tester/PM

`gh issue comment <N>`: plain Ukrainian, no code. What already works · what is wrong in
user terms, with a concrete example (numbers, a screen) · decisions the client must make ·
link to the review (the `html_url` the POST printed). One comment per issue the PR closes.

## 5. Return the ticket

`bash .claude/skills/ticket-review/scripts/return-to-author.sh <PR>` — for every issue the PR closes: board →
«In progress», assigned back to the PR author, you removed (others, e.g. the tester, stay).

## Common mistakes

| Mistake | Instead |
|---|---|
| Inline comment on a line outside the diff | body with `path:line` |
| One combined text for author and PM | technical review on PR, plain comment on issue |
| Only the issue named by the user returned | `return-to-author.sh` walks every closed issue |
| Request changes on a merged PR | ask the user what to do |
| Closing or reopening issues | never by hand |
