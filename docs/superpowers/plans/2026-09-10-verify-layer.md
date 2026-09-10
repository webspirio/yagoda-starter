# Verify Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this repository the verification layer from `yagoda-crm` — one registry of checks whose statuses never collapse into each other, a generated proves/blind-spot table that cannot drift from the mechanism, baselines that only shrink, a blocking Stop gate, and a CI job that runs the exact command a laptop runs.

**Architecture:** A root-level `scripts/verify/` holds a thin runner (`run.mjs`), the judgement (`registry.mjs`), and a content-addressed freshness hash (`hash.mjs`). Every check is an ordinary npm script that runs standalone; the runner only orchestrates and reports. Three `.claude/hooks/` layers sit on top: per-edit lint and typecheck (advisory), and a `Stop` gate (blocking, fast tier only). `ci.yml` collapses to a single `verify` job invoking `npm run verify:ci`.

**Tech Stack:** Node 24 (`.nvmrc`), plain `.mjs` with JSDoc types checked by `tsc`, npm workspaces + Turborepo, eslint 9 flat config, jest 30 (backend) + vitest (frontend), knip, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-10-verify-layer.md` — read it before Task 1. The plan argues from the spec; where they disagree, the spec wins and the plan is wrong.

**Reference implementation:** `webspirio/yagoda-crm` @ `468e184`, cloned on this machine at **`/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference`**. Read the corresponding file there before porting. If that path is gone, re-clone: `git clone https://github.com/webspirio/yagoda-crm.git && git checkout 468e184`.

## Global Constraints

- **Language: English.** Comments, JSDoc, registry `proves`/`blindSpot` strings, runner output, `CLAUDE.md`. The reference is Ukrainian — every ported string is translated, not copied.
- **Node:** `^24.15.0 || >=26.0.0` (root `engines`). `.nvmrc` is `24`.
- **No `.mjs` runs unchecked.** Everything under `scripts/verify/` and `.claude/hooks/` is covered by `tsconfig.scripts.json` with `checkJs`, and the `typecheck` row fails on an error there.
- **A `proves` sentence must be falsifiable by that exact command failing.** If no possible failure of `cmd` could make the sentence untrue, delete the row rather than ship it. Report any row cut this way.
- **A `blindSpot` must not be written broader than the command establishes.**
- **Never widen a baseline to go green.** If a new check finds real problems, fix them or report them — a baseline records today's debt at creation, dated, with a reason ≥30 characters. Stub reasons (`TODO`, empty) are rejected by the checkers themselves.
- **Every check runs standalone.** Nothing exists only inside the orchestrator; nothing only inside CI.
- **Do not touch `backend/src` or `frontend/src` runtime behaviour.** The only permitted product change is `--max-warnings=0` in the two `lint` scripts (Task 4), plus fixing whatever that surfaces.
- **`.verify/` is gitignored** and never committed.
- **Commit after every task.** Trailer on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

### Script names — fixed, use these exactly

A task that invents a different name breaks the registry row a later task writes.

| registry row | root npm script | file |
|---|---|---|
| `lint` | `lint` (exists) | — |
| `typecheck` | `typecheck` | — |
| `test` | `test` (exists) | — |
| `testfiles` | `test:files` | `scripts/verify/checks/test-glob-parity.mjs` |
| `memo` | `memo` | `scripts/verify/checks/memo-drift.mjs` |
| `secrets` | `secrets` | `scripts/verify/checks/secret-boundary.mjs` |
| `seam` | `seam` | `scripts/verify/checks/seam-boundary.mjs` |
| `migrations` | `migrations:check` | `scripts/verify/checks/migration-invariants.mjs` |
| `ratchet:lint-exempt` | `lint:exempt` | `scripts/verify/ratchets/lint-exempt.mjs` |
| `ratchet:money` | `ratchet:money` | `scripts/verify/ratchets/money-rounding.mjs` |
| `ratchet:persist` | `ratchet:persist` | `scripts/verify/ratchets/persist-boundary.mjs` |
| `deadcode` | `deadcode` | `scripts/verify/ratchets/dead-exports.mjs` |
| `audit` | `audit:check` | `scripts/verify/checks/audit.mjs` |
| `build` | `build` (exists) | — |
| `bundle` | `bundle` | `scripts/verify/checks/bundle-size.mjs` |
| `coverage` | `coverage` | — |
| `test:db` | `test:db -w backend` (exists) | — |
| `docker` | `docker:build` | — |
| `smoke` | `test:e2e` | `playwright.config.ts` |

The registry's `cmd` for `memo` is the direct `node scripts/verify/checks/memo-drift.mjs`, not `npm run memo` — the check must keep working if the script entry is ever lost, since it is the one row whose whole job is catching drift.

### The test harness shape — Tasks 6 through 17

**Task 6 Step 2 is the template.** Every check's test file is a `node --test` file using that exact `run()` helper (`execFileSync` on the check, catching a non-zero exit into `{ status, out }`), and every numbered case listed in Tasks 7–17 is **one `test(...)` case** in that shape. Where a case mutates a real repository file, it captures the original first and restores it in a `finally` — a check's test that leaves the tree dirty poisons every task after it.

Each case's number, its input and its expected outcome are given in the task. Write them as code in that harness; do not restate them as prose comments and do not merge two cases into one.

---

## Phase 1 — The engine

### Task 1: `hash.mjs` — content-addressed source identity

**Files:**
- Create: `scripts/verify/hash.mjs`
- Create: `scripts/verify/hash.test.mjs`
- Create: `tsconfig.scripts.json`
- Modify: `.gitignore` (add `.verify/`)
- Modify: `package.json` (root — add `test:verify` script)

**Interfaces:**
- Produces: `sourceHash(root: string): { hash: string, fileCount: number }` and `errMessage(err: unknown): string`, both named exports. Every later engine file imports from here.

- [ ] **Step 1: Read the reference**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/hash.mjs` in full (139 lines). Note specifically: `git ls-files -c -o --exclude-standard -z` (tracked **and** untracked-not-ignored — without `-o` a freshly written failing test would not change the hash and a stale green would be served over it), NUL as the only safe delimiter, `ABSENT` for a tracked-but-deleted file, and the `hash.mjs`-as-main diagnostic entry point with its EPIPE guard.

- [ ] **Step 2: Write the failing test**

Create `scripts/verify/hash.test.mjs`. This runs under `node --test`, not jest or vitest — those belong to the workspaces.

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sourceHash, errMessage } from './hash.mjs'

/** A throwaway git repo shaped like this one, so `git ls-files` has something to list. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-hash-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(path.join(root, 'backend', 'src'), { recursive: true })
  writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n')
  writeFileSync(path.join(root, '.gitignore'), 'ignored/\n')
  mkdirSync(path.join(root, 'ignored'), { recursive: true })
  writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 1\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: root,
  })
  return root
}

test('the same tree hashes the same twice', () => {
  const root = fixture()
  try {
    assert.equal(sourceHash(root).hash, sourceHash(root).hash)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a hashed file changes the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 2\n')
    assert.notEqual(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an UNCOMMITTED new file changes the hash — a stale green must not outlive a new test', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'backend', 'src', 'b.spec.ts'), 'it("x", () => {})\n')
    assert.notEqual(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a gitignored file does NOT change the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 2\n')
    assert.equal(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a file outside the hashed surface does NOT change the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'notes.md'), 'hello\n')
    assert.equal(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('deleting a tracked file changes the hash rather than shortening the list invisibly', () => {
  const root = fixture()
  try {
    const before = sourceHash(root)
    rmSync(path.join(root, 'backend', 'src', 'a.ts'))
    const after = sourceHash(root)
    assert.notEqual(after.hash, before.hash)
    assert.equal(after.fileCount, before.fileCount, 'the file is ABSENT, not absent from the list')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('errMessage survives a non-Error throw', () => {
  assert.equal(errMessage(new Error('boom')), 'boom')
  assert.equal(errMessage('boom'), 'boom')
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/verify/hash.test.mjs
```
Expected: FAIL — `Cannot find module .../scripts/verify/hash.mjs`.

- [ ] **Step 4: Port `hash.mjs`**

Port the reference file, translating comments to English and replacing the two path lists with this repo's surface. Keep `HASHED_PREFIXES` / `HASHED_EXACT` / `isHashed` / `listHashedFiles` / `sourceHash` / `errMessage` and the diagnostic entry point exactly as structured in the reference.

```javascript
/** Directory prefixes whose contents feed at least one check. */
const HASHED_PREFIXES = [
  'backend/',
  'frontend/',
  'nginx/',
  'scripts/',
  '.claude/',
  '.github/workflows/',
]

/**
 * Exact paths outside those directories.
 *
 * CLAUDE.md is here because it is the ENTIRE INPUT to the `memo` check. Leaving it out
 * means a hand-edited table does not change the hash, `--reuse-if-fresh` serves a cached
 * green, and the one check whose whole job is catching that drift can never run.
 *
 * .gitignore is here because the `secrets` check's whole subject is which lines of it keep
 * .env out of the repository. A change to that boundary must never be cache-invisible.
 *
 * The compose files and .dockerignore are here because `docker` and `smoke` build from them.
 */
const HASHED_EXACT = new Set([
  'package.json',
  'package-lock.json',
  'turbo.json',
  'docker-compose.yml',
  'docker-compose.prod.yml',
  '.dockerignore',
  '.nvmrc',
  '.gitignore',
  'CLAUDE.md',
])
```

Keep the reference's `/^tsconfig[^/]*\.json$/` rule for root tsconfigs. The prefixes are deliberately over-inclusive: an extra cache miss costs seconds, a missing input costs a false green.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
node --test scripts/verify/hash.test.mjs
```
Expected: PASS, 7/7.

- [ ] **Step 6: Add `tsconfig.scripts.json` and wire the test script**

Create `tsconfig.scripts.json` at the repo root:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["scripts/**/*.mjs", ".claude/hooks/**/*.mjs"]
}
```

Add to the root `package.json` `scripts`:

```json
"test:verify": "node --test 'scripts/verify/**/*.test.mjs'"
```

Append `.verify/` to `.gitignore` under a comment saying it is the verify runner's report directory.

- [ ] **Step 7: Confirm the scripts typecheck**

```bash
npx tsc -p tsconfig.scripts.json
```
Expected: exit 0, no output. Fix any JSDoc error before committing — this file is the reason the layer checks itself.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify/hash.mjs scripts/verify/hash.test.mjs tsconfig.scripts.json package.json .gitignore
git commit -m "feat(verify): content-addressed source hash

Tracked and untracked-not-ignored files both feed the digest: without the
latter a freshly written failing test would not change the hash and a stale
green would be served over it. Never mtime, never 'is the tree dirty' — a turn
that commits its work would earn a free green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `registry.mjs` — the shape, with three real rows

**Files:**
- Create: `scripts/verify/registry.mjs`
- Create: `scripts/verify/registry.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `CHECKS: Check[]`, `PRECONDITIONS: Record<PreconditionId, Precondition>`, `checkById(id: string): Check | undefined`, `inTier(checkTier: Tier, runTier: Tier): boolean`, `tierCovers(stored: Tier, wanted: Tier): boolean`. `Check` is `{ id, tier: 'fast'|'full', cmd, needs?: PreconditionId[], after?: string[], proves, blindSpot }`. **`needs` is an ARRAY here** — the reference used a single id and this repo has rows with two preconditions.

- [ ] **Step 1: Read the reference**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/registry.mjs` — the JSDoc typedefs and the `PRECONDITIONS` block at the top, and the file's own editing rules in its header comment. The 16 Ukrainian `proves`/`blindSpot` strings are *not* ported; they describe another codebase.

- [ ] **Step 2: Write the failing test**

Create `scripts/verify/registry.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CHECKS, PRECONDITIONS, checkById, inTier, tierCovers } from './registry.mjs'

test('every check id is unique', () => {
  const ids = CHECKS.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every check has a falsifiable-looking proves and a blindSpot', () => {
  for (const c of CHECKS) {
    assert.ok(c.proves && c.proves.length > 30, `${c.id}: proves too thin to be falsifiable`)
    assert.ok(c.blindSpot && c.blindSpot.length > 30, `${c.id}: blindSpot too thin`)
  }
})

test('every `after` names a check that exists', () => {
  const ids = new Set(CHECKS.map((c) => c.id))
  for (const c of CHECKS) {
    for (const dep of c.after ?? []) assert.ok(ids.has(dep), `${c.id} depends on unknown ${dep}`)
  }
})

test('every `needs` names a declared precondition, and needs is an array', () => {
  for (const c of CHECKS) {
    if (c.needs === undefined) continue
    assert.ok(Array.isArray(c.needs), `${c.id}: needs must be an array`)
    for (const n of c.needs) assert.ok(PRECONDITIONS[n], `${c.id} needs unknown precondition ${n}`)
  }
})

test('a fast check never depends on a full one — it could never be satisfied in a fast run', () => {
  const tierOf = new Map(CHECKS.map((c) => [c.id, c.tier]))
  for (const c of CHECKS.filter((x) => x.tier === 'fast')) {
    for (const dep of c.after ?? []) {
      assert.notEqual(tierOf.get(dep), 'full', `${c.id} (fast) depends on ${dep} (full)`)
    }
  }
})

test('checkById finds and misses', () => {
  assert.equal(checkById('lint')?.id, 'lint')
  assert.equal(checkById('nope'), undefined)
})

test('inTier: a fast run excludes full, a full run includes both', () => {
  assert.equal(inTier('fast', 'fast'), true)
  assert.equal(inTier('full', 'fast'), false)
  assert.equal(inTier('fast', 'full'), true)
  assert.equal(inTier('full', 'full'), true)
})

test('tierCovers: a green recorded at fast says nothing about full', () => {
  assert.equal(tierCovers('fast', 'fast'), true)
  assert.equal(tierCovers('full', 'fast'), true)
  assert.equal(tierCovers('fast', 'full'), false)
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/verify/registry.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 4: Write `registry.mjs` with the three rows that need no new code**

Port the header comment (translated) — it is the file's editing contract. Declare all five preconditions now so later tasks only add rows. `docker`, `postgres` and `redis` are new; the two npm/browser ones port from the reference.

```javascript
/**
 * @typedef {'fast' | 'full'} Tier
 * @typedef {'playwright-browser' | 'npm-registry' | 'docker' | 'postgres' | 'redis'} PreconditionId
 */

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {Tier} tier
 * @property {string} cmd              command, run through /bin/sh from the repo root
 * @property {PreconditionId[]} [needs] preconditions; any absent means SKIPPED, not FAILED
 * @property {string[]} [after]        ids that must have PASSED, else NOT_RUN
 * @property {string} proves           what a PASSED row establishes
 * @property {string} blindSpot        what it still says nothing about
 */
```

Preconditions — probe only "are there conditions to run in at all", never "did it work":

```javascript
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import net from 'node:net'

/** @param {string} host @param {number} port @returns {Promise<boolean>} */
function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (/** @type {boolean} */ ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(2000)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}
```

`docker`'s probe runs `docker info` and resolves on exit 0. `postgres` probes `DB_HOST ?? 'localhost'` / `DB_PORT ?? 5432`; `redis` probes `REDIS_HOST ?? 'localhost'` / `REDIS_PORT ?? 6379`. Each `describe` says what is missing **and** that under `--no-skip` this is a failure, not "nothing to report".

The three rows:

```javascript
/** @type {Check[]} */
export const CHECKS = [
  {
    id: 'lint',
    tier: 'fast',
    cmd: 'npm run lint',
    proves:
      'eslint parsed every file its flat config reaches in both workspaces and left neither ' +
      'an error nor a warning: --max-warnings=0 makes warn and error the same thing. That ' +
      'includes the money rules scoped to src/intakes, src/payouts, src/shifts and ' +
      'src/supplier-balance, which ban *, /, Number(), toFixed, parseInt and parseFloat there.',
    blindSpot:
      'Nothing about behaviour: whether a sum is right, whether a component renders. A rule ' +
      'that is not enabled does not exist for it, and the money ban covers FOUR modules — ' +
      'arithmetic on a numeric string anywhere else is invisible to this row (ratchet:money ' +
      'is what looks there). Test files are excluded from the money rules by config.',
  },
  // typecheck and test follow the same shape.
]
```

Write `typecheck` and `test` rows with the same discipline. For `test`, the `proves` string must name the **measured** counts — run `npm test -- --force` and use the real numbers (as of 2026-09-10: backend 40 suites / 511 tests, frontend 99 files / 592 tests) — and the `blindSpot` must say that no `.tsx` file is exercised by the backend suites and that a test which calls a function without asserting on the result is green all the same.

Helpers:

```javascript
/** @param {string} id @returns {Check | undefined} */
export const checkById = (id) => CHECKS.find((c) => c.id === id)

/** @param {Tier} checkTier @param {Tier} runTier @returns {boolean} */
export const inTier = (checkTier, runTier) => runTier === 'full' || checkTier === 'fast'

/** A green recorded at `fast` says nothing about `full`. @param {Tier} stored @param {Tier} wanted @returns {boolean} */
export const tierCovers = (stored, wanted) => stored === 'full' || wanted === 'fast'
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
node --test scripts/verify/registry.test.mjs && npx tsc -p tsconfig.scripts.json
```
Expected: PASS 8/8, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify/registry.mjs scripts/verify/registry.test.mjs
git commit -m "feat(verify): the check registry, with lint/typecheck/test

What a check PROVES and what it stays BLIND TO live side by side as data, so
the runner's output, the CI log and CLAUDE.md cannot drift apart.

\`needs\` is an array here, unlike the reference: test:db needs Postgres AND
Redis, smoke needs a browser AND Docker, and collapsing two preconditions into
one probe would report the wrong thing as missing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `run.mjs` — the runner

**Files:**
- Create: `scripts/verify/run.mjs`
- Create: `scripts/verify/run.test.mjs`

**Interfaces:**
- Consumes: `CHECKS`, `PRECONDITIONS`, `checkById`, `inTier`, `tierCovers` from `./registry.mjs`; `sourceHash`, `errMessage` from `./hash.mjs`.
- Produces: the CLI `node scripts/verify/run.mjs [--tier fast|full] [--no-skip] [--only a,b] [--reuse-if-fresh] [--json] [--timeout-ms N]`, exit 0 = nothing blocking, 1 = something blocking or the runner itself failed. Writes `.verify/last-run.json` (schema 1). Also exports `classify`, `parseArgs`, `isBlocking` and `reportIsFresh` **for testing** — the reference kept them private, which is why its status-table bug went unnoticed.

- [ ] **Step 1: Read the reference**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/run.mjs` in full (703 lines). Pay attention to the comments marking bugs already paid for:
- `killGroup` uses `process.kill(-pid)` — killing only the shell records "timed out after 120s" at 902s;
- `setEncoding('utf8')` — without it a multi-byte character split across two data events becomes U+FFFD;
- `rejectValue` — `--no-skip=false` was accepted with the value ignored, silently turning the gate into `exit 0`;
- `printTable` paints the **glyph** by status and a **separate** `⛔` marker by blocking-ness — painting blocking rows red made `NOT_RUN` and `UNRUNNABLE` unreachable, collapsing five states into two;
- `printBlindSpots` is a separate function because both paths production actually takes (`--reuse-if-fresh`, `--json`) returned before reaching it.

- [ ] **Step 2: Write the failing test**

Create `scripts/verify/run.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classify, isBlocking, parseArgs, reportIsFresh } from './run.mjs'

const exited = (code, out = '', err = '') => ({ outcome: 'exited', code, out, err, ms: 1 })

test('exit 0 is PASSED', () => {
  assert.equal(classify(exited(0)), 'PASSED')
})

test('a plain non-zero exit is FAILED', () => {
  assert.equal(classify(exited(1, '', '3 tests failed')), 'FAILED')
})

test('127/126 are UNRUNNABLE — "could not start" is not a claim about the code', () => {
  assert.equal(classify(exited(127)), 'UNRUNNABLE')
  assert.equal(classify(exited(126)), 'UNRUNNABLE')
})

test('a missing npm script is UNRUNNABLE, not FAILED', () => {
  assert.equal(classify(exited(1, '', 'npm ERR! Missing script: "bundle"')), 'UNRUNNABLE')
})

test('a module the runner could not load is UNRUNNABLE', () => {
  assert.equal(classify(exited(1, '', 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module')), 'UNRUNNABLE')
})

test('a spawn error is UNRUNNABLE', () => {
  assert.equal(classify({ outcome: 'spawn-error', code: null, out: '', err: 'EACCES', ms: 0 }), 'UNRUNNABLE')
})

test('a timeout DID run, so it is FAILED not UNRUNNABLE', () => {
  assert.equal(classify({ outcome: 'timeout', code: null, out: '', err: '', ms: 120000 }), 'FAILED')
})

test('all five statuses are reachable from classify or the runner loop', () => {
  const reachable = new Set([
    classify(exited(0)),
    classify(exited(1)),
    classify(exited(127)),
  ])
  assert.ok(reachable.has('PASSED') && reachable.has('FAILED') && reachable.has('UNRUNNABLE'))
})

test('SKIPPED blocks only under --no-skip; NOT_RUN and UNRUNNABLE always block', () => {
  assert.equal(isBlocking('SKIPPED', false), false)
  assert.equal(isBlocking('SKIPPED', true), true)
  assert.equal(isBlocking('NOT_RUN', false), true)
  assert.equal(isBlocking('UNRUNNABLE', false), true)
  assert.equal(isBlocking('PASSED', true), false)
})

test('parseArgs defaults to the fast tier with skips tolerated', () => {
  const o = parseArgs([])
  assert.equal(o.tier, 'fast')
  assert.equal(o.noSkip, false)
  assert.equal(o.only, null)
})

test('an unknown flag is fatal, never a silent no-op', () => {
  assert.throws(() => parseArgs(['--no-skpi']), /unknown flag/)
})

test('--no-skip=false is fatal — a boolean flag given a value silently disabled the gate', () => {
  assert.throws(() => parseArgs(['--no-skip=false']), /does not take a value/)
})

test('--only rejects an unknown check id', () => {
  assert.throws(() => parseArgs(['--only', 'nope']), /unknown check id/)
})

test('reuse refuses a stored green that does not cover the request', () => {
  const green = {
    schema: 1,
    sourceHash: 'abc',
    ok: true,
    tier: 'full',
    noSkip: true,
    envKey: '',
    scope: { only: null, afterDepsFullyEvaluated: true },
  }
  const opts = { tier: 'fast', noSkip: false, only: null }
  assert.equal(reportIsFresh(green, 'abc', opts), true)
  assert.equal(reportIsFresh({ ...green, sourceHash: 'zzz' }, 'abc', opts), false, 'different tree')
  assert.equal(reportIsFresh({ ...green, ok: false }, 'abc', opts), false, 'was not green')
  assert.equal(reportIsFresh({ ...green, schema: 0 }, 'abc', opts), false, 'older schema')
  assert.equal(reportIsFresh({ ...green, tier: 'fast' }, 'abc', { ...opts, tier: 'full' }), false,
    'a fast green says nothing about full')
  assert.equal(reportIsFresh({ ...green, scope: { only: ['lint'], afterDepsFullyEvaluated: true } }, 'abc', opts),
    false, 'a one-check green is not a tree verdict')
  assert.equal(reportIsFresh({ ...green, noSkip: false }, 'abc', { ...opts, noSkip: true }), false,
    'a green that tolerated skips cannot satisfy --no-skip')
  assert.equal(reportIsFresh({ ...green, scope: { only: null, afterDepsFullyEvaluated: false } }, 'abc', opts),
    false, 'after-deps were never evaluated')
  assert.equal(reportIsFresh({ ...green, envKey: 'COVERAGE_X=1' }, 'abc', opts), false,
    'different coverage floors are a different verdict')
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/verify/run.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 4: Port `run.mjs`**

Port the reference file, translating all output strings to English. Two required deviations:

1. **`needs` is an array.** The check loop becomes: probe every id in `check.needs ?? []`; if any is absent the row is `SKIPPED` and the reason names **which** ones were missing, joined.
2. **`classify`, `parseArgs`, `isBlocking` and `reportIsFresh` are exported**, and `reportIsFresh` takes the parsed report as its **first argument** (`reportIsFresh(stored, hash, opts)`) rather than reading the file itself. Keep a thin private wrapper that reads `.verify/last-run.json` and calls it, so the disk path stays covered by the real run.

`rejectValue`'s message must contain the words `does not take a value` so the test above pins it.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
node --test scripts/verify/run.test.mjs && npx tsc -p tsconfig.scripts.json
```
Expected: PASS 14/14, tsc exit 0.

- [ ] **Step 6: Prove the table shows five distinct statuses**

This is the reference's most expensive past bug, so confirm it by eye once:

```bash
node scripts/verify/run.mjs --tier fast --only lint
```
Expected: a table with `✓ PASSED` and a `tier`/scope line, plus the "SCOPE: this run was limited" warning and the "What this does NOT prove" footer. Confirm the footer prints **on a green run** — if it does not, `printBlindSpots` is being skipped and that is the bug the reference documented.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify/run.mjs scripts/verify/run.test.mjs
git commit -m "feat(verify): the runner — five statuses that never collapse

Thin on purpose: the registry holds the judgement, this holds the mechanics.
A process-group-safe timeout, a content-addressed report, and a footer that
prints the blind spots whether the run was green or red.

classify/parseArgs/isBlocking/reportIsFresh are exported for testing. The
reference kept them private, which is how its status table came to render
only two of its five states without anyone noticing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the three fast rows and tighten lint

**Files:**
- Modify: `package.json` (root — `verify`, `verify:full`, `verify:ci`, `typecheck`)
- Modify: `backend/package.json` (`lint`), `frontend/package.json` (`lint`)
- Modify: `turbo.json` (add the `typecheck` task)
- Possibly modify: whatever `--max-warnings=0` surfaces

- [ ] **Step 1: Add the root scripts**

```json
"typecheck": "turbo typecheck && tsc -p tsconfig.scripts.json",
"verify": "node scripts/verify/run.mjs --tier fast",
"verify:full": "node scripts/verify/run.mjs --tier full",
"verify:ci": "node scripts/verify/run.mjs --tier full --no-skip"
```

There is deliberately **no CI-only check command**: the moment CI has its own, "green there / green here" drift apart and neither means anything. `verify:ci` differs only in flags.

Add `typecheck` to both workspaces — backend `"typecheck": "tsc -p tsconfig.json --noEmit"`, frontend `"typecheck": "tsc -b"` — and to `turbo.json`:

```json
"typecheck": { "dependsOn": ["^typecheck"], "outputs": [] }
```

- [ ] **Step 2: Run typecheck and confirm it is green before tightening anything**

```bash
npm run typecheck
```
Expected: exit 0. If not, fix the errors — they are pre-existing and must not be blamed on this layer later.

- [ ] **Step 3: Tighten lint and SEE what it surfaces**

Change both workspace `lint` scripts to `eslint . --max-warnings=0`, then:

```bash
npm run lint -- --force
```
Record the output. If it is red, the findings are **fixed**, not suppressed and not baselined — this is Global Constraint 6. If a finding genuinely cannot be fixed in this PR, stop and report it rather than adding a disable comment (Task 10's ratchet would bake it in permanently).

- [ ] **Step 4: Run the fast tier end to end**

```bash
time npm run verify
```
Expected: three rows PASSED, the footer printed, `.verify/last-run.json` written. **Record the wall-clock time** — the spec's §10 decision about moving `test` to the full tier is made on this number.

- [ ] **Step 5: Confirm reuse actually reuses**

```bash
npm run verify && time node scripts/verify/run.mjs --tier fast --reuse-if-fresh
```
Expected: the second run exits 0 in well under a second and still prints the blind-spot footer with a "reused a green report for …" note.

- [ ] **Step 6: Commit**

```bash
git add package.json backend/package.json frontend/package.json turbo.json
git commit -m "feat(verify): wire the fast tier, and make a lint warning count

--max-warnings=0 in both workspaces: until now a warning exited 0, so the lint
row could not honestly claim that warn and error are the same thing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 2 — The memo contract

### Task 5: `memo` — the generated proves/blind-spot table

**Files:**
- Create: `scripts/verify/checks/memo-drift.mjs`
- Create: `scripts/verify/checks/memo-drift.test.mjs`
- Modify: `CLAUDE.md` (root — new "Verification" section)
- Modify: `scripts/verify/registry.mjs` (add the `memo` row)
- Modify: `package.json` (root — `memo` script)

- [ ] **Step 1: Read the reference**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/checks/memo-drift.mjs` (124 lines). Note two things it learned: `cell()` **throws** if a registry string contains a table marker (otherwise `--write` appends a marker every run and never converges), and the checksum is taken over the **raw** strings because `cell()` collapses whitespace — two different registry strings could render to one identical cell, and "byte-for-byte" would hold of the table while the registry had changed underneath it.

- [ ] **Step 2: Write the failing test**

Create `scripts/verify/checks/memo-drift.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const MEMO = path.join(ROOT, 'CLAUDE.md')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'memo-drift.mjs')

/** @returns {{ status: number, out: string }} */
function run(args = []) {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' }) }
  } catch (err) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

test('the committed table matches the registry', () => {
  assert.equal(run().status, 0)
})

test('a hand-edited table is caught', () => {
  const original = readFileSync(MEMO, 'utf8')
  try {
    writeFileSync(MEMO, original.replace('| `lint` |', '| `lint-TAMPERED` |'))
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /drifted|does not match/i)
  } finally {
    writeFileSync(MEMO, original)
  }
})

test('a missing marker is caught rather than silently generating nothing', () => {
  const original = readFileSync(MEMO, 'utf8')
  try {
    writeFileSync(MEMO, original.replace('<!-- BEGIN:verify-table -->', ''))
    assert.equal(run().status, 1)
  } finally {
    writeFileSync(MEMO, original)
  }
})

test('--write regenerates and then the check is green', () => {
  const original = readFileSync(MEMO, 'utf8')
  try {
    writeFileSync(MEMO, original.replace('| `lint` |', '| `lint-TAMPERED` |'))
    assert.equal(run(['--write']).status, 0)
    assert.equal(run().status, 0)
    assert.equal(readFileSync(MEMO, 'utf8'), original, '--write is idempotent back to the committed form')
  } finally {
    writeFileSync(MEMO, original)
  }
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/verify/checks/memo-drift.test.mjs
```
Expected: FAIL — the check does not exist and `CLAUDE.md` has no markers.

- [ ] **Step 4: Port `memo-drift.mjs`**

Port the reference, translating output to English. `ROOT` resolves three levels up from `import.meta.dirname`. Keep `cell()`'s marker guard and the raw-string checksum. The generated header comment must say, in English, that the block is generated from `scripts/verify/registry.mjs`, must not be hand-edited, and is regenerated with `node scripts/verify/checks/memo-drift.mjs --write`.

- [ ] **Step 5: Write the `CLAUDE.md` Verification section**

Add a new top-level section to the root `CLAUDE.md`, after **Commands**. It contains, in this order:

1. **A warning that the gate is the fast tier only** — no `build`, no `smoke`, no `coverage`, so a turn can end green having never built the app. `typecheck` *is* in the fast tier, so what stays uncovered is what breaks only in a Vite build and in Docker.
2. The three commands with their measured cost from Task 4 Step 4.
3. A statement that every check is an ordinary npm script runnable on its own, and that **nothing exists only inside the orchestrator and nothing only inside CI**.
4. The five-status table:

```markdown
| status | meaning | blocks |
| --- | --- | --- |
| `PASSED` | ran, passed | no |
| `FAILED` | ran, failed | yes |
| `SKIPPED` | a precondition was absent — there was nowhere to run | no, but it must be said out loud |
| `NOT_RUN` | a dependency did not pass, so this was never attempted | yes |
| `UNRUNNABLE` | the command could not start (127 / spawn error) | yes |

`UNRUNNABLE` is not pedantry. Reporting "lint FAILED" when the linter is merely absent from
`PATH` asserts something about the code that nobody tested.
```

5. The empty generated region:

```markdown
<!-- BEGIN:verify-table -->
<!-- END:verify-table -->
```

6. **Three rules**, each with its mechanism named:
   - **Evidence under the claim** — a table of *what changed* → *what must be run*, covering: anything in `backend/src` or `frontend/src` → `npm run verify`; anything touching money → `verify` plus naming the coverage number; `package.json`/lockfile → `verify:full` (that is where `audit`, `bundle` and `deadcode` live); a migration → `verify:full` (that is where `test:db` lives); `scripts/verify/` or `.claude/hooks/` → `npm run verify`, because that code is under `tsconfig.scripts.json` too; the registry → `node scripts/verify/checks/memo-drift.mjs --write`, or `memo` goes red.
   - **Skips are spoken aloud** — "the fast tier is green; `smoke` and `docker` were skipped, no daemon" and never "all green".
   - **Ratchets turn one way** — widening a baseline, relaxing a rule, adding a knip suppression key or lowering a coverage floor **is not turning green**. An exception is allowed only when it is listed individually, dated, carries a reason checked against the source, and cancels itself when the finding disappears.

- [ ] **Step 6: Generate the table and add the `memo` row**

Add the `memo` row to `registry.mjs` (tier `fast`, cmd `node scripts/verify/checks/memo-drift.mjs`), add `"memo": "node scripts/verify/checks/memo-drift.mjs"` to the root scripts, then:

```bash
node scripts/verify/checks/memo-drift.mjs --write
```

- [ ] **Step 7: Run the tests and watch them pass**

```bash
node --test scripts/verify/checks/memo-drift.test.mjs && npm run verify
```
Expected: 4/4 PASS; `verify` now shows four rows.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify/checks/memo-drift.mjs scripts/verify/checks/memo-drift.test.mjs scripts/verify/registry.mjs CLAUDE.md package.json
git commit -m "feat(verify): the memo table is generated, not written

Drift between the registry and CLAUDE.md is a defect in the one pair whose
entire job is honesty: a memo claiming a check proves something it no longer
proves has become the false-confidence artifact it was written to remove.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 3 — The checks written from scratch

> **Every task in this phase follows the same rhythm, and it is not optional:**
> write a fixture that VIOLATES the invariant → run the check → watch it go RED →
> then confirm it is GREEN on the real tree. A check that has never been seen red
> has not been shown to check anything.

### Task 6: `testfiles` — four runners, exactly one each

**Files:**
- Create: `scripts/verify/checks/test-glob-parity.mjs`
- Create: `scripts/verify/checks/test-glob-parity.test.mjs`
- Modify: `scripts/verify/registry.mjs`, `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks except the registry shape.
- Produces: exit 0/1 CLI. Prints one line per orphaned or doubly-collected file.

- [ ] **Step 1: Understand the three collectors**

Verified 2026-09-10:
- `backend/package.json` → `jest.testRegex = '.*\\.spec\\.ts$'`, `rootDir: 'src'`
- `backend/jest.db.config.js` → `testRegex = '.*\\.db-spec\\.ts$'`, `rootDir: 'src'`
- `frontend/vite.config.ts` → vitest default include, `**/*.{test,spec}.?(c|m)[jt]s?(x)`

The two backend regexes do not overlap: `.spec.ts` does not match `db-spec.ts`. **Today that fact is held by a comment in `jest.db.config.js` and nothing else.** A file `backend/src/foo.test.ts` is collected by nothing at all and would sit green forever.

`scripts/verify/*.test.mjs` is collected by `node --test` (Task 1) and must be recognised as a fourth collector rather than reported as an orphan.

- [ ] **Step 2: Write the failing test**

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'test-glob-parity.mjs')

function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8' }) }
  } catch (err) {
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

test('the real tree is green', () => {
  assert.equal(run().status, 0)
})

test('a backend *.test.ts is caught — no runner collects it', () => {
  const orphan = path.join(ROOT, 'backend', 'src', 'zz-orphan.test.ts')
  writeFileSync(orphan, 'it("never runs", () => {})\n')
  try {
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /zz-orphan\.test\.ts/)
    assert.match(res.out, /no runner|zero/i)
  } finally {
    rmSync(orphan, { force: true })
  }
})

test('a frontend *.spec.tsx collected by vitest alone is fine', () => {
  const ok = path.join(ROOT, 'frontend', 'src', 'zz-ok.spec.tsx')
  writeFileSync(ok, 'it("runs", () => {})\n')
  try {
    assert.equal(run().status, 0)
  } finally {
    rmSync(ok, { force: true })
  }
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/verify/checks/test-glob-parity.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Read the reference at `scripts/verify/checks/test-glob-parity.mjs` for its shape, then implement for four collectors. Enumerate candidate files with `git ls-files -c -o --exclude-standard` filtered to `/\.(test|spec|db-spec)\.[cm]?[jt]sx?$/`. For each, compute the set of collectors that match:

- `jest-unit` — path under `backend/src/` and matches `/.*\.spec\.ts$/`
- `jest-db` — path under `backend/src/` and matches `/.*\.db-spec\.ts$/`
- `vitest` — path under `frontend/` and matches vitest's default include
- `node-test` — path under `scripts/` and matches `/\.test\.mjs$/`

Exit 1 listing every file whose collector set size is not exactly 1, saying which case it is (zero collectors, or which two claimed it). **Read the two regexes out of `backend/package.json` and `backend/jest.db.config.js` at runtime rather than hard-coding them** — a hard-coded copy is a second source of truth that can drift from the config it claims to describe.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
node --test scripts/verify/checks/test-glob-parity.test.mjs
```
Expected: 3/3 PASS, including the red case.

- [ ] **Step 6: Add the row, regenerate the memo, commit**

Add `testfiles` to the registry (tier `fast`, cmd `npm run test:files`) and `"test:files": "node scripts/verify/checks/test-glob-parity.mjs"` to the root scripts, then `node scripts/verify/checks/memo-drift.mjs --write`, then `npm run verify`.

```bash
git add scripts/verify/checks/test-glob-parity.mjs scripts/verify/checks/test-glob-parity.test.mjs scripts/verify/registry.mjs package.json CLAUDE.md
git commit -m "feat(verify): every test file is collected by exactly one runner

Three collectors here, not the reference's two. backend/src/foo.test.ts is
picked up by none of them and would sit green forever; that the unit and db
regexes do not overlap was held by a comment and nothing else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `secrets` — the boundary that keeps `.env` out

**Files:**
- Create: `scripts/verify/checks/secret-boundary.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/secret-boundary.json`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Establish the ground**

Verified 2026-09-10, root `.gitignore`:

```
# Local secrets. .env.example IS committed.
.env
.env.*
!.env.example
```

`JWT_SECRET` and `DB_PASSWORD` live in the untracked root `.env`; CI supplies throwaway values inline. This is the boundary the check defends.

- [ ] **Step 2: Write the failing test**

Cases, each as its own `node --test` case:

1. The real tree is green.
2. Writing a tracked file containing a PEM private-key header line makes it red. (Create under `docs/`, `git add -N`, assert red, then `git rm --cached` and delete.) **Build that header at runtime by concatenation — never write the literal pattern into a source or plan file.** A document that spells the pattern out becomes a permanent finding for the very check it describes, and the wrong way out of that is an exemption in the checker.
3. Writing a tracked file containing a JWT-shaped string (`eyJ` + two more base64url segments) makes it red.
4. Removing the `.env` line from `.gitignore` makes it red, naming the fingerprint mismatch.
5. Putting a 40-character high-entropy value into `.env.example` makes it red.
6. `.env.example` keeping its placeholder values stays green.

Each mutating case must restore the original file in a `finally`.

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/verify/checks/secret-boundary.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

The check does four things:

1. **`.env` is not tracked.** `git ls-files -- .env .env.*` must return nothing but `.env.example`.
2. **The gitignore boundary is fingerprinted.** SHA-256 of the exact ignore lines (`.env`, `.env.*`, `!.env.example`) recorded in `baselines/secret-boundary.json` with a dated reason. A change is a visible diff in a reviewed file.
3. **No tracked file carries a secret shape.** Scan tracked files for: a PEM `BEGIN … PRIVATE KEY` block; a JWT (`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`); an assignment of a ≥32-character high-entropy value (Shannon entropy > 3.5 bits/char) to a name matching `/secret|password|token|api[_-]?key/i`. Skip `package-lock.json` (integrity hashes) and the baseline file itself.
4. **`.env.example` is placeholder-only.** Every value must be empty, or match `/^(changeme|example|your-|<.*>|\.\.\.)/i`, or be short and low-entropy. `.env.example` values are otherwise held to rule 3.

Findings are reported with file and line. The baseline holds **only** the gitignore fingerprint — a secret is never baselined.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
node --test scripts/verify/checks/secret-boundary.test.mjs
```
Expected: all cases PASS, including all four red ones.

- [ ] **Step 6: Add the row, regenerate the memo, commit**

Register `secrets` (tier `fast`, cmd `npm run secrets`), add the script, regenerate, `npm run verify`, commit with a message explaining that the reference's `pii` check guarded a public repo against real supplier names and this one guards the secret boundary instead, because that is the boundary that exists here.

---

### Task 8: `seam` — the identity seam and the seed's isolation

**Files:**
- Create: `scripts/verify/checks/seam-boundary.mjs`, its `.test.mjs`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Establish the ground**

Verified 2026-09-10:
- `backend/src/users/user-identity.entity.ts:20` exports `LOCAL_PROVIDER = 'local'`.
- The bare literal `'local'` also appears in `migrations/1788600000001-SeedDevAdmin.ts`, `migrations/1788600000003-BootstrapOwner.ts`, and `seed/dev-seed.ts` (lines 192, 203, 348).
- Root `CLAUDE.md`: `user_identities(provider, provider_user_id)` is the single login lookup path, and adding an OAuth provider means writing a different value with no schema change.

- [ ] **Step 2: Write the failing test**

1. The real tree is green.
2. Adding a bare `'local'` string literal in a new `backend/src/users/*.ts` file makes it red, naming the file and line and pointing at `LOCAL_PROVIDER`.
3. Adding `import { devSeed } from '../seed/dev-seed'` inside a `backend/src` module that is not the seed CLI or a spec makes it red.
4. The same literal inside `backend/src/migrations/` stays green — a migration is frozen by definition.
5. The same literal inside a `*.spec.ts` stays green.

- [ ] **Step 3: Run it and watch it fail**

- [ ] **Step 4: Implement**

Two rules over `backend/src/**/*.ts`:

1. **Provider literal.** A string literal `'local'` is a finding unless the file is under `migrations/`, under `seed/`, is a `*.spec.ts` / `*.db-spec.ts`, or is `users/user-identity.entity.ts` itself (the file that *declares* the constant). Match on the AST — a `Literal` node whose value is exactly `local` — not a regex, so a comment mentioning local is not a finding.
2. **Seed isolation.** Any `import`/`require` whose specifier resolves inside `backend/src/seed/` is a finding unless the importing file is itself under `seed/` or is a spec.

Parse with TypeScript's own compiler API (`typescript` is already a backend devDependency; import it via `createRequire` from the backend workspace). Do not add a parser dependency.

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Add the row, regenerate the memo, commit**

---

### Task 9: `migrations` — the invariants of an append-only schema

**Files:**
- Create: `scripts/verify/checks/migration-invariants.mjs`, its `.test.mjs`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Establish the ground**

Verified 2026-09-10: 8 migrations in `backend/src/migrations/`, timestamps `1788600000000`–`1788600000007`, plus 5 `*.db-spec.ts` files in the same directory. `synchronize: false` appears in `app.module.ts:129` and `testing/db-harness.ts:126`.

- [ ] **Step 2: Write the failing test**

1. The real tree is green.
2. Adding a migration whose timestamp is lower than an existing one makes it red.
3. Adding a migration whose exported class name does not match its filename makes it red.
4. Setting `synchronize: true` in a copy of `app.module.ts` makes it red.
5. Modifying a migration that is an ancestor of `origin/main` makes it red, naming the file.
6. Adding a *new* migration with the highest timestamp stays green.

- [ ] **Step 3: Run it and watch it fail**

- [ ] **Step 4: Implement**

Four rules:

1. `synchronize` is `false` at every occurrence in `backend/src/**` (AST: a property named `synchronize` whose initialiser is not the literal `false` is a finding).
2. Migration filenames match `/^(\d{13})-([A-Za-z0-9]+)\.ts$/`; timestamps are strictly ascending with no duplicates. `*.db-spec.ts` in that directory is excluded.
3. The exported class name equals the filename's second capture group.
4. **Already-merged migrations are frozen.** For each migration file, if it exists in `origin/main` (`git cat-file -e origin/main:<path>`), its current content must be byte-identical (`git diff --quiet origin/main -- <path>`). If `origin/main` is not fetched, this rule **SKIPS with a printed warning** — and says so — rather than passing silently.

Rule 4's warning line must start with `WARNING` so the runner's `warningLines()` surfaces it even on a green run.

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Add the row, regenerate the memo, commit**

---

### Task 10: `ratchet:lint-exempt`

**Files:**
- Create: `scripts/verify/ratchets/lint-exempt.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/lint-exempt.json`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Read the reference and measure the ground**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/checks/lint-exempt-ratchet.mjs` (162 lines) and `baselines/lint-exempt.json` for the entry shape and the stub-reason rejection.

Then measure: `grep -rn "eslint-disable" backend/src frontend/src --include=*.ts --include=*.tsx` — 9 occurrences on 2026-09-10. **Read each one and write a real reason**; a baseline entry whose reason was invented is worse than no baseline.

- [ ] **Step 2: Write the failing test**

1. The real tree is green against the committed baseline.
2. Adding a new `// eslint-disable-next-line` anywhere in `backend/src` makes it red (a finding not in the baseline).
3. **Removing** an existing disable comment makes it red too — the ratchet turns both ways, and a stale entry must be deleted.
4. A baseline entry whose `reason` is `"TODO"` makes the checker itself exit red.
5. A baseline entry whose `reason` is shorter than 30 characters makes it red.

- [ ] **Step 3: Run it and watch it fail**

- [ ] **Step 4: Implement**

Enumerate every `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line` and `eslint-enable` comment in `backend/src` and `frontend/src`, plus every `ignores` glob and every rule set to `'off'` in the two flat configs. Key each finding by `file:line:directive:rules`. Compare with `baselines/lint-exempt.json` in both directions. Reject stub reasons before comparing anything — an entry that explains nothing is not an exemption, it is a hole.

Baseline entry shape:

```json
{
  "key": "backend/src/foo.ts:12:eslint-disable-next-line:@typescript-eslint/no-explicit-any",
  "added": "2026-09-10",
  "reason": "<a real sentence, ≥30 chars, checked against the source>"
}
```

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Add the row, regenerate the memo, commit**

---

### Task 11: `ratchet:money`

**Files:**
- Create: `scripts/verify/ratchets/money-rounding.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/money-rounding.json`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Read the reference and the spec section**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/ratchets/money-rounding.mjs` (449 lines) for its import-resolution technique, then **re-read spec §4.2** — the rule implemented here is the spec's decidable form, not the reference's.

The eslint config already bans this in `src/intakes/`, `src/payouts/`, `src/shifts/`, `src/supplier-balance/` (excluding specs). This ratchet covers **everywhere else** in `backend/src`.

- [ ] **Step 2: Write the failing test**

1. The real tree is green against the committed baseline.
2. A new `backend/src/users/x.ts` containing `const total = a * b` where `a` comes from a function parameter makes it red.
3. A new file containing `const px = width * 2` where `const width = 10` stays green — provably non-monetary.
4. A new file containing `Number(row.amount)` makes it red.
5. A file inside `src/intakes/` stays green here regardless — that is eslint's territory, and a second red for the same line teaches people to silence one of them.
6. A partial fix does not count: a baseline entry with `count: 3` where only 2 remain makes it red.

- [ ] **Step 3: Run it and watch it fail**

- [ ] **Step 4: Implement**

Per spec §4.2, for each file in `backend/src/**/*.ts` excluding the four eslint-scoped module trees and excluding `*.spec.ts` / `*.db-spec.ts`:

- Collect every `BinaryExpression` with operator `*` or `/`, every `CallExpression` on `Number`, `parseInt`, `parseFloat`, and every `MemberExpression` with property `toFixed`.
- An occurrence is **cleared** when every operand is a numeric literal, or an identifier declared in the same file with an explicit `number` type annotation or a numeric-literal initialiser.
- Everything else is a finding, keyed `file:line:kind`, counted, and compared against `baselines/money-rounding.json` with exact counts in both directions.
- Resolve `money.ts` bindings by import so an alias, a namespace import, or a locally declared imposter `round2` is not mistaken for the real one.

Use the TypeScript compiler API, same access route as Task 8.

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Add the row, regenerate the memo, commit**

The `blindSpot` string must carry spec §4.2's three admissions verbatim in substance: nothing about whether the arithmetic is *right*; type information is single-file, not from the type checker, so a monetary string arriving through a parameter typed elsewhere lands in the baseline rather than being caught; and a value computed into an intermediate variable and only later formatted is invisible.

---

### Task 12: `ratchet:persist` — the four localStorage boundaries

**Files:**
- Create: `scripts/verify/ratchets/persist-boundary.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/persist-boundary.json`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Establish the ground**

Verified 2026-09-10 — four independent boundaries, none of them zustand `persist`:

| file | what it stores | how it narrows |
|---|---|---|
| `entities/user/model/store.ts` | bearer token (`web-starter.token`) | try/catch; value used as an opaque string |
| `shared/api/persister.ts` | TanStack query cache | try/catch probe; `isPersistableKey` default-deny allowlist (`'me'` only) |
| `shared/lib/form-draft/draftStorage.ts` | raw form drafts | try/catch; envelope owned by `useFormDraft` |
| `shared/lib/i18n/language-preference.ts` | language code | try/catch; `isSupported` local type predicate |

- [ ] **Step 2: Write the failing test**

1. The real tree is green.
2. A new file reading `localStorage.getItem('x')` **outside** a try/catch makes it red.
3. A new file reading storage inside try/catch but feeding the value into state **without narrowing** makes it red.
4. The same read narrowed by a local type predicate stays green.
5. Adding a second key to `isPersistableKey`'s allowlist without updating the baseline makes it red.
6. Removing a baseline allowlist entry that no longer exists in the code makes it red — both directions.

- [ ] **Step 3: Run it and watch it fail**

- [ ] **Step 4: Implement**

Three rules over `frontend/src/**/*.{ts,tsx}`, excluding `*.test.*`:

1. Every `localStorage` / `sessionStorage` member access has a `TryStatement` ancestor. The accessor itself throws in a private window and this module graph is imported at bootstrap, so an unguarded throw is a blank page — this is a real failure mode, not style.
2. Every value returned from `getItem` reaches app state only through a narrowing: `typeof`, `Array.isArray`, `in`, `instanceof`, a `.parse(` call, or a local type-predicate function (`x is T`) **declared in the same file**. A predicate imported from elsewhere cannot be confirmed from the AST and does **not** count — say so in the `blindSpot`.
3. The string literals returned by `isPersistableKey` equal `baselines/persist-boundary.json`, both directions.

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Add the row, regenerate the memo, commit**

---

### Task 13: `deadcode` — knip

**Files:**
- Create: `knip.json`
- Create: `scripts/verify/ratchets/dead-exports.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/dead-exports.json`
- Modify: `package.json` (root — devDependency + script), `scripts/verify/registry.mjs`

- [ ] **Step 1: Install and measure**

```bash
npm install -D knip
npx knip --reporter json > /tmp/knip-baseline.json; echo "exit=$?"
```

Read the output. **This will almost certainly be non-empty on first run** — that is the debt this repo has today, and recording it dated with reasons is legitimate. Growing it later is the failure mode.

- [ ] **Step 2: Write `knip.json` with entry/project only**

```json
{
  "workspaces": {
    "backend": { "entry": ["src/main.ts", "src/data-source.ts", "src/seed/dev-seed.cli.ts"], "project": ["src/**/*.ts"] },
    "frontend": { "entry": ["src/main.tsx", "vite.config.ts"], "project": ["src/**/*.{ts,tsx}"] }
  }
}
```

**No suppression keys.** `ignore`, `ignoreDependencies`, `ignoreExportsUsedInFile` and friends are outside the allowed set, and the ratchet fails if any appears — that is the point of rule 3 in `CLAUDE.md`.

- [ ] **Step 3: Write the failing test**

1. The real tree is green against the committed baseline.
2. Adding an unused export makes it red.
3. Deleting a file listed in the baseline makes it red — the stale entry must go.
4. Adding `"ignore": ["src/foo.ts"]` to `knip.json` makes the ratchet red, naming the banned key.
5. `knip.json`'s glob set is fingerprinted in the baseline; changing a glob without updating the baseline makes it red.

- [ ] **Step 4: Run it and watch it fail**

- [ ] **Step 5: Implement**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/ratchets/dead-exports.mjs` (341 lines) for the shape. Run `knip --reporter json`, normalise the findings to stable keys, compare with the baseline in both directions, reject suppression keys in `knip.json`, and fingerprint the config's globs.

- [ ] **Step 6: Run the tests and watch them pass**

- [ ] **Step 7: Add the row, regenerate the memo, commit**

Report in the commit message how many baseline entries the first run recorded — that number is this repo's dead-code debt on 2026-09-10, and it should be visible.

---

## Phase 4 — The full tier

### Task 14: `audit`, `build`, `coverage`

**Files:**
- Create: `scripts/verify/checks/audit.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/audit.json`
- Modify: `package.json` (root — `audit:check`, `coverage`), `frontend/package.json` (coverage), `backend/package.json` (coverage), `scripts/verify/registry.mjs`
- Install: `@vitest/coverage-v8` in the frontend workspace

- [ ] **Step 1: Port `audit.mjs`**

Read `/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/scripts/verify/checks/audit.mjs` (202 lines) and its baseline. It runs `npm audit --json`, compares advisory ids against a dated baseline in both directions, and treats an unreachable registry as the `npm-registry` precondition's business, not as "no vulnerabilities". Measure the current advisories and record them with real reasons.

- [ ] **Step 2: Write its test** — a fabricated advisory not in the baseline is red; a baseline entry whose advisory no longer appears is red.

- [ ] **Step 3: Add `coverage`**

Backend: `"coverage": "NODE_OPTIONS=--experimental-vm-modules jest --coverage"`. Frontend: `npm i -D @vitest/coverage-v8` then `"coverage": "vitest run --coverage"`. Root: `"coverage": "turbo coverage"`.

**Measure both, then set the floors from the measurement**, floored to whole percents. The floors live **only** in `.github/workflows/ci.yml` `env:` (Task 20) — locally they read as 0, so the number is reported without gating and a 1% wobble on a laptop cannot teach anyone to route around the gate. Record the measured numbers in the `coverage` row's `proves` string with the date.

- [ ] **Step 4: Add all three rows to the registry**

`audit` (full, needs `['npm-registry']`), `build` (full), `coverage` (full).

- [ ] **Step 5: Run the full tier**

```bash
npm run verify:full
```
Expected: the new rows run; `smoke`/`docker`/`test:db` do not exist yet. Record the wall-clock.

- [ ] **Step 6: Regenerate the memo and commit**

---

### Task 15: `bundle`

**Files:**
- Create: `scripts/verify/checks/bundle-size.mjs`, its `.test.mjs`
- Create: `scripts/verify/baselines/bundle-budget.json`
- Modify: `scripts/verify/registry.mjs`, `package.json`

- [ ] **Step 1: Port and measure**

Read the reference's `bundle-size.mjs` (170 lines) and `baselines/bundle-budget.json`. Build, then measure `frontend/dist/assets` gzip and raw totals.

**Set the ceiling by rounding the measurement UP in steps of 5 KiB (gzip) and 20 KiB (raw).** The reference pinned it byte-for-byte first and it failed on the very next commit over **18 bytes** — a check that demands a budget edit over 18 bytes teaches people to raise budgets without reading. What must fail is a *regression*: a new library, an accidental whole-package import.

- [ ] **Step 2: Write its test** — a fabricated `dist` over budget is red; under budget is green; the headroom is printed on a green run as a `WARNING`-prefixed line so `warningLines()` surfaces it.

- [ ] **Step 3: Implement, register (`full`, after `build`), regenerate, commit**

The `blindSpot` must say what the reference learned the hard way: this measures the **sum** of `dist/assets`, not what a browser actually downloads on first paint, and the sum can grow while the user's download shrinks (chunk splitting does exactly that).

---

### Task 16: `test:db` and `docker`

**Files:**
- Modify: `scripts/verify/registry.mjs`, `package.json`
- Modify: `backend/src/testing/db-harness.ts` — **only** if Step 2 shows it necessary

- [ ] **Step 1: Add the `docker:build` script**

```json
"docker:build": "docker build -f backend/Dockerfile --target prod -t web-starter-backend:verify . && docker build -f nginx/Dockerfile -t web-starter-nginx:verify ."
```

- [ ] **Step 2: Make `test:db` start from a clean database**

This repo has already been bitten: leftover rows in `app_test` make the seed spec pass locally and fail in CI. Making `test:db` a *local* row multiplies that exposure.

Run the suite twice in a row against a dirty database and confirm the failure mode is real:

```bash
docker compose up -d postgres redis
npm run test:db -w backend && npm run test:db -w backend
```

If the second run fails, fix it by having the harness drop and recreate the test database (`DROP DATABASE IF EXISTS` / `CREATE DATABASE` on a maintenance connection) before migrations run. If the second run passes, record that in the row's `proves` string — and still make the drop/create explicit, because passing today is not the same as being guaranteed.

- [ ] **Step 3: Add both rows**

`test:db` (full, needs `['postgres','redis']`, cmd `npm run test:db -w backend`) and `docker` (full, needs `['docker']`, cmd `npm run docker:build`).

- [ ] **Step 4: Prove the preconditions actually skip**

```bash
docker compose down
npm run verify:full
```
Expected: `test:db` and `docker` are **SKIPPED**, the reason names which precondition was absent, and the summary says out loud that this is not "all green". Then:

```bash
node scripts/verify/run.mjs --tier full --no-skip --only test:db
```
Expected: the same absent precondition now **blocks** — this is the CI form.

- [ ] **Step 5: Regenerate the memo and commit**

---

### Task 17: `smoke` — Playwright against the real stack

**Files:**
- Create: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json` (root — devDependency + `test:e2e`), `scripts/verify/registry.mjs`, `.gitignore`

- [ ] **Step 1: Install**

```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Add `test-results/`, `playwright-report/` and `e2e/.auth/` to `.gitignore`.

- [ ] **Step 2: Write `global-setup.ts`**

The Compose lifecycle lives **here, not in the npm script**, so a bare `npx playwright test` behaves identically to `npm run test:e2e`. It must:

1. `docker compose up -d --wait postgres redis backend` (`--wait` honours the healthchecks that already gate on `/health/ready`).
2. `npm run db:seed` — idempotent per `backend/CLAUDE.md`.
3. Read the seeded owner's credentials from the seed data and export them for the specs.

`global-teardown.ts` runs `docker compose down -v`. Both must fail loudly rather than leaving the specs to fail confusingly against a stack that never came up.

- [ ] **Step 3: Write `playwright.config.ts`**

```typescript
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  retries: 0,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview -w frontend -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
})
```

`retries: 0` is deliberate: a retried flake is a red result rounded up to green. `strictPort` is deliberate too — a port collision must fail rather than silently serve from somewhere else.

- [ ] **Step 4: Write the smoke spec**

Three assertions, no more — this row exists to prove the stack composes, not to be a test suite:

1. The sign-in page renders, and signing in with the seeded owner's real credentials via the UI reaches the dashboard.
2. A page that requires data renders a number from the seed — not `NaN`, not an empty state.
3. No uncaught page error and no failed network request during the run (`page.on('pageerror')`, `page.on('requestfailed')`).

- [ ] **Step 5: Run it, and watch it fail once on purpose**

Run with the backend deliberately down and confirm the failure is legible — this is the row most likely to fail confusingly later.

- [ ] **Step 6: Register (`full`, needs `['playwright-browser','docker']`, after `build`), regenerate, commit**

---

## Phase 5 — The hooks

### Task 18: `node.sh`, `edit-lint`, `batch-typecheck`

**Files:**
- Create: `.claude/hooks/node.sh`, `.claude/hooks/edit-lint.mjs`, `.claude/hooks/batch-typecheck.mjs`, `.claude/settings.json`

- [ ] **Step 1: Port `node.sh` verbatim in structure**

Read the reference (139 lines). It uses **only shell built-ins** for path and version handling — an earlier version called `dirname`/`tr`/`sed`/`ls`, and with a hostile PATH those are themselves missing: `$ROOT` collapsed to empty, node was handed `/scripts/verify/run.mjs`, and the gate reported its own inability to start as a red tree. Keep: the `.nvmrc` read via the `read` built-in, the CRLF strip, `major_of` parsing nvm paths rather than spawning node five times, the `consider()` function taking one quoted argument, `VERIFY_HOOK_WARN` exported for the `.mjs` hooks to carry, and the loud fail-open when no interpreter is found.

Change only: the repo-root sanity check looks for `scripts/verify` (same as reference) — verify it still matches this layout.

- [ ] **Step 2: Port `edit-lint.mjs` with workspace resolution**

Read the reference (107 lines). Keep the `realpathSync` **before** `path.relative` (a symlink inside the repo pointing outside it was followed, and oxlint reported on the target's contents), the NUL-byte guard, and the single-`emit` protocol.

Change: resolve which workspace the edited path is in and run that workspace's eslint:

```javascript
/** @param {string} rel @returns {string | null} */
function workspaceOf(rel) {
  if (rel.startsWith('backend/')) return 'backend'
  if (rel.startsWith('frontend/')) return 'frontend'
  return null // scripts/ and .claude/ are covered by batch-typecheck, not eslint
}
```

Run `npx eslint --max-warnings=0 <path-relative-to-workspace>` with `cwd` set to the workspace root.

- [ ] **Step 3: Port `batch-typecheck.mjs` with project resolution**

Read the reference (171 lines). Change: map the touched files to projects and run only those — `backend/` → `tsc -p backend/tsconfig.json --noEmit`; `frontend/` → `tsc -b` in `frontend/`; `scripts/` or `.claude/hooks/` → `tsc -p tsconfig.scripts.json`.

- [ ] **Step 4: Write `.claude/settings.json`**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/node.sh \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/edit-lint.mjs", "timeout": 60, "statusMessage": "eslint on the edited file…" },
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/node.sh \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/batch-typecheck.mjs", "timeout": 180, "statusMessage": "typecheck on the touched projects…" }
        ]
      }
    ]
  }
}
```

`chmod +x .claude/hooks/node.sh`.

- [ ] **Step 5: Drive both hooks with synthetic stdin**

```bash
echo '{"tool_input":{"file_path":"backend/src/main.ts"}}' | .claude/hooks/node.sh .claude/hooks/edit-lint.mjs
echo '{"tool_input":{"file_path":"/etc/passwd"}}' | .claude/hooks/node.sh .claude/hooks/edit-lint.mjs
```
Expected: the first exits 0 with either no output or advisory JSON; the second exits 0 **silently**, having refused a path outside the repo. Exactly one JSON object may ever reach stdout.

- [ ] **Step 6: Commit**

---

### Task 19: `stop-gate.mjs` — the blocking layer

**Files:**
- Create: `.claude/hooks/stop-gate.mjs`, `.claude/hooks/stop-gate.test.mjs`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Read the reference in full**

`/tmp/claude-1000/-home-dz-work-yagoda-starter/verify-reference/.claude/hooks/stop-gate.mjs`, 368 lines, **every comment**. The comments are the record of what has already gone wrong; the code is only their consequence.

- [ ] **Step 2: Write the failing test**

Drive the hook with synthetic stdin and a stubbed runner:

1. Green tree → exit 0, no block.
2. Red tree → exit 2, stderr carries the failure table, stdout carries exactly one JSON object with `hookSpecificOutput.decision === 'block'` **and** top-level `decision === 'block'`, and **no** `continue: false`.
3. Third consecutive block on the same `prompt_id` → exit 0 with a `systemMessage` instructing the agent to state the red result out loud.
4. No `prompt_id` → exit 0, reports, does not block (an uncapped block deadlocks the agent against the gate).
5. Unwritable counter directory → exit 0, does not block, says why.
6. Runner produces unparseable output → exit 0, fails **open and loudly**; the message must say the turn is UNVERIFIED and must not claim the tree is red.
7. Green with a `SKIPPED` row → exit 0, and the `systemMessage` names the skipped rows.

- [ ] **Step 3: Run it and watch it fail**

- [ ] **Step 4: Port**

Translate to English, keep every behaviour. Non-negotiable, all learned the hard way:

- `safeId()` strips the `prompt_id` to `[A-Za-z0-9_-]`, max 64 — used raw as a path component, a value containing `..` truncates an arbitrary file.
- **Never** fall back to `session_id` for the counter.
- The stdin-timeout **sentinel** distinguishes slow from empty.
- `capped()` is a **byte** cap (a single failing check can emit one 65KB JSON line, and the detail is repeated across fields — 361KB was measured in review).
- Emit `decision: block` in both shapes **and** exit 2 with the reason on stderr; emit **no** `continue: false` and no `stopReason`.
- Fail closed on red checks; fail open and loudly on the gate's own errors.
- The failure table's closing line: *fix the cause, not the check — widening a baseline, relaxing a rule or lowering a floor is not turning green (CLAUDE.md, rule 3)*.

- [ ] **Step 5: Run the tests and watch them pass**

- [ ] **Step 6: Register the hook and prove it blocks for real**

Add the `Stop` entry to `.claude/settings.json` with `timeout: 300`. Then break something on purpose (add a syntax error to a backend file), run `npm run verify`, confirm it is red, and confirm the gate's failure table is legible. Undo.

- [ ] **Step 7: Commit**

---

## Phase 6 — CI

### Task 20: Rebuild `ci.yml` on the registry

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (record the required-check rename)

- [ ] **Step 1: Read what is being replaced**

`.github/workflows/ci.yml` today has four jobs: `changes` (Docker path filter), `checks`, `db-checks`, `docker`. Read all of it before deleting any of it — the comments record real decisions (why `concurrency` never cancels `main`, why the detector is fail-closed, why Redis is present for one suite).

- [ ] **Step 2: Write the new workflow**

One job, `verify`. Keep from the old file: the `concurrency` block (cancel PR runs, never `main`), `permissions: contents: read`, and `timeout-minutes`. Replace the four jobs with:

```yaml
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0            # the `migrations` row diffs against origin/main

      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc # the same file .claude/hooks/node.sh reads
          cache: npm

      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: docker compose up -d --wait postgres redis
      - run: npm run verify:ci

      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: verify-report
          path: .verify/last-run.json
          if-no-files-found: warn
```

Coverage floors go in the job's `env:` with the comment block explaining that they live here and nowhere else, that locally they read as 0 so the number is reported without gating, that the values were **measured** on a stated date, and that the ratchet turns one way — lowering a floor must be a visible diff in this file.

`--no-skip` (inside `verify:ci`) means a missing browser, a missing daemon or a missing database is a **red run**, not a quietly narrower one. That is why the `playwright install` and `docker compose` steps are load-bearing rather than conveniences.

- [ ] **Step 3: Confirm nothing was silently dropped**

Check each deleted job against the new one and state where its coverage went: `checks` → the `lint`/`typecheck`/`test`/`build` rows; `db-checks` → the `test:db` row (with its env now coming from Compose); `docker` → the `docker` row; `changes` → **deleted deliberately**, images now build on every PR. Write that mapping into the workflow's header comment so the next reader does not have to reconstruct it.

- [ ] **Step 4: Record the required-check rename as an open follow-up**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`: the required status check must be renamed `checks`/`db-checks`/`docker` → `verify` in repository settings; until then PRs are guarded by context names that no longer exist. Include the `gh api` command and note it needs admin rights.

- [ ] **Step 5: Run the whole thing locally as CI would**

```bash
docker compose up -d --wait postgres redis
npm run verify:ci
```
Expected: every row runs; nothing is `SKIPPED` (under `--no-skip` a skip is a failure). **Record the wall-clock time.**

- [ ] **Step 6: Commit**

---

## Final verification

- [ ] `npm run verify:ci` is green with nothing skipped, and the run is timed.
- [ ] `npm run test:verify` — every engine and check test passes. (Not `node --test scripts/verify/`: on Node 24 a bare directory argument is treated as a test *file* and fails, which is a green-looking red — see ledger ruling R5.)
- [ ] `npx tsc -p tsconfig.scripts.json` — the verify layer typechecks itself.
- [ ] `node scripts/verify/checks/memo-drift.mjs` — the table matches the registry.
- [ ] Every row in the generated table has been **seen red at least once**. List any that have not; a row never seen red has not been shown to check anything.
- [ ] The blind-spot footer prints on a green run.
- [ ] Report: the measured fast-tier cost, the measured full-tier cost, every baseline's entry count, and any row cut for being unfalsifiable.
- [ ] `superpowers:requesting-code-review` before opening the PR.
