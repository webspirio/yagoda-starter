import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { CHECKS, PRECONDITIONS, checkById, inTier, tierCovers } from './registry.mjs'
import { DEFAULT_TIMEOUT_MS } from './run.mjs'

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

test('every `supersedes` names a real check, in a tier that can actually contain it', () => {
  const ids = new Set(CHECKS.map((c) => c.id))
  for (const c of CHECKS) {
    for (const id of c.supersedes ?? []) {
      assert.ok(ids.has(id), `${c.id} supersedes unknown ${id}`)
      assert.notEqual(id, c.id, `${c.id} supersedes itself — that is a deletion, not a subsumption`)
      // A row can only remove another when both are in the same run, so a superseder in a
      // HIGHER tier than its target is the only arrangement that ever does anything: the
      // target keeps running in every tier below. The reverse (a fast row claiming a full
      // one) would be dead configuration — legal to the runner, but never true of any run.
      const target = /** @type {import('./registry.mjs').Check} */ (checkById(id))
      assert.ok(
        inTier(target.tier, c.tier),
        `${c.id} (${c.tier}) supersedes ${id} (${target.tier}), a row no run of its own tier contains`,
      )
    }
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

test('every declared timeoutMs is a positive finite number, and only slow rows declare one', () => {
  const declared = CHECKS.filter((c) => c.timeoutMs !== undefined)
  for (const c of declared) {
    const budget = c.timeoutMs
    assert.equal(typeof budget, 'number', `${c.id}: timeoutMs must be a number`)
    assert.ok(
      Number.isFinite(budget) && Number(budget) > 0,
      `${c.id}: timeoutMs must be finite and positive, got ${budget}`,
    )
    // A budget at or below the runner's own default would SHORTEN a row rather than give it
    // room, which is not what this field is for — see registry.mjs's note. Compared against
    // the IMPORTED default rather than a copy of the number: this assertion used to spell
    // out 120_000 by hand, so lowering the default to 60s would have left it silently
    // asserting against a value the runner no longer used.
    assert.ok(
      Number(budget) > DEFAULT_TIMEOUT_MS,
      `${c.id}: a timeoutMs at or below the runner's own ${DEFAULT_TIMEOUT_MS / 1000}s default gives the row nothing`,
    )
  }
  // Pinned so that adding a seventh is a deliberate edit here, not a side effect. Three
  // joined on 2026-09-16, when the default dropped 120s -> 60s: selfcheck and smoke because
  // neither fitted under it any more (selfcheck had in fact never fitted under the OLD one
  // either, at 67.3s against 120s, which is what prompted the whole re-measure), and audit
  // because its cost is the npm registry's rather than ours — see that row's own note.
  assert.deepEqual(
    declared.map((c) => c.id).sort(),
    ['audit', 'coverage', 'selfcheck', 'smoke', 'test', 'test:db'],
    'the set of rows with their own timeout budget changed — confirm the new one was measured, not guessed',
  )
})

/**
 * THE GAP THIS CLOSES, named by review on 2026-09-15 and worth stating plainly: every row
 * in this registry ends with some version of "this row does not track or re-check its own
 * prose", and until now nothing anywhere in the layer could make a stale NUMBER in a
 * `proves` string red. That is not hypothetical — the `coverage` row claimed router.tsx was
 * absent from the frontend report, which was false when written and survived a deliberate
 * re-measurement pass under a fresh "confirmed empirically" stamp, because no mechanism
 * existed to contradict it.
 *
 * Most claims in this file are prose a machine cannot check. A handful are not: they are
 * counts derivable from the filesystem by the same `git ls-files` net the checks themselves
 * use. Those are pinned here. A tree change that moves one of them now turns THIS test red
 * and forces a re-measurement, instead of quietly aging inside a sentence.
 *
 * Scope, stated so nobody reads more into a green run than it earns: this proves the
 * QUOTED number matches today's tree. It proves nothing about the sentence around it.
 */
const trackedFiles = () =>
  execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)

test('every mechanically derivable count quoted in a proves/blindSpot string still matches the tree', () => {
  const files = trackedFiles()
  const count = (/** @type {RegExp} */ re) => files.filter((f) => re.test(f)).length

  // `.db-spec.ts` ends in `-spec.ts`, not `.spec.ts`, so the two nets are already
  // disjoint — exactly as backend/jest.config.js's own testRegex relies on. Subtracting
  // one from the other (the first version of this line did) double-counts the gap and
  // undercounts the total by the number of db-specs.
  const jestUnit = count(/^backend\/src\/.*\.spec\.ts$/)
  const jestDb = count(/^backend\/src\/.*\.db-spec\.ts$/)
  const vitest = count(/^frontend\/src\/.*\.(test|spec)\.(ts|tsx)$/)
  const nodeTest = count(/^(scripts|\.claude\/hooks)\/.*\.test\.mjs$/)
  const playwright = count(/^e2e\/.*\.spec\.ts$/)
  const shellTest = count(/^scripts\/ci\/.*\.test\.sh$/)
  const collected = jestUnit + jestDb + vitest + nodeTest + playwright + shellTest

  /** @param {string} id @returns {string} */
  const textOf = (id) => {
    const row = checkById(id)
    assert.ok(row, `${id} must exist in the registry`)
    return `${row.proves}\n${row.blindSpot}`
  }

  /** @type {[string, string, string][]} */
  const pinned = [
    ['testfiles', `${collected} files`, 'the total across both candidate nets'],
    [
      'testfiles',
      `jest-unit ${jestUnit}, jest-db ${jestDb}, vitest ${vitest}, node-test ${nodeTest}, ` +
        `playwright ${playwright}, shell-test ${shellTest}`,
      'the per-collector breakdown',
    ],
    // The two `migrations` pins are gone: that row's prose no longer quotes a count at
    // all. A number that is not written cannot be stale, which is the direction every one
    // of these pins is heading — they are replaced wholesale by a class invariant (no
    // hand-written measurement in any prose string) once every row has been rewritten.
    ['test:db', `${jestDb} files match *.db-spec.ts`, 'the db-spec file count'],
    ['test', `all ${jestDb} *.db-spec.ts suites`, 'the db-spec count this row excludes'],
    ['selfcheck', `across ${nodeTest} *.test.mjs files`, "the layer's own test-file count"],
  ]

  for (const [id, quoted, what] of pinned) {
    assert.ok(
      textOf(id).includes(quoted),
      `${id}: ${what} is stale — the tree says "${quoted}", which no longer appears in that ` +
        `row's proves/blindSpot. Re-measure and update the string; do not edit this test to match it.`,
    )
  }
})

test('the runner default still clears every row that inherits it, and that set is pinned', () => {
  // THE PROPERTY THE OTHER TEST CANNOT HOLD. Once both sides import DEFAULT_TIMEOUT_MS,
  // "a declared budget must exceed the default" compares the constant against itself and
  // can no longer notice the default drifting away from what the inheriting rows actually
  // cost. Raised by review of that very change, 2026-09-16.
  //
  // Cold CI readings, run 35011857830 — the coldest full run on record, with an empty
  // Turbo cache. Recorded as DATA, so raising the default without re-measuring is a
  // visible edit to this table rather than a one-character change somewhere else.
  const COLD_MS = {
    lint: 16_900,
    typecheck: 16_700,
    build: 14_600,
    'test:ci-scripts': 6_700,
    deadcode: 2_100,
    migrations: 968,
    seam: 885,
    // 'ratchet:money': 808 -- row removed 2026-09-18 at the user's request; see the note
    // in scripts/verify/baselines/money-rounding.json. The 808ms reading stays in git
    // history rather than here, because a budget for a row that no longer runs would fail
    // the deepEqual below on every run.
    'ratchet:persist': 802,
    secrets: 424,
    // LOCAL readings, not CI ones: both rows were added after run 35011857830 and have
    // never run on a CI runner, so there is no cold CI number to record yet. Measured
    // with `/usr/bin/time -p npm run <script>`, slowest of ten consecutive runs on the
    // laptop. For calibration on the same laptop and the same day, `seam` read 440ms
    // against its 885ms CI entry and `migrations` read 1020ms against its 968ms one, so a
    // CI reading for these two is unlikely to be more than about twice what is recorded
    // here. Replace both with the real cold numbers after the first full CI run.
    documents: 360,
    schema: 350,
    'ratchet:lint-exempt': 216,
    bundle: 188,
    testfiles: 158,
  }

  const inheriting = CHECKS.filter((c) => c.timeoutMs === undefined).map((c) => c.id)

  // A row added later inherits this budget silently. Pinning the set is what forces
  // whoever adds it to measure it first — the same discipline the declared budgets get.
  assert.deepEqual(
    inheriting.slice().sort(),
    Object.keys(COLD_MS).sort(),
    'a row started or stopped inheriting the runner default — measure it cold on CI and record it here',
  )

  const slowest = Math.max(...Object.values(COLD_MS))
  assert.ok(
    DEFAULT_TIMEOUT_MS > slowest * 2,
    `the default (${DEFAULT_TIMEOUT_MS / 1000}s) must clear the slowest inheriting row ` +
      `(${slowest / 1000}s) with real headroom — it is a hang detector, not a performance gate`,
  )
  // And the other direction, which is the one review actually asked for: a default raised
  // far past its own basis stops detecting anything. 10x the worst reading is the line.
  assert.ok(
    DEFAULT_TIMEOUT_MS < slowest * 10,
    `the default (${DEFAULT_TIMEOUT_MS / 1000}s) is more than 10x the slowest row that ` +
      `relies on it (${slowest / 1000}s) — re-measure, or give the slow rows their own budget`,
  )
})

/**
 * THE ASSERTION THAT REPLACES `ratchet:money`.
 *
 * With the money scanner gone, backend/eslint.config.mjs's `files` array is the ONLY net
 * standing between a `price * kg` and a frozen receipt. A hand-maintained list is exactly
 * the artefact this layer refuses to trust — so it is not read, it is CHECKED, against the
 * entities that declare which modules own money.
 *
 * Both sides are derived. Nothing here names a module, so nothing here can go stale.
 */
const backendFile = (/** @type {string} */ rel) =>
  readFileSync(path.resolve(import.meta.dirname, '..', '..', rel), 'utf8')

/** Module directories under backend/src whose entity declares a `numeric` column. */
function modulesOwningMoneyColumns() {
  const files = execFileSync('git', ['ls-files', 'backend/src'], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.entity.ts'))
  /** @type {Set<string>} */
  const mods = new Set()
  for (const f of files) {
    if (/type:\s*'numeric'/.test(backendFile(f))) mods.add(f.split('/')[2])
  }
  return mods
}

/** The module directories backend/eslint.config.mjs's money `files` array reaches. */
async function modulesUnderTheMoneyBan() {
  const cfg = (await import('../../backend/eslint.config.mjs')).default
  const block = cfg.find(
    (/** @type {any} */ b) => b?.rules?.['no-restricted-syntax'] && Array.isArray(b.files),
  )
  assert.ok(block, 'backend/eslint.config.mjs no longer has a no-restricted-syntax block with `files`')
  /** @type {string[]} */
  const entries = /** @type {any} */ (block).files
  return { entries, dirs: new Set(entries.map((f) => f.split('/')[1])) }
}

test('every backend module owning a money column is inside the eslint money ban', async () => {
  const owning = modulesOwningMoneyColumns()
  const { dirs } = await modulesUnderTheMoneyBan()
  const unguarded = [...owning].filter((m) => !dirs.has(m)).sort()
  assert.deepEqual(
    unguarded,
    [],
    `these backend modules declare a \`numeric\` column and are OUTSIDE the money ban in ` +
      `backend/eslint.config.mjs: ${unguarded.join(', ')}. Since ratchet:money was deleted ` +
      'that list is the only net over money arithmetic, so a module outside it is a column ' +
      'guarded by nothing. Add it to `files` — do not delete this test.',
  )
  assert.ok(owning.size > 0, 'derived ZERO modules owning a numeric column — the derivation broke')
})

test('no entry in the money ban matches nothing — a dead glob is a silent hole', async () => {
  const { entries } = await modulesUnderTheMoneyBan()
  const tracked = execFileSync('git', ['ls-files', 'backend/src'], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((f) => f.replace(/^backend\//, ''))
  const dead = entries.filter((g) => !tracked.some((f) => path.matchesGlob(f, g)))
  assert.deepEqual(
    dead,
    [],
    `these money-ban globs match no tracked file: ${dead.join(', ')}. A renamed or deleted ` +
      'module leaves its glob behind, and the ban then silently covers nothing.',
  )
})

test('every workspace defines lint, typecheck and test — turbo skips a workspace that does not', () => {
  // `turbo lint` reports "Tasks: 1 successful, 1 total" and EXITS 0 when a workspace has no
  // lint script. So the `lint` row can be green having linted one workspace — and `lint` is
  // now the only money net, which makes that a money problem rather than hygiene.
  const root = JSON.parse(backendFile('package.json'))
  for (const ws of root.workspaces) {
    const pkg = JSON.parse(backendFile(`${ws}/package.json`))
    for (const task of ['lint', 'typecheck', 'test']) {
      assert.ok(
        pkg.scripts?.[task],
        `${ws}/package.json has no "${task}" script — \`turbo ${task}\` will skip that ` +
          'workspace silently and the row will still be green',
      )
    }
  }
})
