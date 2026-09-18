---
name: verify
description: >
  How to run this repository's verification layer and how to read what it says — the three
  commands (`npm run verify`, `verify:full`, `verify:ci`), what each tier covers and what it
  costs on a laptop and in CI, the pre-push gate and why three rows are excluded from it, the
  five row statuses and which ones block, and the generated per-row table of what every
  check PROVES and what it stays BLIND TO. Use when running verify or interpreting its
  output, deciding which tier a change needs, adding or editing a row in
  scripts/verify/registry.mjs, sizing a row's timeout, or judging whether a green run
  actually covers the thing being claimed.
---

# The verification layer

This file is the reference for using the layer. The layer itself is
`scripts/verify/run.mjs` (the runner) and `scripts/verify/registry.mjs` (the rows). The
root `CLAUDE.md` keeps only the three rules that govern how a turn reports its own
verification; everything about *using* verify is here.

There is NO generated table in this file any more. What each row proves and stays blind to
lives in `scripts/verify/registry.mjs`, and a run prints it — see the last section.


The gate a turn is checked against — `npm run verify` — runs the **fast tier only**: 13 of
the registry's 19 rows (`ratchet:money` was removed 2026-09-18). There is no `build`, no `smoke`, no `test:db` and no `coverage` row
in it, so a turn can end green having never built the app, never started a container and
never touched a database. `typecheck` *is* in the fast tier, so a type error is caught; what
stays uncovered is exactly what breaks only in a Vite production build or only against real
Postgres — `npm run verify:full` is what reaches those six. NOTHING IN EITHER TIER BUILDS A
DOCKER IMAGE any more: the `docker` row was deleted on 2026-09-15 for duplicating the
`docker` job in .github/workflows/ci.yml, which builds the same two images with a warm
buildx cache, in parallel, and has to build them anyway to push them. That job's header
carries what the row proved, and `npm run docker:build` is still there to run by hand. For
the exact current list, read the generated table below rather than any count repeated in
prose, which is what goes stale.

Three commands. The cost figures below are a SNAPSHOT, MEASURED 2026-09-15 on the tree this
branch merged 156 commits of main into — they drift with every row added and every test
either workspace gains, and MUST be re-measured rather than assumed once they look
suspicious. To re-measure: edit a file with content turbo has never hashed before. Turbo
caches by content hash, so re-applying the SAME edit text used in an earlier measurement
silently replays that run's cached result and reports a falsely fast number — this is
exactly how an earlier version of this snapshot (12.7s / 32.3s / 1.1s) understated the true
cost, in one case by more than 10x. Use a fresh, unique probe (e.g. append a one-off
timestamped comment) every time you measure.

A genuine COLD number (empty turbo cache) is deliberately NOT given below. This worktree's
turbo cache lives at `/home/dz/work/yagoda-starter/.turbo` — the MAIN checkout's root, not
this worktree — and is therefore SHARED with every other worktree of this repository,
several of which hold unrelated open work. Wiping it to get a true cold reading would
destroy cache state other branches depend on, so don't: measuring "cold" locally in a
worktree never actually is, and a `rm -rf` there is a shared-state footgun, not a
measurement technique.

```bash
npm run verify        # fast tier, all 13 rows. COSTS MEASURED 2026-09-15 at 14 rows:
                       #   turbo tasks, cache bypassed (not wiped — see above):
                       #     `npx turbo lint typecheck test --force`        38.8s
                       #   backend-only edit:          ~51.4s  (lint 2.0s / typecheck 2.7s /
                       #                                test 6.9s / selfcheck 36.2s / rest ~2.7s)
                       #   frontend-only edit:         ~77.7s  (lint 5.7s / typecheck 5.4s /
                       #                                test 26.9s / selfcheck 35.9s / rest ~2.8s)
                       #   warm, nothing changed:      ~41.0s
                       # SELFCHECK IS NOW THE DOMINANT COST, and that is the headline of this
                       # re-measurement: ~36s on EVERY run regardless of what changed, because
                       # node --test re-executes all 154 of the layer's own tests and nothing
                       # caches them. It was ~9.5-10s at 70 tests on 2026-09-10. It alone is
                       # why "warm, nothing changed" is ~41s rather than near-zero, and why the
                       # backend-edit path costs more than the forced turbo run it contains.
                       # The frontend edit is the expensive turbo path: vitest builds 130 jsdom
                       # environments per run, up from 99. Cutting either cost is deliberately
                       # out of scope here. A truly cold `npm run verify` (empty cache) is NOT
                       # measured — see above — but ARITHMETIC over two real measurements
                       # (38.8s turbo-forced + ~36s selfcheck + ~2.7s for the remaining
                       # non-turbo rows) puts it around 77s. That is a sum, not a measurement
                       # — do not quote it as one.
npm run verify:full   # the fast tier plus the six rows that need a build, a browser, a
                       # database or the npm registry, MINUS `test` — 18 rows execute, of
                       # the registry's 19. `coverage` declares `supersedes: ['test']` and runs
                       # the identical jest/vitest suites under instrumentation, so running
                       # both executed every test in this repo twice: 220.4s + 254.6s on CI
                       # run 34998136933, eight of that run's twenty minutes. The run prints
                       # its own SUPERSEDED line rather than quietly showing all 19 rows, and
                       # what the swap gives up is written on both registry rows. The fast
                       # tier and the pre-push gate (`--exclude coverage`) still run `test`.
npm run verify:ci     # verify:full with --no-skip — a missing precondition is a failure
                       # here, not a quietly narrower green
```

THE LAPTOP NUMBERS ABOVE ARE NOT CI NUMBERS, and on 2026-09-15 that gap was not academic:
the first real CI run of `npm run verify:ci` came back RED with three rows — `test`,
`coverage` and `test:db` — each reporting `timed out after 120.0s` against the runner's
inherited per-check default, with nothing actually wrong in two of them. Locally all three
are seconds, because Turbo serves them from cache and Postgres is already warm, so no
number measured on this machine could ever have shown it.

THE FULL GREEN CI READING, run 35011857830: 20 rows summing to 8m24s, inside a job that
took 9m35s — the ~71s difference is `npm ci`, `playwright install`, `docker compose up` and
the artifact upload, none of which is a row. Per row: lint 16.9s, typecheck 16.7s,
test:ci-scripts 6.7s, selfcheck 67.3s, build 14.6s, coverage 247.2s, test:db 28.9s,
docker 60.6s, smoke 36.6s; the remaining eleven cost 2.3s (audit) and less, 8.9s together.
`test` does not appear because it does not run here — `coverage` supersedes it.

SIX ROWS CARRY THEIR OWN `timeoutMs` in `scripts/verify/registry.mjs` as of 2026-09-16 —
`test` 600s, `coverage` 600s, `selfcheck` 240s, `smoke` 180s, `audit` 120s, `test:db` 300s
— and the other fourteen inherit the runner's `DEFAULT_TIMEOUT_MS`, which dropped from an
inherited 120s to a measured 60s the same day. Every one of them is a HANG DETECTOR sized
above a cold CI reading, never a performance gate: the performance signal is the duration
printed beside every row, on green runs as well as red. Two are worth knowing about
specifically. `selfcheck` is the row that forced the re-measure — it cost 67.3s cold under
a 120s default nobody had checked it against, and it grows with every test the layer adds.
`audit` is loose against its own 2.3s reading on purpose, because `needs: ['npm-registry']`
means its duration belongs to a server nobody here operates, and a tight budget would
report someone else's slow day as this tree's defect.

THAT READING WAS COLD — the Turbo key lineage was new and had nothing to restore — and the
run straight after it is the other half of the picture. Run 35013872995: the same 20 rows
green in **5m00s** (rows 3m48s), differing from the run above only in a commit that touched
no workspace, so every Turbo task replayed. coverage 247.2s -> 254ms, lint 16.9s -> 210ms,
build 14.6s -> 229ms. `typecheck` only falls 16.7s -> 4.1s, because `npm run typecheck` is
`turbo typecheck && tsc -p tsconfig.scripts.json && tsc -p tsconfig.e2e.json` and the last
two live outside Turbo, so they run in full every time. FIVE MINUTES IS THE BEST CASE, not
the figure to quote for a feature PR: a change under backend/ or frontend/ re-runs that
workspace's `coverage`, the single dominant row when cold.

WHICH ROWS COST THE MOST INVERTS COMPLETELY BETWEEN THOSE TWO RUNS, and the warm ranking is
the one to read, because it is the one CI will normally be in. On that 5m00s run it was
selfcheck 69.2s (30% of all row time), docker 64.0s (28%), smoke 44.3s (19%), test:db 29.6s
(13%) — 90% in four rows, not one of which Turbo can cache. THAT READING IS WHAT DELETED
THE SECOND OF THEM: the `docker` row was an uncached `docker build` of the same two images
the `docker` JOB builds with a warm buildx cache, in parallel, and has to build anyway in
order to push. The duplication was worth 5% of a twenty-minute run when it was first left
alone and 28% of a five-minute one by the time anyone looked again, so the row is gone and
the job is the proof (see the note above, and that job's own header in ci.yml).

MEASURED AFTER THE REMOVAL, run 35017224544: 19 rows in 2m31s inside a **3m46s** job. The
ranking is now selfcheck 54.4s (36% of row time), smoke 49.7s (33%), test:db 28.7s (19%) —
88% in three rows, and every one of them a row nothing can cache. `selfcheck` is `node
--test` over this layer's own 164 tests, exactly as the local figures above already said,
and it is the first place to look if this job ever needs to get faster again. That run also
corrected an expectation worth writing down: its commit changed the root `package.json`,
which is a `changes` trigger and looks like it should invalidate everything, yet coverage
replayed in 199ms and build in 180ms. Turbo hashes inputs PER TASK, and that file's
`scripts` block is not an input to `backend#coverage` — a root-manifest edit is not
automatically a cold run.

THE THIRD ROW WAS NOT SLOW, IT WAS BROKEN, and the distinction cost two red runs to see.
`test:db` blew through 120s, then 480s, then was given 1200s purely to buy a reading. The
reading was never the problem: three jobs on a throwaway branch (run 35008065574) measured
the identical command at 31s against an Actions `services:` Postgres and over 21 minutes
against a Compose one, while direct probes (35010492674) found that Compose Postgres
perfectly healthy — 0.26ms per round trip, DROP 10ms, CREATE 23ms. The database `app_test`
simply did not exist there, the three suites that boot the whole AppModule never created it,
and jest hung after the suites had finished. See `backend/src/testing/db-harness.ts`.
A budget raised to accommodate a hang is a budget sized from a bug.

### The pre-push gate

`npm run verify:prepush` — `--tier full --exclude smoke,coverage,audit` — runs from
`.githooks/pre-push`, wired by `npm install` (`prepare` sets `core.hooksPath`). MEASURED
2026-09-15: **17 rows in 1m14s**, including `test:db` at 22s — the row that took three CI
runs to finish once, for a reason that turned out to have nothing to do with speed.

It is a cheaper place to find out, NOT a replacement for the `verify` job. A hook can be
skipped (`git push --no-verify`, or a clone that never ran `npm install`), so CI keeps
running everything, and that duplication is the point rather than an oversight: local runs
for speed of feedback, CI runs for proof. CI is also the only place that is cold, clean and
identical for everyone — no laptop measurement can stand in for it, which this repo learned
the hard way when a warm-cache local green hid three 120s CI timeouts.

Three rows are excluded, each for a reason and none of them "it was slow" (there were four
until 2026-09-15 — `docker` is not excluded from this gate, it no longer exists as a row):

| row | why it is not in the hook |
| --- | --- |
| `smoke` | recreates the shared `backend` container and reseeds the dev database. Fine as a CI step; not as a side effect of every `git push`. |
| `coverage` | 46s locally, and its floors are deliberately CI-only — locally they read as 0, so it can report but never gate. |
| `audit` | depends on an external advisory database that changes with nothing in this repo. A push must not fail because a severity was reclassified an hour ago. |

The flag is `--exclude`, not `--only`, on purpose: a check added later joins this gate
automatically, so forgetting to update it makes the gate wider, never quietly narrower.
`--no-skip` is deliberately absent — a laptop without Docker or Postgres SKIPS those rows
and says so out loud rather than blocking the push.

`node scripts/verify/run.mjs --tier fast --reuse-if-fresh` against an already-green report
for the same source hash costs about 0.06s (re-measured 2026-09-15 alongside the figures
above: 0.064s): it prints the same blind-spot footer without re-running anything. That is
roughly 640x cheaper than the ~41s warm run it stands in for, which is what makes the
`Stop` gate affordable on every turn.

Every one of those checks is an ordinary npm script that runs standalone, unchanged,
outside the orchestrator: `npm run lint`, `npm run typecheck`, `npm test` and
`npm run secrets` all run directly, from the command line, with
no orchestrator involved. Nothing exists only inside `scripts/verify/run.mjs`, and nothing
exists only inside CI — CI runs the identical command a laptop runs.

| status | meaning | blocks |
| --- | --- | --- |
| `PASSED` | ran, passed | no |
| `FAILED` | ran, failed | yes |
| `SKIPPED` | a precondition was absent — there was nowhere to run | no, but it must be said out loud |
| `NOT_RUN` | a dependency did not pass, so this was never attempted | yes |
| `UNRUNNABLE` | the command could not start (127 / spawn error) | yes |

`UNRUNNABLE` is not pedantry. Reporting "lint FAILED" when the linter is merely absent from
`PATH` asserts something about the code that nobody tested.

## What each row proves, and what it stays blind to

Every row's `proves` and `blindSpot` live in `scripts/verify/registry.mjs`, one object per
row, and a run prints every EXECUTED row's `blindSpot` under **What this does NOT prove** —
on green runs as well as red. That footer, not a copy in this file, is the artifact to read:
it covers exactly the rows that ran, in the run you just did, which a static table never can.

There used to be a generated copy of the whole table here, and a `memo` row that compared it
to the registry byte for byte. It proved the two copies agreed; it never proved either one
was TRUE, and it was green over a row whose own arithmetic contradicted itself. The copy is
gone rather than merely ungated — a second copy nothing gates on is strictly worse than no
copy.

