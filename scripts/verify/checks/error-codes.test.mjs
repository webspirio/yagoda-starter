/**
 * The decision logic is tested as a pure function; the CLI against throwaway git repos.
 * Exactly one test runs against the real repository, with an independently derived lower
 * bound on the backend code count as its discriminator.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { backendCodes, checkErrorCodes } from './error-codes.mjs'
import { fixtureGitEnv, gitEnv } from '../scan-root.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'error-codes.mjs')

/** @param {Record<string, string>} files @returns {string} */
function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'error-codes-'))
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), body)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, env: fixtureGitEnv() })
  return root
}

/** @param {string} [root] */
function run(root) {
  const args = root ? [CHECK, '--root', root] : [CHECK]
  try {
    return { status: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8' }) }
  } catch (err) {
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const B = (/** @type {string[]} */ ...c) => new Set(c)
const ENTRY = (/** @type {string} */ code) => ({ code, date: '2026-10-07', reason: 'a DI token, not an error code' })

test('a backend code nobody on the frontend names is RED; naming it turns it green', () => {
  assert.match(checkErrorCodes(B('LAST_OWNER'), B(), []).problems.join('\n'), /LAST_OWNER.*no frontend reference/)
  assert.deepEqual(checkErrorCodes(B('LAST_OWNER'), B('LAST_OWNER'), []).problems, [])
})

test('a frontend name the backend never produces is RED — the LOGIN_TAKEN drift, from the other side', () => {
  const p = checkErrorCodes(B('LOGIN_TAKEN'), B('LOGIN_TAKEN', 'USER_LOGIN_TAKEN'), []).problems
  assert.deepEqual(p, ['USER_LOGIN_TAKEN: named in frontend source, never produced by backend/src'])
})

test('a baseline entry excuses a name on either side, and goes stale once both sides agree', () => {
  assert.deepEqual(checkErrorCodes(B('REDIS_CLIENT'), B(), [ENTRY('REDIS_CLIENT')]), { problems: [], excused: 1 })
  assert.deepEqual(checkErrorCodes(B(), B('VITE_API_URL'), [ENTRY('VITE_API_URL')]).problems, [])
  assert.match(checkErrorCodes(B('X_Y'), B('X_Y'), [ENTRY('X_Y')]).problems.join(), /stale exception.*X_Y/)
})

// One malformed field per entry, so each assertion fails if its own branch is deleted.
test('a baseline entry with an empty reason is RED', () => {
  const p = checkErrorCodes(B('A_B'), B(), [{ code: 'A_B', date: '2026-10-07', reason: ' ' }]).problems
  assert.ok(p.some((l) => /A_B: "reason" is missing or empty/.test(l)), p.join('\n'))
})

test('a baseline entry with a bad date is RED, even with a reason', () => {
  const p = checkErrorCodes(B('A_B'), B(), [{ code: 'A_B', date: '07.10.2026', reason: 'a DI token' }]).problems
  assert.ok(p.some((l) => /A_B: "date" must be YYYY-MM-DD/.test(l)), p.join('\n'))
})

test('a baseline entry whose code is not a string is RED', () => {
  const p = checkErrorCodes(B(), B(), [{ code: 42, date: '2026-10-07', reason: 'a DI token' }]).problems
  assert.ok(p.some((l) => /42: "code" must be a string/.test(l)), p.join('\n'))
})

test('a baseline that is not an array is RED', () => {
  assert.deepEqual(checkErrorCodes(B(), B(), { code: 'A_B' }), {
    problems: ['scripts/verify/baselines/error-codes.json must be a JSON array'],
    excused: 0,
  })
})

test('CLI: every way a code is written in the backend is seen; comments and tests are not', () => {
  const root = fixture({
    'backend/src/a.service.ts': `throw new X({ code: 'ONE_CODE' }); assertTrimmedName(n, 'name', 'TWO_CODE'); bad('m', 'THREE_CODE')\n// 'COMMENT_CODE'\n`,
    // Shipped: only `.spec.ts` / `.db-spec.ts` are tests, not every name ending in "spec".
    'backend/src/openapi-spec.ts': `export const c = 'OPENAPI_CODE'\n`,
    'backend/src/a.service.spec.ts': `expect(code).toBe('SPEC_ONLY')\n`,
    'backend/src/a.db-spec.ts': `expect(code).toBe('DB_SPEC_ONLY')\n`,
    'backend/src/testing/h.ts': `export const t = 'TESTING_ONLY'\n`,
    'backend/src/seed/s.ts': `export const s = 'SEED_ONLY'\n`,
    'backend/src/migrations/1-x.ts': `const s = 'MIGRATION_ONLY'\n`,
    'frontend/src/m.ts': `export const M = { ONE_CODE: 'k', TWO_CODE: 'k' }\n`,
  })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /THREE_CODE/)
    assert.match(r.out, /OPENAPI_CODE/)
    // Named on the frontend, so silence here means the backend scan saw both spellings.
    assert.doesNotMatch(r.out, /ONE_CODE|TWO_CODE/)
    assert.doesNotMatch(r.out, /COMMENT_CODE|SPEC_ONLY|TESTING_ONLY|SEED_ONLY|MIGRATION_ONLY/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: no backend codes refuses a verdict', () => {
  const root = fixture({ 'backend/src/a.ts': 'export const a = 1\n', 'frontend/src/m.ts': 'export const m = 1\n' })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /scanned ZERO backend error codes/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real repository is green, over backend codes found independently here', () => {
  // Independent of the AST: every `code: 'X'` on a non-comment line outside tests, by git
  // grep. The AST scan also sees helper arguments, so it is a superset — membership, never
  // equality.
  const out = execFileSync('git', ['grep', '-h', '-E', "code: '[A-Z][A-Z0-9_]+'", '--', 'backend/src', ':!*.spec.ts', ':!*.db-spec.ts', ':!backend/src/testing', ':!backend/src/migrations', ':!backend/src/seed'], { cwd: REPO, env: gitEnv(), encoding: 'utf8' })
  const grepped = [...new Set(out.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).flatMap((l) => [...l.matchAll(/code: '([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1])))]
  assert.ok(grepped.length > 0, 'git grep found no codes')
  const { codes } = backendCodes(REPO)
  assert.deepEqual(grepped.filter((c) => !codes.has(c)), [], 'codes git grep sees that the AST scan missed')
  const r = run()
  assert.equal(r.status, 0, r.out)
})
