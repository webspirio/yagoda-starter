---
name: verify
description: >
  How to run this repository's verification layer and how to read what it says — the three
  commands (`npm run verify`, `verify:full`, `verify:ci`), what each tier reaches, the
  pre-push gate and why three rows sit outside it, the five row statuses and which ones
  block, and the rules that govern adding or editing a row. Use when running verify or
  interpreting its output, deciding which tier a change needs, adding or editing a row in
  scripts/verify/registry.mjs, or judging whether a green run actually covers the thing
  being claimed.
---

# The verification layer

The layer is `scripts/verify/run.mjs` (the runner) and `scripts/verify/registry.mjs` (the
rows). The root `CLAUDE.md` keeps only the three rules that bind how a turn reports its own
verification; everything about *using* verify is here.

This file deliberately carries **no row list, no row count and no timing table**. All three
rot, and every one of them has. The runner prints its own rows, their durations and their
blind spots on every run, green runs included — that output is the artifact to read.

## The three commands

```bash
npm run verify        # the fast tier — the per-turn gate
npm run verify:full   # adds the rows that need a build, a browser, a database or the registry
npm run verify:ci     # verify:full with --no-skip: a missing precondition is a FAILURE
```

`npm run verify` is what a turn is checked against, and what `.claude/hooks/stop-gate.mjs`
runs after every turn. It does not build the app, start a container or touch a database.

## What the fast tier cannot see

Four classes of change need `verify:full`, because the fast tier has no way to observe them:

- **anything whose proof is in a production build** — tree-shaking, module resolution, a
  plugin in the Vite chain, bundle size;
- **anything whose proof is in a browser** — the built bundle against the real backend
  through nginx;
- **anything whose proof is real SQL** — every `*.db-spec.ts` suite, which is where the
  money formulas, the void-authorization matrix and the migration DDL actually live;
- **a dependency change** — the advisory database and the bundle budget both live there.

A migration and a lockfile edit are always in that set.

## Reading a run

| status | meaning | blocks |
| --- | --- | --- |
| `PASSED` | ran, passed | no |
| `FAILED` | ran, failed | yes |
| `SKIPPED` | a precondition was absent — there was nowhere to run | no, but it must be said out loud |
| `NOT_RUN` | a dependency did not pass, so this was never attempted | yes |
| `UNRUNNABLE` | the command could not start (127 / spawn error) | yes |

`UNRUNNABLE` is not pedantry. Reporting "lint FAILED" when the linter is merely absent from
`PATH` asserts something about the code that nobody tested.

Every run ends with **What this does NOT prove** — one paragraph per row that EXECUTED,
printed on green runs as well as red. Read it before claiming coverage. There is no copy of
it in this file: a second copy would be one more thing to keep true, and the one that used
to live here was green over a row whose own arithmetic contradicted itself.

## The pre-push gate

`npm run verify:prepush` runs from `.githooks/pre-push`, wired by `npm install`. Three rows
are excluded, each for a reason, none of them "it was slow":

| row | why it is not in the hook |
| --- | --- |
| `smoke` | recreates the shared `backend` container and reseeds the dev database. Fine as a CI step; not as a side effect of every `git push`. |
| `coverage` | its floors are deliberately CI-only — locally they read as zero, so it can report but never gate. |
| `audit` | depends on an external advisory database that changes with nothing in this repo. A push must not fail because a severity was reclassified an hour ago. |

The flag is `--exclude`, not `--only`, on purpose: a row added later joins this gate
automatically, so forgetting to update it makes the gate wider, never quietly narrower.
`--no-skip` is deliberately absent — a laptop without Docker or Postgres SKIPS those rows
and says so rather than blocking the push.

A hook can be skipped (`git push --no-verify`, or a clone that never ran `npm install`), so
CI runs everything again. That duplication is the point: local for speed of feedback, CI for
proof. CI is also the only environment that is cold, clean and identical for everyone — no
laptop measurement stands in for it, which this repo learned when a warm-cache local green
hid three CI timeouts.

## Rules for adding or editing a row

1. **No baseline keyed by line number.** Key on a content hash of the finding plus its
   enclosing symbol, or do not ratchet. A line-keyed baseline is not merely noisy: a stale
   key has silently matched the WRONG expression more than once, and this repo has re-keyed
   the same unchanged exemption four times without ever finding a defect.
2. **No test may assert that the whole repository is green** — at most one such test per
   check. Every positive test carries a DISCRIMINATOR proving the check actually scanned,
   because "stays green" cannot otherwise tell "correctly not flagged" from "never looked
   at". Both have been observed passing under a scanner that saw nothing.
3. **No test may write the real working tree or the git index.** Every check takes
   `--root`/`VERIFY_SCAN_ROOT` (`scripts/verify/scan-root.mjs`) and its fixtures live in
   `mkdtempSync` directories. The Stop hook runs the fast tier after every turn under a
   timeout that kills the process group, so a `finally` that restores a file is not a
   guarantee — two overlapping runs are the normal case here, not an edge case.
4. **A check that scanned nothing must refuse a verdict.** `refuseEmptyScan` exists because
   two checks printed their positive claim over an empty tree and exited 0.
5. **No hand-written count, percentage, duration or date in any prose string.** Derive it at
   runtime and print it, or omit it. `registry.test.mjs` enforces this; do not add a
   suppression. Every number that has ever been in this layer's prose went stale, and the
   check that compared two copies of it was green over all of them.
6. **A check's declared scope must be mechanically tied to its actual scope.** Read globs
   from the config that owns them; never keep a second copy. Every Critical this layer has
   had was a glob, regex or hash surface narrower than the sentence describing it. When the
   honest answer to "what does this read?" is "everything", say that rather than enumerate:
   the freshness surface was a hand-kept list of prefixes four times too narrow, and the
   fourth time was a check whose input is every tracked file, which no list could express.
7. **A ratchet is justified only when its finding set is genuinely stable.** Prefer fixing
   the finding over recording it. For a team this size a large bidirectional baseline is
   ceremony that gets bypassed one row at a time, and a rule enforcing a reason by LENGTH
   teaches people to write that many characters.
   **Tell the tool the truth before you suppress anything.** knip reported 57 dead FILES
   that jest, TypeORM and Claude Code invoke — declaring them `entry` removed 47 of them
   AND three false positives, because the alternative, `ignore`, blinds the tool to those
   files' imports and manufactures findings. Measured, both configs, same tree: 136 findings
   against 139. An ignore list is the last instrument to reach for, not the first.
8. **The layer's own rows stay cheap.** The fast tier runs on every turn; above a few
   seconds people route around it, and a gate that is routed around is worse than no gate.
   `lint`, `typecheck` and `test` are not the layer's to control — after a frontend edit
   they cost tens of seconds on their own, and no amount of deleting checks changes that.

## Writing a `proves` and a `blindSpot`

40–80 words each, enforced by `registry.test.mjs`. `proves` must be falsifiable by THIS
command failing — if no possible failure of `cmd` could make the sentence untrue, it is
decoration. `blindSpot` must not be written broader than the command establishes.

Answer one question: *does a green run cover the change I just made?* History, dates,
incident narratives and measurements go in the commit message, which is where they already
are, and where they cannot rot into a green check.

## When a check is removed

One line in the commit message: what it proved, what now covers that, and what is genuinely
lost. Delete the script, the baseline and the tests with it. `registry.test.mjs` has an
orphan-script test because a row was once removed leaving all three behind — still enforced
through `selfcheck`, where no row, no table and no blind-spot footer could see it.
