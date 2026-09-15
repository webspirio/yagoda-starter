import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

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

test('every declared timeoutMs is a positive finite number, and only slow rows declare one', () => {
  const declared = CHECKS.filter((c) => c.timeoutMs !== undefined)
  for (const c of declared) {
    const budget = c.timeoutMs
    assert.equal(typeof budget, 'number', `${c.id}: timeoutMs must be a number`)
    assert.ok(
      Number.isFinite(budget) && Number(budget) > 0,
      `${c.id}: timeoutMs must be finite and positive, got ${budget}`,
    )
    // A budget below the 120s default would SHORTEN a row rather than give it room, which
    // is not what this field is for — see registry.mjs's note. If one is ever wanted, this
    // assertion is the place to argue with.
    assert.ok(
      Number(budget) > 120_000,
      `${c.id}: a timeoutMs at or below the runner's own 120s default gives the row nothing`,
    )
  }
  // Pinned so that adding a fourth slow row is a deliberate edit here, not a side effect.
  assert.deepEqual(
    declared.map((c) => c.id).sort(),
    ['coverage', 'test', 'test:db'],
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
  const migrations = count(/^backend\/src\/migrations\/\d/)
  const migrationDbSpecs = count(/^backend\/src\/migrations\/.*\.db-spec\.ts$/)

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
    ['migrations', `holds ${migrations} numbered migrations`, 'the migration count'],
    ['migrations', `and ${migrationDbSpecs} *.db-spec.ts files`, "migrations/'s own db-spec count"],
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
