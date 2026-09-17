import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'ratchets', 'money-rounding.mjs')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'money-rounding.json')
const BACKEND_SRC = path.join(ROOT, 'backend', 'src')

/** A valid, non-stub reason — well over the 30-character floor. @type {string} */
const VALID_TEST_REASON =
  'Test-only baseline entry exercising the ratchet mechanism itself, not a real exemption.'

/** @returns {{ status: number, out: string }} */
function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8' }) }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as secret-boundary.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * Writes a fixture file under backend/src and returns a cleanup function. `git ls-files -c
 * -o --exclude-standard` (what the check uses to enumerate files) lists an
 * untracked-but-not-ignored file without it ever being `git add`ed, so no git index
 * mutation is needed — same idiom as lint-exempt.test.mjs's writeFixture.
 *
 * @param {string} relFromBackendSrc
 * @param {string} content
 * @returns {() => void}
 */
function writeFixture(relFromBackendSrc, content) {
  const abs = path.join(BACKEND_SRC, relFromBackendSrc)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return () => rmSync(abs, { force: true })
}

/**
 * Adds one entry to the baseline's `entries` array — `key` alone is enough, since it is
 * `file:line:kind` and the checker itself never reads the redundant `file`/`line`/`kind`
 * fields back out for comparison (only `key` and `occurrences` are). Returns the ORIGINAL
 * file content, for restoring in a `finally` — same idiom as lint-exempt.test.mjs's
 * addBaselineEntry.
 *
 * @param {{ key: string, occurrences?: number, added?: string, reason: string }} entry
 * @returns {string}
 */
function addBaselineEntry(entry) {
  const original = readFileSync(BASELINE, 'utf8')
  const baseline = JSON.parse(original)
  const [file, lineStr, kind] = entry.key.split(':')
  baseline.entries = [
    ...baseline.entries,
    {
      key: entry.key,
      file,
      line: Number(lineStr),
      kind,
      occurrences: entry.occurrences ?? 1,
      added: entry.added ?? '2026-09-10',
      reason: entry.reason,
    },
  ]
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  return original
}

test('the real tree is green against the committed baseline', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
  // RE-MEASURED 2026-09-16: 29 -> 40 after main's 43-commit merge brought the crates slice
  // and a second seed module (dev-seed.history.ts) that does its own kopiyka arithmetic.
  // The number stays pinned rather than loosened — going red here is how the merge
  // announced that eleven new arithmetic sites needed reading.
  assert.match(res.out, /40 baselined money\/weight-arithmetic sites/)
})

test('a * between two untyped function parameters is a NEW FINDING (brief scenario 2)', () => {
  const rel = 'users/zz-money-fixture-param-mult.ts'
  const cleanup = writeFixture(
    rel,
    ['export function calc(a, b) {', '  const total = a * b;', '  return total;', '}', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW FINDING/)
    assert.match(res.out, /users\/zz-money-fixture-param-mult\.ts:2 \(\*\)/)
  } finally {
    cleanup()
  }
})

test('a * where both operands are a numeric-literal-initialised identifier and a literal stays green (brief scenario 3)', () => {
  const rel = 'users/zz-money-fixture-literal-mult.ts'
  const cleanup = writeFixture(rel, ['const width = 10;', 'export const px = width * 2;', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('Number(row.amount) is a NEW FINDING (brief scenario 4)', () => {
  const rel = 'users/zz-money-fixture-number-call.ts'
  const cleanup = writeFixture(
    rel,
    [
      'export function readAmount(row: { amount: string }): number {',
      '  return Number(row.amount);',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW FINDING/)
    assert.match(res.out, /users\/zz-money-fixture-number-call\.ts:2 \(Number\)/)
  } finally {
    cleanup()
  }
})

// REPLACES the original brief scenario 5, which asserted the OPPOSITE: that this fixture
// stayed green because src/intakes/ was "eslint's territory". That carve-out was removed on
// 2026-09-15 — eslint's own `files` list had grown from four module trees to eight while
// this ratchet's copy of it had not, and a module dropped from that list would then have
// been policed by neither. Scanning all of backend/src was measured first and adds zero
// findings to the baseline, so the overlap is free and the gap is closed.
test('the identical unsafe pattern inside src/intakes/ is now a finding too — the eslint carve-out is gone (was brief scenario 5)', () => {
  const rel = 'intakes/zz-money-fixture-eslint-territory.ts'
  const cleanup = writeFixture(
    rel,
    ['export function amountOf(price, qty) {', '  return price * qty;', '}', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW FINDING/)
    assert.match(res.out, /intakes\/zz-money-fixture-eslint-territory\.ts:2 \(\*\)/)
  } finally {
    cleanup()
  }
})

test('a partial fix — baseline says 3 occurrences, only 2 remain — is red, not a silent pass (brief scenario 6)', () => {
  const rel = 'users/zz-money-fixture-partial-fix.ts'
  const cleanup = writeFixture(
    rel,
    ['export function calc(b, c) {', '  return (10 * b) + (10 * c);', '}', ''].join('\n'),
  )
  try {
    // The fixture genuinely produces 2 occurrences of the same key (both '*' on line 2).
    // Claiming 3 in the baseline is exactly "two of three cleaned up" from the other
    // direction: the code has fewer sites than the baseline says, so a partial *reduction*
    // must be caught precisely as loudly as a partial fix would be.
    const originalBaseline = addBaselineEntry({
      key: `backend/src/${rel}:2:*`,
      occurrences: 3,
      reason: VALID_TEST_REASON,
    })
    try {
      const res = run()
      assert.equal(res.status, 1, res.out)
      assert.match(res.out, /COUNT CHANGED/)
      assert.match(res.out, new RegExp(`backend/src/${rel}:2:*`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(res.out, /baseline says 3, the tree has 2/)
    } finally {
      writeFileSync(BASELINE, originalBaseline)
    }
  } finally {
    cleanup()
  }
})

test('a baseline entry whose occurrences have all disappeared is STALE, not a silent pass — the entry must be deleted', () => {
  const originalBaseline = addBaselineEntry({
    key: 'backend/src/zz-money-fixture-does-not-exist.ts:1:*',
    occurrences: 1,
    reason: VALID_TEST_REASON,
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE ENTRY/)
    assert.match(res.out, /zz-money-fixture-does-not-exist\.ts:1:\*/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})

test('a locally declared Number() is not mistaken for the global — an imposter is skipped, not flagged', () => {
  const rel = 'users/zz-money-fixture-number-imposter.ts'
  const cleanup = writeFixture(
    rel,
    [
      "function Number(value: unknown): string {",
      "  return String(value);",
      '}',
      'export function label(row: { amount: string }): string {',
      '  return Number(row.amount);',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    // A real global Number(row.amount) here would be a NEW FINDING (see the scenario-4
    // test above with the identical argument shape); the only difference is the local
    // `function Number(...)` declaration, which must suppress it entirely.
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('.toFixed() on a non-literal, non-number-typed expression is a NEW FINDING — the mechanism the real tree carries zero of today', () => {
  const rel = 'users/zz-money-fixture-tofixed.ts'
  const cleanup = writeFixture(
    rel,
    [
      'export function render(row: { amount: string }): string {',
      '  return row.amount.toFixed(2);',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW FINDING/)
    assert.match(res.out, /users\/zz-money-fixture-tofixed\.ts:2 \(toFixed\)/)
  } finally {
    cleanup()
  }
})

test('a baseline entry whose reason is "TODO" makes the checker itself exit red, before any comparison', () => {
  const originalBaseline = addBaselineEntry({
    key: 'backend/src/zz-money-fixture-stub-reason.ts:1:*',
    occurrences: 1,
    reason: 'TODO',
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /baseline itself is invalid/)
    assert.match(res.out, /reason/i)
    // The stub-reason gate runs before the new/stale comparison — neither should appear.
    assert.doesNotMatch(res.out, /NEW FINDING/)
    assert.doesNotMatch(res.out, /STALE ENTRY/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})
