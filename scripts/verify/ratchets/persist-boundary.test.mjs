import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'ratchets', 'persist-boundary.mjs')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'persist-boundary.json')
const FRONTEND_SRC = path.join(ROOT, 'frontend', 'src')

/** @returns {{ status: number, out: string }} */
function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8' }) }
  } catch (err) {
    // Cast needed for `npx tsc -p tsconfig.scripts.json` — same idiom as
    // money-rounding.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * Writes a fixture file under frontend/src and returns a cleanup function. `git ls-files -c
 * -o --exclude-standard` (what the check uses to enumerate files) lists an
 * untracked-but-not-ignored file without it ever being `git add`ed, so no git index mutation
 * is needed — same idiom as money-rounding.test.mjs's writeFixture.
 *
 * @param {string} relFromFrontendSrc
 * @param {string} content
 * @returns {() => void}
 */
function writeFixture(relFromFrontendSrc, content) {
  const abs = path.join(FRONTEND_SRC, relFromFrontendSrc)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return () => rmSync(abs, { force: true })
}

/**
 * Adds one entry to the baseline's `entries` array. Returns the ORIGINAL file content, for
 * restoring in a `finally` — same idiom as money-rounding.test.mjs's addBaselineEntry.
 *
 * @param {{ key: string, added?: string, reason: string }} entry
 * @returns {string}
 */
function addBaselineEntry(entry) {
  const original = readFileSync(BASELINE, 'utf8')
  const baseline = JSON.parse(original)
  baseline.entries = [
    ...baseline.entries,
    { key: entry.key, added: entry.added ?? '2026-09-10', reason: entry.reason },
  ]
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  return original
}

const VALID_TEST_REASON = 'Test-only baseline entry exercising the ratchet mechanism itself, not a real exemption.'

test('the real tree is green — all five localStorage/sessionStorage files stay guarded, narrowed, and match the allowlist', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, /10 localStorage\/sessionStorage access\(es\) across 4 file\(s\)/)
  assert.match(res.out, /4 getItem\(\) read\(s\), all narrowed or opaque/)
  assert.match(res.out, /isPersistableKey's allowlist matches .* exactly \(1 key\(s\)/)
  assert.match(res.out, /1 scope exclusion\(s\) still live/)
})

test('an unguarded localStorage.getItem outside try/catch is RED (brief scenario 2)', () => {
  const rel = 'shared/lib/zz-persist-fixture-unguarded.ts'
  const cleanup = writeFixture(
    rel,
    ["export function unguardedRead(): string | null {", "  return localStorage.getItem('zz-fixture-unguarded-key');", '}', ''].join(
      '\n',
    ),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 1 — UNGUARDED ACCESS/)
    assert.match(res.out, /zz-persist-fixture-unguarded\.ts:2/)
  } finally {
    cleanup()
  }
})

test('a storage read inside try/catch that is cast straight into a return, with no runtime narrowing, is RED (brief scenario 3)', () => {
  const rel = 'shared/lib/zz-persist-fixture-cast.ts'
  const cleanup = writeFixture(
    rel,
    [
      "type FixtureMode = 'a' | 'b';",
      '',
      'export function readMode(): FixtureMode {',
      '  try {',
      "    return localStorage.getItem('zz-fixture-mode-key') as FixtureMode;",
      '  } catch {',
      "    return 'a';",
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 2 — UNNARROWED READ/)
    assert.match(res.out, /zz-persist-fixture-cast\.ts:5/)
    assert.match(res.out, /cast .*as.*<T>.* directly into a return with no runtime narrowing/)
  } finally {
    cleanup()
  }
})

test('a storage read inside try/catch, assigned to a local and used structurally (no cast) with no narrowing, is RED', () => {
  const rel = 'shared/lib/zz-persist-fixture-structural.ts'
  const cleanup = writeFixture(
    rel,
    [
      'export function readLength(): number {',
      '  try {',
      "    const raw = localStorage.getItem('zz-fixture-structural-key');",
      '    return raw.length;',
      '  } catch {',
      '    return 0;',
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 2 — UNNARROWED READ/)
    assert.match(res.out, /`raw` is used structurally/)
  } finally {
    cleanup()
  }
})

test('the identical read narrowed by a local type predicate declared in the same file stays green (brief scenario 4)', () => {
  const rel = 'shared/lib/zz-persist-fixture-narrowed.ts'
  const cleanup = writeFixture(
    rel,
    [
      "type FixtureMode = 'a' | 'b';",
      '',
      'function isFixtureMode(v: string | null): v is FixtureMode {',
      "  return v === 'a' || v === 'b';",
      '}',
      '',
      'export function readModeSafe(): FixtureMode {',
      '  try {',
      "    const v = localStorage.getItem('zz-fixture-mode-safe-key');",
      "    return isFixtureMode(v) ? v : 'a';",
      '  } catch {',
      "    return 'a';",
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('a bare, uncast passthrough (return storage.getItem(...) directly, used as an opaque string) stays green — same shape as the bearer token and raw drafts', () => {
  const rel = 'shared/lib/zz-persist-fixture-opaque.ts'
  const cleanup = writeFixture(
    rel,
    [
      'export function readOpaque(): string | null {',
      '  try {',
      "    return localStorage.getItem('zz-fixture-opaque-key');",
      '  } catch {',
      '    return null;',
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test("a predicate imported from another file cannot be confirmed and does not count — the read stays RED even though a real predicate exists elsewhere", () => {
  const predicateRel = 'shared/lib/zz-persist-fixture-predicate-source.ts'
  const readerRel = 'shared/lib/zz-persist-fixture-predicate-user.ts'
  const cleanupPredicate = writeFixture(
    predicateRel,
    [
      "export type FixtureMode = 'a' | 'b';",
      'export function isFixtureMode(v: string | null): v is FixtureMode {',
      "  return v === 'a' || v === 'b';",
      '}',
      '',
    ].join('\n'),
  )
  const cleanupReader = writeFixture(
    readerRel,
    [
      "import { isFixtureMode, type FixtureMode } from './zz-persist-fixture-predicate-source';",
      '',
      'export function readModeImported(): FixtureMode {',
      '  try {',
      "    const v = localStorage.getItem('zz-fixture-mode-imported-key');",
      "    return isFixtureMode(v) ? v : 'a';",
      '  } catch {',
      "    return 'a';",
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 2 — UNNARROWED READ/)
    assert.match(res.out, /zz-persist-fixture-predicate-user\.ts/)
  } finally {
    cleanupReader()
    cleanupPredicate()
  }
})

test('adding a second key to isPersistableKey\'s allowlist without a baseline update is RED (brief scenario 5)', () => {
  const rel = 'shared/api/zz-persist-fixture-decoy.ts'
  const cleanup = writeFixture(
    rel,
    [
      'export function isPersistableKey(queryKey: readonly unknown[]): boolean {',
      '  const [head] = queryKey;',
      "  return head === 'me' || head === 'zz-fixture-extra-key';",
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 3 — NEW KEY/)
    assert.match(res.out, /"zz-fixture-extra-key"/)
  } finally {
    cleanup()
  }
})

test('a baseline allowlist entry whose key no longer exists in the code is RED — both directions (brief scenario 6)', () => {
  const originalBaseline = addBaselineEntry({
    key: 'zz-fixture-stale-key-does-not-exist',
    reason: VALID_TEST_REASON,
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 3 — STALE ENTRY/)
    assert.match(res.out, /zz-fixture-stale-key-does-not-exist/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})

test('a baseline entry whose reason is a stub makes the checker itself exit red, before any comparison', () => {
  const originalBaseline = addBaselineEntry({
    key: 'zz-fixture-stub-reason-key',
    reason: 'TODO',
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /reason/i)
    assert.doesNotMatch(res.out, /RULE 3 — NEW KEY/)
    assert.doesNotMatch(res.out, /RULE 3 — STALE ENTRY/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
  }
})

test('a .tsx file is parsed with the TSX script kind — an unguarded getItem inside a component still reports RED', () => {
  const rel = 'shared/lib/zz-persist-fixture-component.tsx'
  const cleanup = writeFixture(
    rel,
    [
      "export function ZzFixtureComponent() {",
      "  const value = localStorage.getItem('zz-fixture-tsx-key');",
      '  return <div>{value}</div>;',
      '}',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RULE 1 — UNGUARDED ACCESS/)
    assert.match(res.out, /zz-persist-fixture-component\.tsx:2/)
  } finally {
    cleanup()
  }
})

test('a *.test.ts file is excluded from the scan entirely, even with an unguarded access', () => {
  const rel = 'shared/lib/zz-persist-fixture.test.ts'
  const cleanup = writeFixture(
    rel,
    ["export function unguardedInTest(): string | null {", "  return localStorage.getItem('zz-fixture-test-file-key');", '}', ''].join(
      '\n',
    ),
  )
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

// --- SELF-CANCELLING SCOPE EXCLUSION (fix round 1) ---
//
// `EXCLUDED_FILES` names `frontend/src/test-setup.ts` as out of rule 1's territory. Per the
// coordinator's ruling, that exclusion must fail the moment its own reason stops holding —
// deleted, renamed, or no longer touching storage unguarded — exactly like a baseline entry
// must. Both directions are proven here by temporarily mutating the real file and restoring
// it in a `finally`, the same idiom every other test in this suite (and in
// money-rounding.test.mjs before it) already uses for baseline/fixture mutation — never a
// change that survives the test.

const TEST_SETUP_ABS = path.join(FRONTEND_SRC, 'test-setup.ts')

test('deleting the excluded file makes its EXCLUDED_FILES entry STALE — there is nothing left to justify excluding', () => {
  const original = readFileSync(TEST_SETUP_ABS, 'utf8')
  rmSync(TEST_SETUP_ABS)
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /SCOPE EXCLUSION STALE/)
    assert.match(res.out, /frontend\/src\/test-setup\.ts/)
    assert.match(res.out, /no longer exists/)
  } finally {
    writeFileSync(TEST_SETUP_ABS, original)
  }
})

test("stripping the excluded file's unguarded storage calls, while leaving the file in place, also makes it STALE", () => {
  const original = readFileSync(TEST_SETUP_ABS, 'utf8')
  const unguardedBlock = 'afterEach(() => {\n  localStorage.clear();\n  sessionStorage.clear();\n});\n'
  assert.ok(
    original.includes(unguardedBlock),
    'fixture assumes test-setup.ts still has this exact afterEach block — update the fixture if it changed',
  )
  const stripped = original.replace(
    unguardedBlock,
    'afterEach(() => {\n  // storage calls removed by persist-boundary.test.mjs — restored in its finally\n});\n',
  )
  writeFileSync(TEST_SETUP_ABS, stripped)
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /SCOPE EXCLUSION STALE/)
    assert.match(res.out, /no longer contains any unguarded/)
  } finally {
    writeFileSync(TEST_SETUP_ABS, original)
  }
})

test('the real tree is green again once both stale-exclusion fixtures are restored', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, /1 scope exclusion\(s\) still live/)
})
