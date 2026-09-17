import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'seam-boundary.mjs')
const BACKEND_SRC = path.join(ROOT, 'backend', 'src')

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
 * Writes a fixture file under backend/src and returns a cleanup function. The check reads
 * `git ls-files -c -o --exclude-standard`, which lists an untracked-but-not-ignored file
 * without it ever being `git add`ed — so no git index mutation is needed here at all, and
 * cleanup is a plain `rmSync`.
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

test('the real tree is green', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
})

test('a bare provider literal in a new backend/src/users file is caught, naming the file, line, and LOCAL_PROVIDER', () => {
  const rel = 'users/zz-seam-fixture-literal.ts'
  const cleanup = writeFixture(
    rel,
    ['export function describeProvider(): string {', "  return 'local';", '}', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /users\/zz-seam-fixture-literal\.ts:2/)
    assert.match(res.out, /LOCAL_PROVIDER/)
  } finally {
    cleanup()
  }
})

test('importing the seed from an ordinary backend/src module is caught, naming the file and the specifier', () => {
  const rel = 'users/zz-seam-fixture-seed-import.ts'
  const cleanup = writeFixture(
    rel,
    ["import { devSeed } from '../seed/dev-seed';", '', 'export const useIt = devSeed;', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /users\/zz-seam-fixture-seed-import\.ts:1/)
    assert.match(res.out, /\.\.\/seed\/dev-seed/)
    assert.match(res.out, /backend\/src\/seed/)
  } finally {
    cleanup()
  }
})

test('a re-export of a seed specifier is caught too (not just a named import)', () => {
  const rel = 'users/zz-seam-fixture-seed-reexport.ts'
  const cleanup = writeFixture(rel, ["export { devSeed } from '../seed/dev-seed';", ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-seam-fixture-seed-reexport\.ts:1/)
  } finally {
    cleanup()
  }
})

test('a dynamic import() of the seed is caught', () => {
  const rel = 'users/zz-seam-fixture-seed-dynamic-import.ts'
  const cleanup = writeFixture(
    rel,
    ['export async function load() {', "  return import('../seed/dev-seed');", '}', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-seam-fixture-seed-dynamic-import\.ts:2/)
  } finally {
    cleanup()
  }
})

test('a require() of the seed is caught', () => {
  const rel = 'users/zz-seam-fixture-seed-require.ts'
  const cleanup = writeFixture(rel, ["const devSeed = require('../seed/dev-seed');", 'module.exports = devSeed;', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-seam-fixture-seed-require\.ts:1/)
  } finally {
    cleanup()
  }
})

test('the same provider literal inside backend/src/migrations/ stays green (a migration is frozen by definition)', () => {
  const rel = 'migrations/zz-seam-fixture-migration.ts'
  const cleanup = writeFixture(
    rel,
    ['export function frozenProviderValue(): string {', "  return 'local';", '}', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('the same provider literal inside a *.spec.ts file stays green', () => {
  const rel = 'users/zz-seam-fixture.spec.ts'
  const cleanup = writeFixture(
    rel,
    ["test('uses the provider value', () => {", "  expect('local').toBe('local');", '});', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('the same provider literal inside a *.db-spec.ts file stays green', () => {
  const rel = 'users/zz-seam-fixture.db-spec.ts'
  const cleanup = writeFixture(
    rel,
    ["test('uses the provider value', () => {", "  expect('local').toBe('local');", '});', ''].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('an ordinary import from the seed inside seed/ itself stays green', () => {
  const rel = 'seed/zz-seam-fixture-internal-import.ts'
  const cleanup = writeFixture(rel, ["import { devSeed } from './dev-seed';", '', 'export const useIt = devSeed;', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('a bare package specifier that merely contains the word seed is never mistaken for a local path', () => {
  const rel = 'users/zz-seam-fixture-bare-specifier.ts'
  // Not relative (`./`/`../`) — a bare package-shaped specifier must never be resolved as
  // a filesystem path, however much it looks like it names something under seed/.
  const cleanup = writeFixture(rel, ["import { x } from 'seed-of-doubt';", '', 'export const y = x;', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('a string literal that merely contains "local" as a substring is not a finding (AST exact match, not a regex)', () => {
  const rel = 'users/zz-seam-fixture-substring.ts'
  const cleanup = writeFixture(
    rel,
    [
      '// A comment mentioning local is not a finding either.',
      "export const message = 'this runs locally, not remotely';",
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

test('a relative specifier that resolves elsewhere in backend/src (not into seed/) stays green', () => {
  const rel = 'users/zz-seam-fixture-unrelated-relative-import.ts'
  const cleanup = writeFixture(rel, ["import { LOCAL_PROVIDER } from './user-identity.entity';", '', 'export const p = LOCAL_PROVIDER;', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})
