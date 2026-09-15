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
