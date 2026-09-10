// @ts-nocheck — test-double literals here are intentionally unannotated (`exited`'s `code`
// param has no default and no type; fixtures like `tier: 'fast'` widen to plain `string`).
// That is normal, idiomatic test code, not a defect to annotate around. run.mjs itself
// stays fully checked under tsconfig.scripts.json; only this file opts out.
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
