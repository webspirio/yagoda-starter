import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  budgetFor,
  classify,
  dropSuperseded,
  envKey,
  isBlocking,
  parseArgs,
  reportIsFresh,
  selectChecks,
} from './run.mjs'
import { checkById } from './registry.mjs'

/**
 * Shape of the `reportIsFresh` fixtures below, typed locally so the pinned literals (e.g.
 * `tier: 'fast'`) are checked against the same literal unions run.mjs itself uses, instead
 * of widening to plain `string`.
 * @typedef {object} StoredReportFixture
 * @property {number} schema
 * @property {string} sourceHash
 * @property {boolean} ok
 * @property {'fast'|'full'} tier
 * @property {boolean} noSkip
 * @property {string} envKey
 * @property {{ only: string[] | null, afterDepsFullyEvaluated: boolean }} scope
 */
/**
 * @typedef {object} FreshnessOptsFixture
 * @property {'fast'|'full'} tier
 * @property {boolean} noSkip
 * @property {string[] | null} only
 */

/**
 * @param {number} code
 * @param {string} [out]
 * @param {string} [err]
 * @returns {{ outcome: 'exited', code: number, out: string, err: string, ms: number }}
 */
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
  // Built from the REAL envKey() rather than a hard-coded '' -- this suite runs inside
  // .github/workflows/ci.yml's `verify` job (Task 20), which sets real COVERAGE_* env vars
  // for the whole job, so a fixture assuming a bare environment would fail the very first
  // assertion below the moment CI actually sets them. See envKey()'s own doc comment.
  const currentEnvKey = envKey()
  /** @type {StoredReportFixture} */
  const green = {
    schema: 1,
    sourceHash: 'abc',
    ok: true,
    tier: 'full',
    noSkip: true,
    envKey: currentEnvKey,
    scope: { only: null, afterDepsFullyEvaluated: true },
  }
  /** @type {FreshnessOptsFixture} */
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
  assert.equal(reportIsFresh({ ...green, envKey: `${currentEnvKey} COVERAGE_X=1` }, 'abc', opts), false,
    'different coverage floors are a different verdict')
})

test("a row's own timeoutMs wins over the run-wide default, and rows without one keep it", () => {
  // budgetFor is the whole mechanism: three rows blew through the 120s default on CI's
  // first real run of verify:ci (2026-09-15) and this is what gives them room without
  // loosening every other row at the same time.
  const opts = { timeoutMs: 120_000 }
  assert.equal(budgetFor({ timeoutMs: 600_000 }, opts), 600_000)
  assert.equal(budgetFor({}, opts), 120_000)
  // An explicit --timeout-ms moves the default only; a declared budget is not shortened.
  assert.equal(budgetFor({ timeoutMs: 600_000 }, { timeoutMs: 5_000 }), 600_000)
  assert.equal(budgetFor({}, { timeoutMs: 5_000 }), 5_000)
  // And the three real rows carry a budget the runner will actually reach for.
  for (const id of ['test', 'coverage', 'test:db']) {
    const row = checkById(id)
    assert.ok(row, `${id} must exist in the registry`)
    assert.ok(
      budgetFor(row, opts) > 120_000,
      `${id} must not fall back to the 120s default — that is what CI died on`,
    )
  }
})

test('--exclude drops rows, --only cannot be combined with it, and a narrowed green is never reused', () => {
  const opts = parseArgs(['--tier', 'full', '--exclude', 'smoke,audit'])
  assert.deepEqual(opts.exclude, ['smoke', 'audit'])
  assert.equal(opts.only, null)

  // Unknown ids are an error in BOTH directions. A typo in --exclude excludes nothing, which
  // is the harmless direction — but it still misreports scope, so it is rejected like any other.
  assert.throws(() => parseArgs(['--exclude', 'no-such-check']), /unknown check id/)
  assert.throws(() => parseArgs(['--only', 'lint', '--exclude', 'smoke']), /cannot be combined/)

  // A report that dropped rows is not a verdict about the tree, exactly as a --only report
  // is not. The pre-push gate runs with --exclude, so without this its green would be
  // replayed for a later run that asked for everything.
  /** @type {import('./run.mjs').StoredReport} */
  const stored = {
    schema: 1,
    sourceHash: 'h',
    ok: true,
    tier: /** @type {'full'} */ ('full'),
    noSkip: false,
    envKey: envKey(),
    scope: { only: null, exclude: ['smoke'], afterDepsFullyEvaluated: true },
  }
  assert.equal(reportIsFresh(stored, 'h', { tier: 'fast', noSkip: false }), false)
  // The identical report without the exclusion IS reusable — proving the line above is what
  // refuses it, not some other mismatch in the fixture.
  assert.equal(
    reportIsFresh({ ...stored, scope: { ...stored.scope, exclude: null } }, 'h', {
      tier: 'fast',
      noSkip: false,
    }),
    true,
  )
})

test('dropSuperseded removes a row only when its superseder is standing in the same run', () => {
  const { selected, superseded } = dropSuperseded([
    { id: 'test' },
    { id: 'coverage', supersedes: ['test'] },
  ])
  assert.deepEqual(
    selected.map((c) => c.id),
    ['coverage'],
  )
  assert.deepEqual(superseded, [{ id: 'test', by: 'coverage' }])

  // The superseder absent — narrowed away by --exclude, or simply in a higher tier — and
  // nothing is dropped. This is the whole safety property: a row can only ever be removed
  // by a row that is actually going to run beside it.
  const alone = dropSuperseded([{ id: 'test' }])
  assert.deepEqual(
    alone.selected.map((c) => c.id),
    ['test'],
  )
  assert.deepEqual(alone.superseded, [])
})

test('dropSuperseded fails OPEN: a self-reference or a cycle runs both rows, never neither', () => {
  const self = dropSuperseded([{ id: 'a', supersedes: ['a'] }])
  assert.deepEqual(
    self.selected.map((c) => c.id),
    ['a'],
  )

  // Two rows each claiming to subsume the other would otherwise delete the pair and report
  // a green over an empty run. Running both is the harmless direction, and the only one.
  const cycle = dropSuperseded([
    { id: 'a', supersedes: ['b'] },
    { id: 'b', supersedes: ['a'] },
  ])
  assert.deepEqual(
    cycle.selected.map((c) => c.id),
    ['a', 'b'],
  )
  assert.deepEqual(cycle.superseded, [])
})

test('a full run drops `test` for `coverage`; fast, --exclude coverage and --only put it back', () => {
  const idsFor = (/** @type {string[]} */ argv) => selectChecks(parseArgs(argv)).selected.map((c) => c.id)

  // The registry pair this mechanism exists for: `coverage` runs the identical jest/vitest
  // suites under instrumentation, so a full run that also ran `test` executed every test in
  // this repo twice — 220.4s + 254.6s on CI run 34998136933.
  const full = selectChecks(parseArgs(['--tier', 'full']))
  assert.ok(full.selected.some((c) => c.id === 'coverage'))
  assert.ok(!full.selected.some((c) => c.id === 'test'))
  assert.deepEqual(full.superseded, [{ id: 'test', by: 'coverage' }])

  // `coverage` is full-tier, so a fast run never contains it and `test` is the only thing
  // running the suites at all. Dropping it here would leave the fast tier testing nothing.
  assert.ok(idsFor(['--tier', 'fast']).includes('test'))

  // verify:prepush's exact flags. It excludes `coverage` (46s locally, floors CI-only), so
  // this is the case where superseding MUST give way or every push would be gated on a tier
  // that runs no tests whatsoever.
  assert.ok(idsFor(['--tier', 'full', '--exclude', 'smoke,coverage,audit']).includes('test'))

  assert.deepEqual(idsFor(['--only', 'test']), ['test'])
})

test('the pre-push gate\'s --exclude list agrees across all three places that spell it out', () => {
  // The list lives in package.json's `verify:prepush` and TWICE in .githooks/pre-push (the
  // node.sh branch and the bare-node fallback). parseArgs REJECTS an unknown id, so a row
  // renamed or deleted without updating all three does not quietly widen the gate — it
  // blocks every push with `unknown check id(s) in --exclude`. That is exactly how deleting
  // the `docker` row announced itself on 2026-09-15, after the npm script had been updated
  // and the hook had not, and this test is why it cannot happen a second time silently.
  const root = new URL('../../', import.meta.url)
  const script = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts[
    'verify:prepush'
  ]
  const hook = readFileSync(new URL('.githooks/pre-push', root), 'utf8')

  const lists = [...`${script}\n${hook}`.matchAll(/--exclude\s+(\S+)/g)].map((m) => m[1])
  assert.equal(lists.length, 3, `expected 3 --exclude occurrences, found ${lists.length}`)
  assert.equal(new Set(lists).size, 1, `the three lists disagree: ${lists.join(' | ')}`)

  // And every id in it must be a real row, which is the half parseArgs would catch at push
  // time rather than here.
  for (const id of lists[0].split(',')) {
    assert.ok(checkById(id), `${id} is excluded by the pre-push gate but is not a check`)
  }
})
