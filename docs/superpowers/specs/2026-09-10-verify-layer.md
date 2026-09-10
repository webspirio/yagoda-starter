# The verify layer — Design Spec

**Date:** 2026-09-10
**Issue:** [#51 «Migrate the verify scripts»](https://github.com/webspirio/yagoda-starter/issues/51)
**Source:** `webspirio/yagoda-crm` — `.github/workflows/verify.yml`, `scripts/verify/**`, `.claude/hooks/**`, `CLAUDE.md`. Cloned and read in full on 2026-09-10 (4 270 lines of scripts, ~750 of hooks, 279 of memo).
**Mode:** the owner chose the **maximally full port** of all 16 reference rows, then «далі автономно через субагентів у worktree». Every decision below is stated as a decision, with its reason, so it can be reversed by name.
**Branch:** `feat/verify-layer` off `origin/main`, its own PR. Independent of #62 (transfers) and #63 (Coolify).

## 0. The governing idea

A green check is a claim about the code. The reference repo's whole layer exists to stop
three specific ways that claim goes false:

1. **A skip reading like a pass.** A check whose precondition was missing did not test the
   code; reporting it inside "all green" asserts something nobody verified.
2. **A memo drifting from the mechanism.** A table in `CLAUDE.md` saying what a check proves
   becomes a lie the moment the check changes and the table does not.
3. **Going green by widening the exception.** Adding a baseline entry, relaxing a rule or
   lowering a floor is the cheapest available response to a red check, and it is not
   turning green.

The layer answers each mechanically: **five statuses that never collapse into each other**,
a **generated** proves/blind-spot table compared byte-for-byte, and **baselines that only
shrink**. Everything below serves those three properties. A row that does not serve them is
decoration and should not be written.

## 1. Goal and non-goals

**Goal.** This repository gets the same three-layer discipline: an advisory layer during
editing, a blocking gate at the end of a turn, and CI running *the same command* the laptop
runs. One registry, one report, one blind-spot document.

**Non-goals.**

- Not a rewrite of any existing check. `npm run lint`, `npm test`, `npm run build`,
  `npm run test:db -w backend` keep working standalone and keep their current meaning.
- Not a coverage-raising exercise. Floors are **measured** during implementation and set at
  the measurement, floored to whole percents. A floor is never guessed.
- Not new product behaviour. No `backend/src` or `frontend/src` runtime code changes, with
  one exception named in §8.

## 2. Engine — `scripts/verify/`

`run.mjs`, `registry.mjs`, `hash.mjs` port near-verbatim. What they give us, and what must
survive the port intact:

| property | mechanism |
|---|---|
| five statuses | `PASSED` / `FAILED` / `SKIPPED` / `NOT_RUN` / `UNRUNNABLE`, distinct glyph **and** word so the table survives colour-stripping |
| `UNRUNNABLE` ≠ `FAILED` | exit 126/127, `sh: … not found`, `npm ERR! Missing script`, `ERR_MODULE_NOT_FOUND` — "the command could not start" is never reported as "the code is wrong" |
| a timeout kills the whole tree | `detached: true` + `process.kill(-pid)`; killing only the shell is what records "timed out after 120s" at 902s |
| reuse is content-addressed | `sourceHash` over git-tracked **and** untracked-not-ignored files; never mtime, never "is the tree dirty" (a turn that commits its work would earn a free green) |
| a narrow green cannot be quoted as a wide one | `scope.only`, `scope.afterDepsFullyEvaluated`, `tier` and `envKey` all travel in the report and all gate reuse |
| the footer prints on green | "What this does NOT prove" is the point; a table of passes without it is the artifact this layer removes |

**Two deliberate deviations from the reference.**

- **`needs` becomes `PreconditionId[]`.** This repo has rows with two preconditions
  (`test:db` — Postgres *and* Redis; `smoke` — a browser *and* Docker). The reference's
  single-id field cannot express that, and collapsing two preconditions into one probe
  would report "browser missing" when Docker was the thing that was absent.
- **`hash.mjs` is monorepo-shaped and deliberately over-inclusive.** Prefixes `backend/`,
  `frontend/`, `nginx/`, `scripts/`, `.claude/`, `.github/workflows/`; exact root files
  `package.json`, `package-lock.json`, `turbo.json`, `docker-compose.yml`,
  `docker-compose.prod.yml`, `.dockerignore`, `.nvmrc`, `.gitignore`, `CLAUDE.md`. Over-
  inclusion costs a cache miss; under-inclusion costs a false green. `CLAUDE.md` is in the
  list because it is the entire input to the `memo` check — the reference learned this by
  review, and a hand-edited table that did not change the hash meant the one check whose
  job is catching that drift could never run.

**Report:** `.verify/last-run.json`, written write-then-rename. `.verify/` is gitignored.

## 3. The registry — 19 rows

Tier `fast` is what the Stop gate runs. Tier `full` adds everything that needs a build, a
browser, a database or a registry.

### 3.1 fast (12)

| id | cmd | after | ground in this repo |
|---|---|---|---|
| `lint` | `npm run lint` | — | eslint in both workspaces. **`--max-warnings=0` is added**: today a warning exits 0, so the reference's claim ("warn and error are one") is not currently true here |
| `typecheck` | `npm run typecheck` | — | new root script — backend `tsc -p backend/tsconfig.json --noEmit`, frontend `tsc -b`, **plus `tsconfig.scripts.json` over `scripts/verify/**` and `.claude/hooks/**`** so the verify layer typechecks itself |
| `test` | `npm test` | — | turbo → jest (40 suites, 511 tests) + vitest (99 files, 592 tests) |
| `testfiles` | `npm run test:files` | — | **three** runners here, not two — see §4.1 |
| `memo` | `node scripts/verify/checks/memo-drift.mjs` | — | generated table in root `CLAUDE.md`, byte-compared |
| `ratchet:money` | `npm run ratchet:money` | `typecheck` | see §4.2 |
| `ratchet:persist` | `npm run ratchet:persist` | `typecheck` | see §4.3 |
| `ratchet:lint-exempt` | `npm run lint:exempt` | — | see §4.4 |
| `deadcode` | `npm run deadcode` | `typecheck` | knip, monorepo mode; suppression keys banned |
| `secrets` | `npm run secrets` | — | see §4.5 |
| `seam` | `npm run seam` | — | see §4.6 |
| `migrations` | `npm run migrations:check` | `typecheck` | see §4.7 |

### 3.2 full (7)

| id | cmd | needs | after |
|---|---|---|---|
| `audit` | `npm run audit:check` | `npm-registry` | — |
| `build` | `npm run build` | — | — |
| `bundle` | `npm run bundle` | — | `build` |
| `coverage` | `npm run coverage` | — | — |
| `test:db` | `npm run test:db -w backend` | `postgres`, `redis` | — |
| `docker` | `npm run docker:build` | `docker` | — |
| `smoke` | `npm run test:e2e` | `playwright-browser`, `docker` | `build` |

### 3.3 Preconditions

| id | probe | why it is a precondition, not a failure |
|---|---|---|
| `npm-registry` | `HEAD https://registry.npmjs.org/`, 4s abort | an unreachable registry is not "no vulnerabilities" |
| `playwright-browser` | `chromium.executablePath()` exists | no browser is not "the UI is fine" |
| `docker` | `docker info` exits 0 | no daemon is not "the images build" |
| `postgres` | TCP connect `DB_HOST:DB_PORT`, 2s | no database is not "the schema is right" |
| `redis` | TCP connect `REDIS_HOST:REDIS_PORT`, 2s | ditto |

A precondition answers exactly one question — *are there conditions to run in at all?* It
must never answer *did it work*. Browser absent is `SKIPPED`; browser present and the spec
red is `FAILED`. Under `--no-skip` (the CI form) every `SKIPPED` is a failure, so an absent
precondition in CI is a red run, not a quietly narrower one.

## 4. The seven checks written from scratch

Each states what it proves. **If no possible failure of the command could make the sentence
untrue, the row is decoration and must be deleted rather than shipped.**

### 4.1 `testfiles` — three runners, not two

Ground, verified 2026-09-10: `backend/package.json` jest uses `testRegex: '.*\\.spec\\.ts$'`;
`backend/jest.db.config.js` uses `'.*\\.db-spec\\.ts$'`; the frontend's vitest takes the
default `**/*.{test,spec}.?(c|m)[jt]s?(x)`. The two backend regexes do not overlap — `.spec.ts`
does not match `db-spec.ts` — and today that fact is held by **a comment in
`jest.db.config.js`, nothing else**.

Proves: every `*.{test,spec,db-spec}.*` file in the repository is collected by **exactly one**
runner — not zero, not two.

The gap this closes is real and reachable today: `backend/src/foo.test.ts` is collected by
**nothing**. It would sit green forever.

### 4.2 `ratchet:money` — beyond the four modules

Ground: `backend/eslint.config.mjs` bans `*`, `/`, `Number()`, `toFixed`, `parseInt`,
`parseFloat` — but **only** under `src/intakes/`, `src/payouts/`, `src/shifts/`,
`src/supplier-balance/`, and with `*.spec.ts` / `*.db-spec.ts` excluded. That scoping is
deliberate and correct (the config says so: a repo-wide ban would train people to write
disable comments).

Proves, in a form that is actually decidable from the AST: every `*` or `/` binary
expression, and every `Number()`, `toFixed`, `parseInt`, `parseFloat` occurrence, in
`backend/src/**` outside the four eslint-scoped modules and outside `*.spec.ts` /
`*.db-spec.ts`, is either

- **provably non-monetary** — every operand is a numeric literal, or an identifier whose
  declaration in the same file gives it a `number` type or a numeric-literal initialiser; or
- **listed individually** in `baselines/money-rounding.json` with an exact occurrence count,
  so a partial fix does not count as a fix.

Import bindings for `common/money.ts` are resolved by import, so neither an alias nor a
namespace import nor a locally-declared imposter `round2` passes.

Blind spot to write honestly: nothing about whether the arithmetic is *right* — `add(a, b)`
is checked for rounding, not for meaning. Type information comes from the single file being
parsed, not from the type checker, so a monetary string arriving through a parameter typed
elsewhere reads as unknown and lands in the baseline rather than being caught. And a value
computed into an intermediate variable and only later formatted is invisible to it.

### 4.3 `ratchet:persist` — the four localStorage boundaries

Ground, read 2026-09-10: this repo has **four** independent boundaries, none of them zustand
`persist` — the bearer token (`entities/user/model/store.ts`), the TanStack query cache
(`shared/api/persister.ts`), form drafts (`shared/lib/form-draft/draftStorage.ts`), the
language preference (`shared/lib/i18n/language-preference.ts`). Every one already wraps its
access in try/catch, and `persister.ts` already carries a **default-deny allowlist**
(`isPersistableKey` — only `'me'`).

Proves three things, all of which are true today and all of which a careless edit breaks:

1. Every `localStorage` / `sessionStorage` access under `frontend/src` is inside a
   `try`/`catch` — the accessor itself throws in a private window, and this module graph is
   imported at bootstrap, so an unguarded throw is a blank page.
2. Every value read back out of storage is runtime-narrowed (`typeof`, `Array.isArray`,
   `in`, `instanceof`, a zod `.parse`, or a local type predicate) before it reaches app
   state.
3. `isPersistableKey`'s allowlist equals `baselines/persist-boundary.json`, in both
   directions — adding a persisted query key is a visible diff in a reviewed file, which is
   the whole point of a default-deny list.

Blind spot: it does not check depth (`Array.isArray(x)` counts, and says nothing about the
fields inside), and a predicate imported from another file cannot be confirmed from the AST
and does **not** count.

### 4.4 `ratchet:lint-exempt`

Ground: 9 `eslint-disable*` comments in `backend/src` + `frontend/src`, plus the `ignores`
and rule-off blocks in the two flat configs.

Proves: the set of lint exemptions equals `baselines/lint-exempt.json` in both directions —
a new disable comment fails, and one that is no longer needed fails too, so the entry gets
removed. Each entry carries a dated reason; the checker rejects stubs (`TODO`, empty,
shorter than 30 characters).

### 4.5 `secrets` — the reference's `pii`, re-aimed

The reference guarded a public repo against real supplier names in `docs/` and `input/`.
That subject does not exist here; the equivalent boundary that **does** is the secret one.

Proves: `.env` and `.env.*` are ignored and untracked; `.env.example` is tracked and
contains no value that looks like a real secret (a JWT, a private key block, a long
high-entropy string); no tracked file matches those patterns; and the `.gitignore` lines
holding that boundary are fingerprinted in the baseline, so relaxing them is a visible diff.

This is not theoretical: `JWT_SECRET` and `DB_PASSWORD` live in an untracked root `.env`,
and CI supplies throwaway values inline.

### 4.6 `seam` — the identity seam

Ground: `CLAUDE.md` states `user_identities(provider, provider_user_id)` is the single login
lookup path, and that adding an OAuth provider means writing a different value with **no
schema change**. `LOCAL_PROVIDER = 'local'` is exported from `users/user-identity.entity.ts`;
the literal `'local'` also appears in two migrations and in `seed/dev-seed.ts`.

Proves: outside migrations (frozen by definition) and the seed, the `'local'` provider value
is written through `LOCAL_PROVIDER` and never as a bare literal — so a second login path
cannot appear without touching the one file that names the seam. Plus: nothing under
`backend/src/seed/` is imported by application code; the only importers are its own CLI and
its own specs.

### 4.7 `migrations`

Proves: `synchronize: false` in every DataSource; migration filenames are strictly
ascending by timestamp with no duplicates; the class name in each file matches its filename;
and every migration that is an ancestor of `origin/main` is byte-identical to its committed
form — an already-merged migration has run on a real database and editing it is how staging
and production silently diverge.

## 5. Hooks — `.claude/`

`.claude/settings.json` does not exist yet; it is created (and is **not** gitignored — only
`.claude/projects/` and `.claude/settings.local.json` are).

| file | layer | blocking |
|---|---|---|
| `node.sh` | interpreter resolution | — |
| `edit-lint.mjs` | `PostToolUse` — lint the one edited file | no, advisory |
| `batch-typecheck.mjs` | `PostToolUse` — typecheck the touched projects | no, advisory |
| `stop-gate.mjs` | `Stop` — the fast tier | **yes** |

`node.sh` ports as-is: it reads the major from `.nvmrc` (`24`), uses **only shell built-ins**
(a hostile PATH is exactly when `dirname`/`sed`/`ls` go missing), and exports
`PATH=$NODE_BIN_DIR:$ROOT/node_modules/.bin:$PATH`. Without that export every check reports
`UNRUNNABLE` — a *false red*, worse than no gate.

`edit-lint.mjs` and `batch-typecheck.mjs` change in one way: they must resolve **which
workspace** an edited path belongs to and run that workspace's eslint / tsconfig. The
reference had one config for one project.

`stop-gate.mjs` ports near-verbatim, including the parts that were learned the hard way:

- fails **closed** on red checks, **open and loudly** on its own errors — never a bare
  `|| exit 0`, because a silent failure is indistinguishable from a green tree;
- caps consecutive blocks at 2 per `prompt_id`, then releases while instructing the agent to
  state the red result out loud;
- **never** falls back to `session_id` for the counter — it is stable across turns while
  `reset()` only runs on green, so a persistently red tree saturates the count in turn 1 and
  every later turn sails through;
- emits `decision: block` in both documented shapes **and** exits 2 with the reason on
  stderr; emits **no** `continue: false`, which would mean "halt the session" rather than
  "go back and fix it";
- a slow stdin is distinguished from an empty one by a sentinel — collapsing them drops
  `prompt_id` and turns a block into a non-block.

**Cost, measured 2026-09-10 on this machine (main checkout, turbo cache forced off):**
`npm run lint` 5.2s, `npm test` 24.8s (frontend vitest 24.1s of it — jsdom is created 99
times). The fast tier will land near 40s cold and ~0s warm via `--reuse-if-fresh`. That
estimate is an estimate until a real fast-tier run is timed; §10 says what happens if it
hurts.

## 6. The contract in `CLAUDE.md`

A new **"Verification"** section in the root memo:

1. The three commands (`verify`, `verify:full`, `verify:ci`) and what the gate does *not*
   cover — it is the fast tier only, so a turn can end green having never built the app.
2. The five-status table, including why `UNRUNNABLE` earns its own row.
3. The generated region between `<!-- BEGIN:verify-table -->` and `<!-- END:verify-table -->`,
   plus a `registry-checksum` over the raw strings — because `cell()` collapses whitespace,
   two different registry strings could render to one identical cell and "byte-for-byte"
   would hold of the table while the registry had changed underneath it.
4. **Three rules:** evidence under every claim (a table of what changed → what must be run);
   skips spoken aloud, never rounded up to "all green"; ratchets turn one way — widening a
   baseline, relaxing a rule or lowering a floor **is not turning green**.

Written in English, matching every other document in this repository.

## 7. CI — `ci.yml` rebuilt on the registry

One job, `verify`, running **`npm run verify:ci`** — the same runner and the same registry a
laptop runs. There is deliberately no CI-only script: the moment CI has its own command,
"green there / green here" drift apart and neither means anything.

**Services come from Compose, not from `services:`.** `docker compose up -d postgres redis`
gives CI the same ports and the same path a developer already has, and makes the `postgres`
and `redis` preconditions true locally for anyone who has the stack up. Coverage floors stay
in the workflow's `env:` — the file that enforces them and nowhere else — so a 1% wobble on a
laptop cannot teach anyone to route around the gate. `.verify/last-run.json` uploads as an
artifact with `if: always()`.

**Three consequences, named because they are not free:**

1. **The required status check must be renamed** in repository settings: `checks` /
   `db-checks` / `docker` → `verify`. This is a setting, not code; no check here can enforce
   it. Until it is done, PRs are guarded by a context name that no longer exists.
2. **The `changes` path-filter job is deleted**, so images build on every PR (~30–60s warm
   with `type=gha`). In exchange an entire fail-closed construction — and the possibility of
   a skipped required check hiding a broken detector — goes away.
3. **`test:db` must drop and recreate its database.** Making it a *local* row multiplies a
   trap we have already been bitten by: leftover rows in `app_test` make the seed spec pass
   locally and fail in CI. The row creates a fresh database per run.

## 8. Dependencies, scripts, and the one runtime change

**Three new devDependencies:** `knip` (`deadcode`), `@playwright/test` (`smoke`),
`@vitest/coverage-v8` (`coverage`, frontend side).

**New root scripts:** `typecheck`, `verify`, `verify:full`, `verify:ci`, `test:files`,
`deadcode`, `ratchet:money`, `ratchet:persist`, `lint:exempt`, `secrets`, `seam`,
`migrations:check`, `audit:check`, `bundle`, `coverage`, `test:e2e`, `docker:build`. Every
one is runnable standalone: **nothing exists only inside the orchestrator, and nothing only
inside CI.**

**New config:** `tsconfig.scripts.json`, `knip.json`, `playwright.config.ts`,
`scripts/verify/baselines/*.json`.

**The one change to shipped code:** `--max-warnings=0` on both workspaces' `lint` scripts.
Today an eslint *warning* exits 0, so `lint` cannot honestly claim what the reference's row
claims. If this turns the tree red, the findings are **fixed**, not baselined — §6 rule 3.

**`smoke` runs against the real stack** (the owner's choice over a network-stubbed
alternative): Playwright's `globalSetup` brings up Compose, runs `npm run db:seed`, and the
specs sign in with a real `POST /auth/login` against the built frontend. `globalTeardown`
tears it down. The Compose lifecycle lives in the Playwright config, not in the npm script,
so a bare `npx playwright test` behaves identically.

## 9. How this is verified

The layer must not be trusted on its own say-so, so each piece is proven by making it fail:

- **Engine:** unit specs for `classify()` (each of the five statuses reachable — the
  reference had a bug where painting blocking rows red made `NOT_RUN` and `UNRUNNABLE`
  unreachable in the table), `parseArgs` (an unknown flag is fatal; `--no-skip=false` is
  fatal, not a silently disabled gate), `reportIsFresh` (each reuse-refusing condition
  refuses), `sourceHash` (a changed file changes the hash; a deleted tracked file is
  `ABSENT`, not an invisibly shorter list).
- **Every new check:** a fixture that violates the invariant must make it exit non-zero.
  A check that has never been seen red has not been shown to check anything.
- **Ratchets:** proven in *both* directions — a new finding fails, and a disappeared finding
  fails too.
- **`memo`:** editing the generated block by hand must fail.
- **`stop-gate`:** driven with synthetic stdin — green passes, red blocks with exit 2, the
  third consecutive block releases, an unwritable counter does not block.

## 10. Risks, stated as reversible decisions

- **The gate costs ~40s cold.** The reference's costs 6s. Cold means "the first turn after
  any edit"; warm is ~0s. **If the measured cost hurts in practice, `test` moves to `full`**
  and the fast tier keeps `lint`, `typecheck` and the ratchets. That is a decision to take on
  numbers from a real run, not in advance. (The frontend's own output names the cause and the
  fix — 99 jsdom environments, `pool: 'vmThreads'` — but changing the test runner's isolation
  model is not this PR's business.)
- **19 rows is a lot to keep honest.** The mitigation is §4's rule: a `proves` sentence that
  no failure of its command could falsify must be deleted. Expect rows to be cut during
  implementation rather than shipped hollow, and expect that to be reported.
- **`smoke` is the most expensive and most fragile row** — two preconditions, Compose, a
  seed and a browser. It is `full`-tier only and skips honestly without them.
- **Baselines start at today's reality, which may be non-zero.** A baseline that records
  existing debt is legitimate; a baseline that grows later is the failure mode. Each entry is
  dated with a reason at creation.

## 11. Out of scope

- Enabling branch protection / renaming the required check (a repository setting — §7.1).
- Mutation testing (`@stryker-mutator/*` in the reference). No ground for it here yet.
- Changing vitest's isolation model to cut the 24s (§10).
- Component-level coverage floors for `.tsx`. Coverage is **reported**, and floors are set
  only where a measurement supports one — pretending otherwise is what this layer removes.
