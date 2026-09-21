# Plan: cut the verify layer to the checks that earn their keep

**Spec:** `docs/superpowers/specs/2026-09-18-verify-layer-simplification.md`
**Date:** 2026-09-18 · **Branch:** `refactor/verify-layer-simplification`

The spec was executed after a 19-agent investigation that probed every one of its factual
claims against the source. Most survived. **Eight did not**, and four of those would have
produced a red tree, a blocked push, or a false green if implemented literally. This plan
records what changed and why, so the deviations are decisions rather than drift.

---

## Baseline, measured before anything changed

`npm run verify` green, **61.7 s**, 13/13 PASSED, tree clean. Per-row (`.verify/last-run.json`):

| row | ms | | row | ms |
| --- | ---: | --- | --- | ---: |
| selfcheck | 48,030 | | secrets | 526 |
| test:ci-scripts | 7,671 | | seam | 465 |
| typecheck | 1,502 | | ratchet:lint-exempt | 268 |
| deadcode | 1,092 | | lint | 296 |
| migrations | 1,031 | | testfiles | 194 |
| ratchet:persist | 435 | | test | 186 |
| memo | 46 | | | |

`selfcheck` is **77.8 %** of the run — the spec's 76 % estimate, confirmed from a recorded run.
Registry prose: **13,314 words over 19 rows**, mean 701; all 38 `proves`/`blindSpot` fields
exceed the 80-word cap.

---

## Where this plan departs from the spec, and why

| § | Spec says | Evidence | This plan |
| --- | --- | --- | --- |
| §3.2 `audit` | replace with `npm audit --audit-level=high` + a prose risk note | `npm audit --audit-level=high` **exits 1** today (6 high advisories, 5 in the production tree); `--omit=dev` also exits 1. npm has no per-advisory ignore, so prose cannot make it green. Deleting the row additionally **blocks every `git push`** — `parseArgs` throws on an unknown `--exclude` id and `audit` is hard-coded in `package.json:53` and `.githooks/pre-push:61,:63`. | Replace `audit.mjs` (406+423+67 lines) with a **~70-line** check keyed on **GHSA ids**, each carrying `owner`, `accepted` and **`reviewBy`**. Keeps the bidirectional staleness check and the critical hard floor; adds the deadline the spec asks for; no new dependency. The upstream fix is now real — `@nestjs/platform-express@12.0.3` resolves `multer@2.4.0` — and is raised as a follow-up, not taken here (non-negotiable #3). |
| §2 `migrations` | enumerate `git ls-tree origin/main` and fail on a missing entry | This worktree is **behind** `origin/main`: 16 merged migrations there, 14 here, `HEAD` an ancestor. The literal rule reddens the fast tier on this exact tree and on every branch one pull behind. | Key the new rule 4b on **`git merge-base HEAD origin/main`**. Rule 4a keeps comparing against `origin/main`; both refs named in the blind spot. |
| §3.2 `deadcode` | delete the 1,511-line baseline; knip's own `ignore` covers it | The 47-of-57 figure counts only **file** findings, which are 57 of **188**. The best honest knip config still leaves **136** real findings. Zeroing them needs application-code deletion (forbidden by non-negotiable #3) or a ratchet relaxation (forbidden by CLAUDE.md rule 3). | Baseline **shrinks 188 → 136** and changes format: a flat `type\|file\|name` list, still bidirectional. Framework-invoked files declared as knip **`entry`**, never `ignore` — `ignore` blinds knip to their imports and manufactures new findings. |
| §4.1 | "~52 `numeric` columns" | 24 in the DBML, 26 in entities, 26 in migration SQL. ~52 double-counts. **Zero** entity properties are typed `number`, so this is a regression guard, not a bug fix — but it does find two real gaps: `grade_prices.max_markup` and `max_discount` exist in the entity and the migration and **not in the schema of record**. | Scope to `numeric` only. Land the two-line DBML fix in the same commit. |
| §4.3 | "9 hits elsewhere, and `shifts`' one is open/close" | There are **9 total**, and `shifts` is one of them. Its hit is `@Put(':id/explanation')` — the owner's post-hoc discrepancy explanation — not open/close, which are all `@Post`. | Conclusion unchanged; evidence corrected. Scope derived mechanically from the DBML's `voided_at` columns, not a hand-written list. |
| §2 | "slim `run.mjs` toward ~250 lines"; "under ~1,500 lines of implementation" | `runCommand` + `main` + `printTable` + `parseArgs` are **334 code lines** on their own, and every one is the five-status machinery, the report, or the footer. The KEEP list at today's sizes is already 4,392 lines. | Honest targets: **run.mjs ~650**, implementation **~2,900–3,300**, layer-to-app ratio **~7 %**. Chasing 250 forces deleting `dropSuperseded` (≈8 min of duplicated CI execution) or `classify`'s UNRUNNABLE heuristics (a renamed check script then reads as FAILED — and this refactor renames check scripts). |
| §5.7 / §6 | "fast tier under ~10 s warm" | Unreachable while `test:ci-scripts` (**7.7 s**, 59 % of the post-cut tier) is in it — the spec classifies that row neither KEEP nor CUT. And "warm" is the one case the gate never judges: after a frontend edit, `lint`+`typecheck`+`test` alone cost **36 s**, none of it the layer. | Classify `test:ci-scripts` explicitly (its 3.2 s of deadline burn is fixed first; demoted only if that is not enough). Restate the budget as **the layer's own rows**, with the product rows' cold cost quoted beside it as a separate, unfixable fact. |
| §3.1 | (a) delete the money ratchet, eslint becomes the net | The two nets are **completely disjoint** — zero of the ratchet baseline's 20 files are covered by an eslint money glob. Three modules owning **six** money/weight `numeric` columns (`grade-prices`, `tare-types`, `collection-points`, including `grade_prices.base_price`, which multiplies into every intake amount) are outside the eslint list. | Take **(a)**, but the widening lands **first, in its own commit**. Cost: four `(page-1)*limit` sites rewritten to the existing `skipOf()` helper, zero suppressions. |
| §7 | "CLAUDE.md says nine modules; the config lists eleven; the registry says eight" | All three describe the same list: 11 array entries = 8 globs + 3 `crates/` files spanning **9** directories. **CLAUDE.md's "nine" is the correct one.** The registry's "eight" is wrong — it enumerates eight and omits `crates/` entirely, describing three guarded files as unguarded. | Fix the registry, not CLAUDE.md, and then remove the number from both in favour of a derived assertion. |

### Rows the spec left unclassified, now decided

- **`seam`** — **keep rule 2, delete rule 1.** Rule 1 is the `'local'` string-literal rule §4.3
  argues against. Rule 2 (no module outside `backend/src/seed/` may import into it) is covered by
  nothing else in the repo; cutting it silently would breach non-negotiable #2.
- **`secrets` rule 3** — **keep.** It is the only net catching a credential pasted into `docs/`,
  `README.md` or a plan document, and it **has already fired on one**:
  `baselines/secret-boundary.json` pins a value from
  `docs/superpowers/plans/2026-09-09-coolify-deployment-and-cd.md`. Its cost is honest and stated:
  its declared input surface is every tracked file, so doc edits stop replaying a cached green.
- **`test:ci-scripts`** — fix the 3.2 s of artificial deadline burn first; demote only if needed.
- **`bundle`** — **keep the bespoke check.** `size-limit` cannot do the `--write` re-base
  arithmetic, emits nothing matching the runner's WARNING regex (killing non-negotiable #5 for
  that row), and reports kB not KiB. Add the missing warning: headroom is **10.0 KiB gzip against
  the check's own 25 KiB design minimum**, and the passing path cannot see it.

---

## Defects found that the spec does not contain

Each is the same class the spec exists to eliminate.

1. **A check that scans zero files prints a positive claim and exits 0.** Reproduced for both
   `seam` and `migrations` against an empty `backend/src`. Exactly one empty-input guard exists in
   the whole layer. **Every check gains a mandatory non-zero input assertion.**
2. **`turbo` silently skips a workspace that does not define the task, and the row is green.** So
   `npm run lint` can pass having linted one workspace — and under §3.1(a) `lint` is the only money net.
3. **`e2e/` and `playwright.config.ts` are FAST-tier `typecheck` inputs** (via `tsconfig.e2e.json`)
   and are outside the hash surface: a second, independent false green of the `.env.example` class.
4. **`.githooks/` is outside the hash surface** and is a test input at `run.test.mjs:276` — on a
   file this refactor must edit.
5. **`reportIsFresh`'s `scope.only` / `scope.exclude` guards fail OPEN** (an absent key is falsy),
   so a renamed key lets a one-row `--only` green replay as a whole-tier verdict.
6. **`reportIsFresh` ignores row statuses entirely**, so a green recorded while a precondition was
   absent replays forever.
7. **Nine production checks shell out to `git` with an unscrubbed environment** — only `hash.mjs`
   uses `gitEnv()`. Under an inherited `GIT_DIR` they enumerate the wrong repository's index.
8. **`hash.mjs`'s comment justifying its largest over-inclusion is false** — no check reads
   `CLAUDE.md`; `memo` reads `SKILL.md`.
9. **A gitignored `.DS_Store` in `backend/src/migrations/` turns the fast tier red** — rules 2/3
   enumerate with `readdirSync` while rule 1 uses `git ls-files`.
10. **The blind-spot footer never prints on the Stop-gate's own path** (`--json` returns before it).
11. **`docker:build` and `ratchet:money` are orphan npm scripts** with no registry row.
12. **Nothing lints `scripts/verify/` or `.claude/hooks/`** — `tsc` is the only static gate on the
    layer's own 10,700 lines.

---

## Commit sequence

Strictly serial on `registry.mjs`, `registry.test.mjs`, `package.json` and `SKILL.md`.
Every commit that deletes a check carries its coverage-loss note in the commit message.

| # | commit | verified with |
| ---: | --- | --- |
| C1 | hash surface: widen to every file a check reads; inverted test | `verify` + the `.env.example` fixture |
| C2 | report contract: `REPORT_KEYS`, `withKeys`, `VERIFY_REPORT_DIR`, the two fail-open guards | `test:verify`, rename fixture |
| C3 | `testfiles`: derive node-test and shell-test globs from `package.json` argv | `test:files`, ORPHAN fixture |
| C4 | move `selfcheck` to the full tier (stops tree mutation after every turn) | `verify`, `verify:prepush` |
| C5 | delete the `memo` row; drop the duplicated table from SKILL.md | `test:verify`, `verify` |
| C6 | widen the eslint money ban to every module owning a money column | `lint`, `verify` |
| C7 | property-based tests for `money.ts` against a `Decimal` oracle | `verify:full` (lockfile) |
| C8 | delete `ratchet:money`'s scanner, baseline, tests and orphan script | `verify`, `test:verify` |
| C9 | `migrations`: close the deleted/renamed hole; `.DS_Store`; scan root | `migrations:check`, `verify` |
| C10 | DBML ↔ entity/migration numeric conformance (+ the DBML fix) | `schema:check`, `verify` |
| C11 | document-immutability row, scope derived from `voided_at` | `documents`, `verify` |
| C12 | eslint: require a reason on every suppression; ban inline-config shapes | `lint`, `verify:full` |
| C13 | eslint: confine web storage to the six reviewed frontend modules | `lint -w frontend`, `verify` |
| C14 | delete `ratchet:lint-exempt` and `ratchet:persist` (+ config assertion) | `verify`, `test:verify` |
| C15 | `deadcode`: exemptions into `knip.json`, flat baseline, full tier | `knip`, `verify:full` |
| C16 | scan roots + `gitEnv()` everywhere + zero-input guards | two concurrent `verify` runs |
| C17 | return the pure suite to the fast tier (conditional, measured) | timed `verify` |
| C18 | registry prose to 40–80 words; class invariants replace the count pins | `test:verify`, `verify` |
| C19 | slim `run.mjs`; derive the hash surface from a registry `inputs` field | `verify`, `verify:full` |
| C20 | rewrite CLAUDE.md's Verification section and the verify skill | `verify:full` |

**Green at every boundary**, provided four things land inside their own commit: C10 carries the
DBML fix, C12 carries the nine ` -- ` description edits, C6 lands before C8, and every row
deletion carries its `registry.test.mjs` edit.

Between C4 and C17 `npm run verify` does not run the layer's own tests, so every commit in C5–C16
is additionally verified with an explicit `npm run test:verify`.

---

## What actually shipped (completed 2026-09-19)

23 commits on `refactor/verify-layer-simplification`. Measured at the end:

| | baseline | now |
| --- | ---: | ---: |
| fast tier | 61.7 s, 13 rows | **9.4 s, 10 rows** |
| layer (`scripts/verify` + `.claude/hooks`) | 14,487 | **10,259** |
| layer ÷ app (non-test) | 34 % | **25 %** |
| `test:verify` | 34.1 s serial | **7.3 s** parallel |
| line-keyed baselines | 4 | **0** |
| registry prose | 13,314 words | 2,255 |

### The five remaining items, and what happened to each

**`audit` — resolved upstream instead.** The brief's replacement was impossible and
NestJS 12 turned out to be unnecessary. All six advisories cascaded from one exact pin,
`@nestjs/platform-express` → `multer@2.2.0`; a one-line root `overrides.multer` clears
them. The baseline's recorded claim that this "does NOT take" came from a real
observation — `npm install` leaves the tree at 2.2.0 and exits 0 — but npm *accepts* the
override and declines to re-resolve an already-satisfied nested dep. `npm update multer`
does. `audit.mjs`+test+baseline went 896 → 343 lines, keyed on GHSA id rather than package
name, with a mandatory `until` date, and the acceptance list ships empty.

**Scan roots — done, and one more was hiding.** `test-glob-parity` and `bundle-size` were
converted; `dead-exports` was missed by the earlier sweep because it lives in `ratchets/`,
not `checks/`, and its suite was deleting a tracked source file. All three now run against
`mkdtemp` roots, `--test-concurrency=1` is gone, and two concurrent `npm run verify` runs
leave the tree byte-identical.

**`selfcheck` — measured, and deliberately NOT returned to the fast tier.** It is now 9.4 s
rather than 42 s, but the fast tier is also 9.4 s, so moving it back would double what runs
after every turn. Not split either: there is no mechanical rule for which half a new test
file belongs in, so a split is a judgement call on every test added. Its registry comment
previously justified the full tier by tree-mutation, which had stopped being true — that
was corrected, because a stale justification for a correct decision is how it gets reversed
for the wrong reason.

**`deadcode` — as planned, 1,511 → 143 lines, 186 → 136 findings.** The `entry`-vs-`ignore`
claim was measured rather than asserted: 136 findings against 139, the three extra being
`db-harness.ts` exports that `ignore` makes look unused. The hand-written kind map was also
hiding a whole finding class — `duplicates` items are arrays, so every duplicate export in
the repo read as nameless and was skipped.

**`run.mjs` — the `inputs` refactor was NOT done, and should not be.** Its purpose was to
tie the hash surface to the rows mechanically. But `secrets` rule 3 scans *every tracked
file*, so the honest declaration is "everything", which no per-row list expresses. The
surface is now `git ls-files` directly, which deleted the whole apparatus (hash.mjs 194 →
155) and fixed a live false green: a secret written into `docs/` moved no digest, so
`--reuse-if-fresh` replayed a green without running the check that scans it. 920 of 977
tracked files were covered.

`run.mjs` itself was not slimmed to ~650 lines. What was cut is what had gone wrong:
`--timeout-ms` (no caller ever passed it) and a prose copy of `registry.test.mjs`'s COLD_MS
table that was still quoting five deleted rows. The rest is the five-status machinery, the
report contract and the reuse path — the code every other row's correctness rests on. Line
count is not a reason to touch it.

### Also fixed, not in the brief

- **`seam` deleted entirely.** Rule 2 (seed isolation) moved to eslint
  `no-restricted-imports`, verified spelling by spelling. Rule 1 (the `'local'` literal) was
  deleted outright — it needed four exemption categories, guarded design intent rather than
  a defect, and never caught anything. It could not move to eslint: that needs
  `no-restricted-syntax`, and a second block over files overlapping the money ban would
  have replaced that rule's options and silently disabled the money guard.
- **`bundle` gained the warning it was missing.** Headroom had drifted to 10.0 KiB gzip
  against the 25 KiB minimum the budget was designed with — green, and one ordinary commit
  from red, with nothing saying so.
- **`origin/main` and the merge-base are in the digest.** `migrations` compares against
  both; `git fetch` moved them without touching a tracked byte.

### Known, recorded, not fixed

`test:ci-scripts` is 4.0 s of a 9.4 s fast tier — the largest single row. It was left in
place: the brief classified it neither KEEP nor CUT, and demoting it trades per-turn speed
for coverage of the CI scripts, which is a judgement the numbers alone do not settle.
