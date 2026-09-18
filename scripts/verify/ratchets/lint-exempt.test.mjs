import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'ratchets', 'lint-exempt.mjs')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'lint-exempt.json')
const BACKEND_SRC = path.join(ROOT, 'backend', 'src')
const BACKEND_CONFIG = path.join(ROOT, 'backend', 'eslint.config.mjs')
const FRONTEND_CONFIG = path.join(ROOT, 'frontend', 'eslint.config.mjs')
const CN_TEST = path.join(ROOT, 'frontend', 'src', 'shared', 'lib', 'cn.test.ts')

/** A valid, non-stub reason — well over the 30-character floor. @type {string} */
const VALID_TEST_REASON = 'Test-only baseline entry exercising the ratchet mechanism itself, not a real exemption.'

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
 * mutation is needed here — same idiom as seam-boundary.test.mjs's writeFixture.
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
 * Adds one entry to the baseline's `entries` array and returns the ORIGINAL file content,
 * for restoring in a `finally` — same idiom as secret-boundary.test.mjs's
 * addConfirmedFakeValueEntry.
 *
 * @param {{ key: string, added?: string, reason: string }} entry
 * @returns {string}
 */
function addBaselineEntry(entry) {
  const original = readFileSync(BASELINE, 'utf8')
  const baseline = JSON.parse(original)
  baseline.entries = [...baseline.entries, { key: entry.key, added: entry.added ?? '2026-09-10', reason: entry.reason }]
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  return original
}

test('the real tree is green against the committed baseline', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, /14 lint exemptions on record/)
})

test('a new eslint-disable-next-line anywhere in backend/src is caught as a NEW EXEMPTION', () => {
  const rel = 'users/zz-lint-exempt-fixture-new.ts'
  const cleanup = writeFixture(
    rel,
    [
      'export function zzLintExemptFixture(): unknown {',
      '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
      '  const value: any = null;',
      '  return value;',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW EXEMPTION/)
    assert.match(res.out, /users\/zz-lint-exempt-fixture-new\.ts:2/)
    assert.match(res.out, /@typescript-eslint\/no-explicit-any/)
  } finally {
    cleanup()
  }
})

test('removing an existing disable comment makes the check red too — the stale baseline entry must be deleted', () => {
  const original = readFileSync(CN_TEST, 'utf8')
  try {
    const marker = '    // eslint-disable-next-line no-constant-binary-expression\n'
    assert.match(original, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'fixture assumes cn.test.ts still carries this exact comment line')
    const mutated = original.replace(marker, '')
    assert.notEqual(mutated, original)
    writeFileSync(CN_TEST, mutated)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE ENTRY/)
    assert.match(res.out, /frontend\/src\/shared\/lib\/cn\.test\.ts:6:eslint-disable-next-line:no-constant-binary-expression/)
  } finally {
    writeFileSync(CN_TEST, original)
  }
})

test('a baseline entry whose reason is "TODO" makes the checker itself exit red, before any comparison', () => {
  const originalBaseline = addBaselineEntry({
    key: 'zz-fixture-file.ts:1:eslint-disable:zz-fixture-rule',
    reason: 'TODO',
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /baseline itself is invalid/)
    assert.match(res.out, /reason/i)
    assert.match(res.out, /30 characters/)
    // The stub-reason gate runs BEFORE the new/stale comparison — neither of those words
    // should appear when this is what failed.
    assert.doesNotMatch(res.out, /NEW EXEMPTION/)
    assert.doesNotMatch(res.out, /STALE ENTRY/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})

test('a baseline entry whose reason is shorter than 30 characters is rejected', () => {
  const shortReason = 'x'.repeat(29) // deliberately one character under the 30-character floor
  assert.equal(shortReason.length, 29)
  const originalBaseline = addBaselineEntry({
    key: 'zz-fixture-file.ts:1:eslint-disable:zz-fixture-rule',
    reason: shortReason,
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /baseline itself is invalid/)
    assert.match(res.out, /30 characters/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})

test('a genuinely reasoned, dated new baseline entry for a fixture that does not exist in the tree is reported STALE, not accepted on faith', () => {
  // Proves the ratchet does not just check "is the reason long enough" and stop there — an
  // entry can be perfectly well-formed and still wrong, because nothing on disk produces it.
  const originalBaseline = addBaselineEntry({
    key: 'zz-fixture-file-that-does-not-exist.ts:1:eslint-disable:zz-fixture-rule',
    reason: VALID_TEST_REASON,
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE ENTRY/)
    assert.match(res.out, /zz-fixture-file-that-does-not-exist\.ts/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})

test('a new `ignores` glob added to backend/eslint.config.mjs is caught as a NEW EXEMPTION', () => {
  const original = readFileSync(BACKEND_CONFIG, 'utf8')
  try {
    // The line is FOUND, not hard-coded. This test pinned both the exact glob list
    // ("{ ignores: ['dist/', 'node_modules/'] },") and the literal line number (:7:) until
    // 2026-09-15, when adding `coverage/` to that list — and a comment above it — moved it
    // to line 13 and turned this test red for a reason that had nothing to do with the
    // ratchet. What the test is actually for is the BEHAVIOUR: widen a bundled `ignores`
    // and the check must report the old key stale and the new one unrecognised.
    const lines = original.split('\n')
    const lineIndex = lines.findIndex((l) => /^\s*\{ ignores: \[/.test(l))
    assert.notEqual(lineIndex, -1, 'backend/eslint.config.mjs must carry an `ignores` line')
    const lineNumber = lineIndex + 1
    const mutated = lines
      .map((l, i) => (i === lineIndex ? l.replace(/\] \},\s*$/, ", 'zz-fixture/'] },") : l))
      .join('\n')
    assert.notEqual(mutated, original)
    writeFileSync(BACKEND_CONFIG, mutated)
    const res = run()
    assert.equal(res.status, 1, res.out)
    // Bundling changed the whole glob list for that line, so the old combined key is gone
    // (STALE) and the new combined key is unrecognised (NEW EXEMPTION) — both fire at once.
    // See the check's blindSpot: one glob added to a bundled `ignores` looks like the old
    // entry removed plus a new, bigger one added.
    assert.match(res.out, /NEW EXEMPTION/)
    assert.match(res.out, /STALE ENTRY/)
    assert.match(res.out, new RegExp(`backend/eslint\\.config\\.mjs:${lineNumber}:ignores`))
    assert.match(res.out, /zz-fixture\//)
  } finally {
    writeFileSync(BACKEND_CONFIG, original)
  }
})

test('a rule newly pinned to \'off\' in frontend/eslint.config.mjs is caught as a NEW EXEMPTION', () => {
  const original = readFileSync(FRONTEND_CONFIG, 'utf8')
  try {
    const marker = "plugins: { 'react-refresh': reactRefresh },"
    assert.match(original, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const mutated = original.replace(marker, `${marker}\n    rules: { 'zz-fixture/rule': 'off' },`)
    assert.notEqual(mutated, original)
    writeFileSync(FRONTEND_CONFIG, mutated)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW EXEMPTION/)
    assert.match(res.out, /rule-off/)
    assert.match(res.out, /zz-fixture\/rule/)
  } finally {
    writeFileSync(FRONTEND_CONFIG, original)
  }
})
