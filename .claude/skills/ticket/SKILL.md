---
name: ticket
description: >
  Use when taking a GitHub issue of this repository into work — «робимо тікет N», «взяв
  тікет», «зроби тікет до кінця», «передай на ревʼю» — from the first touch of the issue
  through the PR, the automated review bot, the hand-off to a human reviewer and the
  cleanup after the merge. Not for reviewing someone else's PR (that is ticket-review)
  and not for writing a new issue.
---

# Ticket → PR → hand-off

The team reads progress off the **Main board**, the issue's assignee and its comments —
not off your terminal. Every phase below leaves a trace there. The mechanical steps are
scripts (`bash .claude/skills/ticket/scripts/<name>.sh`, `DRY_RUN=1` prints writes instead
of doing them); the judgement steps are yours. Run them from the repo root or the worktree.

Team: Гліб `hlibVasylevskyi` (reviewer) · Ліна `linaokhrimenko` (tester/PM, works from
the board) · Вадим `dz-vadim` · review bot `swefd`. The hand-off reviewer is whoever the
user names; if nobody is named, ask.

## Phases

**1. Take it.** `bash .claude/skills/ticket/scripts/start.sh <N> <type>/<N>-<slug>` — refuses a closed issue
(ask the user which ticket they meant), creates the branch via the issue's Development
panel and the worktree `../yagoda-<N>` with `.env`, then assigns you and sets the board
to «In progress». Then:
- `npm ci` in the worktree, in the background.
- `gh issue comment <N> --body-file <f>`, Ukrainian, for the tester: «Взято в роботу» +
  what will and what will NOT be done.
- Open questions in the issue («Треба уточнити»): if the user said «автономно», state the
  assumption you take in this comment and go on; ask only when the answer changes what
  gets built.

**2. Plan.** `grilling` → `superpowers:brainstorming` → plan (CLAUDE.md). Under «автономно»
answer the grilling questions yourself from the code and `26-rules-by-example.md`, and
write the decisions into the plan instead of waiting. Post a short plan on the issue. Too
big (> ~2 days / ~1000 lines) → split or say why not. No superpowers plugin installed →
do the same steps by hand.

**3. Build.** TDD and the domain skills. The pre-push hook runs `test:db`, so Postgres must
be up (`docker compose up -d postgres redis` from the main checkout — not backend/frontend,
which would re-point the shared stack). Every `test:db` run and every `git push` from the
worktree carries `TEST_DB_NAME=<branch with / and - as _>_test` (start.sh prints it).
After the first commit: push, then `gh pr create --draft --base main` — title like the log
(`fix(scope): … (#N)`), body in Ukrainian ending with `Closes #N`. Closing is done by the
Development link on merge; don't add `Closes #N` to commit messages.

**4. Prove it.**
- Verify at the tier the change needs (`verify` skill); paste verdict lines, name skips.
- `rm -rf frontend/dist` before every push (a stale dist doubles the bundle reading).
- Code review by a fresh agent (`superpowers:requesting-code-review`); fix, re-verify.
- Screenshots of the changed screen on the PR preview (`https://pr-<PR>.yagoda.webspirio.com`,
  operator `oksana`/`operator`; Playwright from `node_modules/@playwright/test`), desktop
  AND phone width. No preview (stacked PR, preview cap) or an owner-only screen (the
  preview's owner password is a secret) → a local stack from the worktree on its own
  database: `DB_NAME=<x>_dev` backend on its own port, `npm run db:seed` (owner
  `admin`/`admin`), `VITE_API_URL=… npx vite`.
- `bash .claude/skills/ticket/scripts/shots.sh *.png` prints user-attachment links — put
  them in the PR body (`gh pr edit <PR> --body-file <f>`). Never commit images.
- PR body: what changed, how to test (numbered, on the preview), screenshots, verdict lines.

**5. Ready.** `gh pr checks <PR> --watch` in the background; green → `gh pr ready <PR>` — unless the user said they check the draft
first; then leave it a draft and tell them. The bot ignores drafts.

**6. Bot loop.** `bash .claude/skills/ticket/scripts/wait-bot.sh <PR>` in the background. Fix what the review
finds that is real (`superpowers:receiving-code-review`), verify, push, wait again —
until its verdict is «Ready to merge» on the current head. **Do not reply to the bot in
comments**: add a short «Review fixes (`<sha>`)» section to the PR body instead. Re-shoot
screenshots if a fix changed the UI.

**7. Hand off.** Final issue comment, Ukrainian, plain words, for the tester: what is on
the screen now, preview link + login, numbered steps to check, screenshots, what is NOT in
this ticket. Then `bash .claude/skills/ticket/scripts/handoff.sh <N> <PR> <reviewer>` — unassigns you, assigns
the reviewer, requests their PR review, board → «Ready for review».

**8. After the merge.** Never close the issue by hand and never set «Done» yourself: if
the merge automation closed it, leave it; if it stayed open, comment the merge commit and
leave the board. From the main checkout, `bash .claude/skills/ticket/scripts/cleanup.sh <N>`
removes the worktree once the PR is merged (or closed unmerged).
Don't `gh pr merge --delete-branch` from inside the worktree — it deletes the worktree too.

## Not decided yet (don't present these as rules)

When the tester checks (preview before merge or staging after) · whether a human approval
is needed besides the bot · deleting remote branches after merge · the Stop-hook verify.

## Common mistakes

| Mistake | Instead |
|---|---|
| Working on a closed issue the user named by mistake | start.sh refuses; ask |
| PR opened only at the end | draft after the first commit — the board and issue show work |
| Screenshots committed to the branch | `shots.sh` → user-attachments |
| Arguing with the bot in comments | fix + «Review fixes» in the PR body |
| Hand-off without the issue comment | the tester never sees the PR body |
| Closing the issue / «Done» after merge | the tester closes it after checking |
