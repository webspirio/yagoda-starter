# Brief: cut the verify layer to the checks that earn their keep

**Status:** ready to execute. **Date:** 2026-09-18. **Target:** `scripts/verify/`, `.claude/hooks/`, `scripts/verify/baselines/`, the `verify` skill, `CLAUDE.md`'s Verification section.

You are simplifying an existing, working verification layer. It is green right now
(`npm run verify` → 13/13). **This is not a rescue; it is a deliberate reduction.** Your job
is to end with a much smaller layer that a one-to-two-person team working through Claude
Code can trust on every turn, and to delete the parts that cost more than they return.

Read this whole brief before touching anything. Then read
`.claude/skills/verify/SKILL.md` and `scripts/verify/registry.mjs`.

---

## Why this is being cut (measured, not asserted)

| Measure | Value |
| --- | --- |
| Layer total | **14,487 lines** — 7,241 impl · 3,459 its own tests · 2,062 baseline JSON · 1,485 `.claude/hooks/` · 240 SKILL.md |
| Application production code | ~43,080 lines (`backend/src` + `frontend/src`, non-test) |
| **Layer ÷ app** | **34%** |
| `selfcheck` share of every fast run | **44.6–45.1s of 58–67s = 76%** |
| `lint` + `typecheck` + `test` (warm) | **1.6s = 2.7%** |
| Registry prose | **13,195 words** over 19 rows, mean 695/row; `deadcode` alone 1,536 |
| Baseline churn | **19 commits in 8 days**; **27 line-move re-keys in 4 days**, none of which found a defect |
| App defects found by a bespoke check, in the whole record | **one**, worth ~10 minutes |
| Layer's own tests ÷ `money.spec.ts` | **3,459 ÷ 125 = 28×** |

The layer is currently a net *source* of red rather than a detector of it. Two independent
reviews and one logic audit converged on the same verdict: **the idea is right and roughly a
tenth of the code is excellent.**

---

## Non-negotiables — do not break these

1. **`npm run verify` must be green when you finish**, and green for the right reason. Never
   reach green by widening a baseline, relaxing a rule, lowering a floor, or deleting a test
   that was catching something real. If you cut a check, the thing it caught must either be
   covered elsewhere or be explicitly, visibly given up in writing.
2. **Every deletion is recorded.** For each check you remove, write one line saying what it
   proved, what now covers that, and what coverage is genuinely lost. A silent deletion is
   worse than the check.
3. **Do not touch `backend/src` or `frontend/src` behaviour.** This is a tooling change. The
   only application-code edits allowed are the three additions in §4, plus deleting code a
   removed check was the only consumer of.
4. **Do not regress the five statuses.** `SKIPPED ≠ PASSED`, `UNRUNNABLE ≠ FAILED`,
   `NOT_RUN` for an unmet dependency, and `--no-skip` in CI. This is the layer's best
   property and it is cheap.
5. **Keep blind spots printing on green runs.** The "What this does NOT prove" footer stays.
   Shorten the text; never remove the mechanism.

---

## 1. Fix the live defects FIRST, before any deletion

These are confirmed by fixture. Do them in this order, each as its own commit.

### 1.1 The hash surface — a real false green in the gate's own path (Critical)

`scripts/verify/hash.mjs:34-44`'s `HASHED_EXACT` omits files that checks actually read.
Reproduced end to end:

```
$ printf 'DEPLOY_TOKEN=%s\n' "<40 random base64url chars>" >> .env.example
$ node scripts/verify/hash.mjs          # sourceHash UNCHANGED
$ npm run secrets                       # RED
$ node scripts/verify/run.mjs --tier fast --reuse-if-fresh
  reused green report for 1f51abc91340   # exit 0
```

That last command is verbatim `.claude/hooks/stop-gate.mjs:283`. **A turn that commits a
real credential to a tracked file ends green.**

- Add `.env.example` and `knip.json` to `HASHED_EXACT`; add `e2e/` to `HASHED_PREFIXES`; add
  a `/^(playwright|vitest)\.config\.[cm]?[jt]s$/` pattern.
- **Add the inverted test.** `hash.test.mjs:90` only asserts that a file *outside* the
  surface does not change the hash. Add its dual: enumerate every file the surviving checks
  declare as an input and assert each one **is** inside the surface. The missing direction
  is why this survived.

### 1.2 The Stop-gate report contract is asserted by neither side (Critical)

`run.mjs:725` writes `checks: rows`. `stop-gate.mjs:197,198,224,336` read `report.checks`.
`stop-gate.test.mjs:75-83` fabricates that shape; `run.test.mjs` never produces a report.
Rename the key and **all 166 tests pass while the gate fails open forever.**

Export a `REPORT_SCHEMA` key list from `run.mjs`, build `stop-gate.test.mjs`'s fixture from
it, and add one integration test that runs `run.mjs --only <cheap row> --json` and asserts
the real key names.

### 1.3 `testfiles` reports a dead suite as collected (Critical)

`checks/test-glob-parity.mjs:158-160` models node-test as `scripts/**/*.test.mjs`; the
runner (`package.json` `test:verify`) is `scripts/verify/**`. A `.test.mjs` under
`scripts/ci/` reads "collected by exactly one runner" and never runs. Same bug at
`:172`: the shell collector recurses, the runner's `scripts/ci/*.test.sh` does not.

**Derive both globs from `package.json`'s script argv at runtime** — the check already reads
the two jest regexes out of their configs for exactly this reason. A hard-coded copy is a
second source of truth. Then fix the `testfiles` `proves` string, which states the wrong
glob outright.

### 1.4 A false sentence I must call out, because it is load-bearing

`registry.mjs`'s `lint` blindSpot currently says money arithmetic outside the eight eslint
trees "is now checked by NOTHING in this layer." **This is false.**
`ratchets/money-rounding.test.mjs:75` still runs the ratchet over all of `backend/src` inside
fast-tier `selfcheck`. Demonstrated: a bad `*` in `backend/src/media/` → eslint green,
`npm run verify` → `selfcheck FAILED`.

Resolve it by decision, not by prose: see §3.1.

---

## 2. KEEP — these earn their keep

Target: the surviving layer is **under ~1,500 lines** of implementation.

| Keep | Why |
| --- | --- |
`migrations` rules 1–4 | **Highest value per line in the repo.** Rule 4's byte-diff of every already-merged migration against `origin/main` stands between a hand-edited migration and a production DB that silently diverges from git, on a stack where migrations auto-run at startup against one VPS. **Also fix:** it cannot see a *deleted* merged migration (`rm` one and it reports "intact"). Enumerate `git ls-tree -r --name-only origin/main -- backend/src/migrations/` and fail on any entry now missing. |
`testfiles` | Six collectors, exactly one each. Catches a test file nothing runs — which would otherwise sit green forever. Fix the globs per §1.3. |
The runner's five statuses + `--no-skip` | Slim `run.mjs` from 951 lines toward ~250. Keep tier filtering, `after`, `needs`, the statuses, the report, and the green-run blind-spot footer. Drop what the reduced row set no longer uses. |
`--reuse-if-fresh` | Content-addressed replay is what makes a per-turn gate affordable. Keep it — with §1.1 fixed. |
`secrets` rules 1, 2, 4 | `.env` untracked, gitignore fingerprint, `.env.example` placeholder-only. ~40 lines, real boundary. |
`stop-gate.mjs` | Best-engineered file here — correct failure policy in all four branches, `MAX_BLOCKS=2`, byte-capped payloads, no `session_id` keying. Keep as-is once §1.2 and §3.3 land. |
`lint`, `typecheck`, `test`, `build` | The actual product checks. 1.6s warm for the first three. |
`test:db`, `coverage`, `smoke` | Full tier. These are where real risk lives. |
`bundle` | Keep the *design* (ceiling = measurement + minimum headroom, rounded to a step; two unconditional WARNING lines on passing runs). If you can get the same from `size-limit` in 20 lines of config, swap it. Note headroom is down to **10.0 KiB gzip** — flag it, do not silently re-base. |

---

## 3. CUT — with the coverage loss stated

### 3.1 Resolve `ratchet:money` completely (it is currently half-removed)

The row was deleted from the registry on 2026-09-18, but three tests in
`ratchets/money-rounding.test.mjs` (`:75`, `:101`, `:201`) assert `status === 0` over all of
`backend/src`, so the fast tier still enforces `baselines/money-rounding.json` — **through
`selfcheck`, where the registry, the memo table and the blind-spot footer cannot see it.** A
money regression in `backend/src/config/` reports as "a failing assertion in the verify
layer's own test suite", which points at the wrong subject.

**Decide one, and write it down:**
- (a) Delete those three tests and the 366-line baseline. The eslint `files` list becomes
  the only net; make *that* list the reviewed artifact. **Then §4.2 is mandatory**, because
  nothing would otherwise check that `money.ts` is correct.
- (b) Restore the row properly, re-keyed per §5.1.

Either way, correct the `lint` blindSpot (§1.4) and stop the row's absence from being
described as coverage that does not exist.

Also fix, in whichever net survives: **both money nets miss `*=`, `/=` and
`Number.parseInt`/`parseFloat`** — demonstrated inside `backend/src/intakes/`, the most
guarded tree in the repo. Add `AssignmentExpression[operator=/^[*/]=$/]` to the eslint
selector.

### 3.2 Replace the bespoke ratchets with off-the-shelf equivalents

| Cut | Replace with | Loss |
| --- | --- | --- |
`ratchet:lint-exempt` (371 + 71 lines) | `eslint-plugin-eslint-comments`' `require-description` + `--report-unused-disable-directives` | The line-keyed baseline goes, and so does its churn. **It was blind to `/* eslint rule: "off" */` anyway** — a fourth suppression shape, the most convenient one, recognised and disclosed nowhere. |
`ratchet:persist` (913 lines) | Two eslint rules: a `no-restricted-syntax` selector for unguarded storage access, plus ~80 lines of AST for the runtime-narrowing rule if you still want it | **It accepted `JSON.parse` as narrowing** — spec §4.3 said *zod* `.parse`, and `JSON.parse(raw) as Profile` validates nothing and passed green. Its file count was also wrong for the third time. |
`audit` (406 + 67 lines) | `npm audit --audit-level=high` + Dependabot (already enabled) + **one dated, owner-signed risk note for multer with a re-review date** | The six open entries restate one root cause across three prose fields each and carry no deadline. An accepted risk with no timer is the wrong default for money software. |
`memo` (the row) | Generate the table in a pre-commit hook; do not gate on it | **Lowest-value row in the layer.** It proves a table quotes the registry byte-for-byte — and was green over a `deadcode` blindSpot whose arithmetic contradicted the same row's `proves`. It guarantees two copies of a sentence agree while guaranteeing nothing about whether the sentence is true. |
`deadcode`'s 1,511-line bidirectional baseline | knip's own `ignore` for the framework-invoked classes (47 of 57 file findings are TypeORM migrations, `*.db-spec.ts` files knip's Jest glob cannot match, and `.claude/hooks/*.mjs`) | Keep the genuinely novel 3%: the knip-config **allow-list** checked against `node_modules/knip/schema.json`, the glob SHA fingerprint, and the `@public`/`@internal` JSDoc-tag scan. Those close real bypasses a bare `knip` run does not. Also fix `KINDS` (`dead-exports.mjs:88-101`): it maps 12 of knip's 18 issue types and silently skips the rest, which is deny-by-omission in a file whose whole argument is deny-by-allow-list. |

### 3.3 Cut `selfcheck` from the fast tier

**76% of every run, and the sole cause of every false red observed.** Its tests write into
the real working tree — `backend/src/migrations/*`, `backend/src/users/*`,
`scripts/verify/registry.mjs`, `.claude/skills/verify/SKILL.md`, four baselines — and
`secret-boundary.test.mjs:96,103` writes **the real git index**. Restores live in `finally`.
Nothing takes a lock.

Because the Stop hook runs the fast tier after **every turn**, two overlapping runs are the
normal case, not an edge case. Observed, all on an otherwise clean tree: a fixture from one
run failing another run's `migrations`; two `dead-exports` runs interleaving on one
baseline; three `migration-invariants` tests red twice running; and **an already-merged
migration left modified** by an interrupted `finally` — which is precisely the divergence
rule 4 exists to catch.

Do both:
1. **Give every check a scan-root argument** (`--root <dir>` or `VERIFY_SCAN_ROOT`) so its
   fixture tests run against a `mkdtempSync` directory and touch nothing tracked.
   `hash.test.mjs` already demonstrates the pattern with its `NO_GIT_ENV` scrub. This one
   change removes the tree mutation, the cross-run corruption, the need for
   `--test-concurrency=1`, and unlocks a 3–4× cut in the layer's largest cost.
2. Move `selfcheck` to the full tier / pre-push until (1) is done.

### 3.4 Cut ~60% of the registry prose

**Hard cap: 40–80 words per `proves` and per `blindSpot`.** Answer one question only: *does a
green run cover the change I just made?*

Delete every dated re-measurement note, incident history, self-correction narrative, and
**every hand-written count**. Those belong in commit messages, which is where they already
are, and where they cannot rot into a green check.

This is not cosmetic. Three counts were wrong on the day of the audit, one row contradicted
itself, and `memo` was green over all of them. `registry.test.mjs:139-187` pins seven counts
derived from `git ls-files` — a genuinely good mechanism that currently pins *the seven that
were wrong last time*, not the class. Fewer numbers in prose is the only version of this
that stays true.

---

## 4. ADD — the risks this layer was aimed away from

This is money software for a real business: berry intakes, payouts, supplier balances, cash
counts. The layer built a 502-line AST scanner to prove arithmetic *routes through*
`money.ts`, and `money.spec.ts` is **125 lines** of example tables proving the seam is
*right*. Fix that imbalance.

### 4.1 DBML ↔ entity/migration conformance (highest-value missing check)

`28-db-schema.dbml` is declared "the schema of record" in `CLAUDE.md` and **nothing compares
it to anything.** For each of the ~52 `numeric` columns, assert: precision/scale match the
DBML, the migration's SQL column type matches, and the TypeScript property type is `string`
and never `number`.

A `numeric` column mapped to a `number` property is the one silent money-corruption bug this
stack has: `typecheck` cannot see it (both are valid), `lint` does not look at entities, and
the money ratchet never looked at column declarations. ~60–80 lines, using the same
`ts.createSourceFile` walk `seam-boundary.mjs` already uses.

### 4.2 Property-based tests for `money.ts`

`fast-check` over `add`/`sub`/`mul`/`sum` against a `Decimal` oracle: associativity,
round-per-line-then-sum vs sum-then-round, half-up at exactly `.005`, the negative-zero
boundary, and §12.1's second rounding rule that `money.ts` deliberately does not implement.
~50 lines, and worth more than every ratchet combined. **Mandatory if you take §3.1(a).**

### 4.3 Document immutability

§2.7 freezes `amount`; §9.3 makes a correction a void-plus-new-document. Verified today:
`intakes`, `payouts`, `crates`, `transfers`, `cash-counts` and `intake-top-ups` have **zero**
`@Patch`/`@Put` (the 9 hits elsewhere are catalog/user endpoints, and `shifts`' one is a
legitimate open/close). So the invariant holds — guarded by prose alone. A ~20-line check
banning `@Patch`/`@Put` on the document controllers is worth more to this business than the
`'local'` string-literal rule the layer chose instead.

### 4.4 A fast-tier `test:db` subset (if Postgres is cheap enough to require)

All 30 `*.db-spec.ts` suites are full-tier only, behind a `postgres` precondition. That is
where §9.4's void-authorization matrix and every SQL money formula actually live, so the gate
that runs fifty times a day can see none of it. Even three suites — void authorization, shift
scoping, one intake total — would give the per-turn gate something to say about the domain.

---

## 5. Low-maintenance invariants — enforce these on what survives

These are the rules that keep this from growing back. Write them into
`.claude/skills/verify/SKILL.md`.

1. **No baseline keyed by line number.** This is the single largest maintenance cost: 27
   defect-free re-keys in four days. Worse, it is not merely noisy — it is *wrong*: two
   `app.module.ts` entries each moved down one line, so a stale key still **matched, against
   the wrong expression**, and the ratchet could not tell. It has happened three times. Key
   on a content hash of the expression plus its enclosing symbol path, or do not ratchet.
2. **No test may assert that the whole repository is green.** 31 of 166 tests did. Each one
   doubles as an invisible gate, makes one logic break report as seven failures, and — worst
   — a "stays green" assertion cannot distinguish *"my fixture was correctly not flagged"*
   from *"my fixture was never scanned"*. Both were demonstrated passing under a scanner that
   saw nothing. Keep at most one "real tree is green" test per check, and give every positive
   test a discriminator proving the check actually looked.
3. **No test may write to the real working tree or the git index.** See §3.3.
4. **No hand-written count in any prose string.** Derive it mechanically or omit it.
5. **A check's declared scope must be mechanically tied to its actual scope.** Four of five
   Criticals were a glob, regex or hash surface narrower than the sentence describing it. The
   layer has strong machinery for "is the finding set unchanged" and none for "does the scan
   surface still match its own description." Read globs from the config that owns them; never
   keep a second copy.
6. **A ratchet is justified only when its finding set is genuinely stable.** For a
   one-to-two-person team, a 188-entry bidirectional baseline is ceremony that will be
   bypassed — as it already was, one row at a time. Prefer fixing the finding, or the tool's
   native ignore, over a reasoned suppression.
7. **Budget: the fast tier stays under ~10s warm.** It runs on every agent turn. Above that
   people route around it, and a gate that is routed around is worse than no gate.

---

## 6. Definition of done

- [ ] `npm run verify` green, and **under ~10s warm**.
- [ ] `npm run verify:full` green; CI's `verify:ci` green on a PR.
- [ ] Running `npm run verify` twice concurrently leaves the tree clean and neither run red.
- [ ] `git status --porcelain` is clean after any verify run.
- [ ] The §1.1 fixture (append a high-entropy value to `.env.example`) makes
      `--reuse-if-fresh` **re-run and go red**, not replay green.
- [ ] The §1.3 fixture (a `.test.mjs` under `scripts/ci/`) is reported **ORPHAN**.
- [ ] Renaming the report's `checks` key makes a test fail.
- [ ] No `proves` or `blindSpot` exceeds 80 words; none contains a hand-written count.
- [ ] Every removed check has its one-line coverage-loss note in the commit message.
- [ ] Implementation under ~1,500 lines; layer-to-app ratio under ~5%.

## 7. Traps

- **Do not delete a test merely because it is red.** Three of the tests you are removing were
  gating real content (§3.1). Establish what each one actually caught before it goes.
- **Do not trust this brief's row-level judgements uniformly.** Only **10 of 19 rows** were
  falsified or confirmed by experiment. `typecheck`, `test`, `test:ci-scripts` and all six
  full-tier rows (`audit`, `build`, `coverage`, `bundle`, `test:db`, `smoke`) were read but
  not probed — no Docker, Postgres or Chromium in that pass. Probe before cutting any of
  those six.
- **Do not replace prose with silence.** The `proves`/`blindSpot` idea is the best thing here.
  The target is 40–80 honest words, not zero.
- **`CLAUDE.md` rule 1 is currently unsatisfiable** and should be fixed while you are here:
  it says "anything touching money → `npm run verify`, and name the coverage number", but
  `coverage` is a full-tier row, absent from `npm run verify`, and its floors read 0 locally.
- **`CLAUDE.md` says the eslint money ban covers "nine modules"**; the config lists **eleven**
  entries (eight globs + three individual `crates/` files). The registry says "eight". If
  eslint becomes the only money net, that list is load-bearing — get the number right and
  derive it rather than restating it.
