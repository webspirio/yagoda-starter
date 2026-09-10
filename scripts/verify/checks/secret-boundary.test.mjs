import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'secret-boundary.mjs')
const GITIGNORE = path.join(ROOT, '.gitignore')
const ENV_EXAMPLE = path.join(ROOT, '.env.example')

/** @returns {{ status: number, out: string }} */
function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8' }) }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as memo-drift.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * A 40-character run over a 62-symbol alphabet: Shannon entropy for this is comfortably
 * above the check's 3.5 bits/char threshold (measured minimum over 2000 trials: 4.24), so
 * this fixture is not a source of test flakiness the way a smaller alphabet (e.g. hex,
 * 16 symbols) would be.
 *
 * @returns {string}
 */
function randomHighEntropyValue() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 40; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

test('the real tree is green', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
})

test('a tracked PEM private-key block is caught', () => {
  const rel = 'docs/zz-secret-fixture-pem.txt'
  const fixture = path.join(ROOT, rel)
  // Obviously fake: a real PEM header followed by the word FAKE, never real key material.
  writeFileSync(fixture, '-----BEGIN RSA PRIVATE KEY-----\nFAKE-NOT-A-REAL-KEY-BODY\n-----END RSA PRIVATE KEY-----\n')
  try {
    execFileSync('git', ['add', '-N', '--', rel], { cwd: ROOT })
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /PEM private-key block/i)
    assert.match(res.out, /zz-secret-fixture-pem\.txt/)
  } finally {
    try {
      execFileSync('git', ['rm', '--cached', '--force', '--quiet', '--', rel], { cwd: ROOT })
    } catch {
      // Not staged (e.g. an earlier failure never reached `git add -N`) — fine, the
      // rmSync below still removes the working-tree file either way.
    }
    rmSync(fixture, { force: true })
  }
})

test('a tracked JWT-shaped string is caught', () => {
  const rel = 'docs/zz-secret-fixture-jwt.txt'
  const fixture = path.join(ROOT, rel)
  // Obviously fake: three base64url segments built from the literal string
  // "not-a-real-token", never a real token.
  const seg = (/** @type {string} */ s) => Buffer.from(s, 'utf8').toString('base64url')
  const fakeJwt = `eyJ${seg('not-a-real-token-header')}.${seg('not-a-real-token-payload')}.${seg('not-a-real-token-signature')}`
  writeFileSync(fixture, `${fakeJwt}\n`)
  try {
    execFileSync('git', ['add', '-N', '--', rel], { cwd: ROOT })
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /JWT/)
    assert.match(res.out, /zz-secret-fixture-jwt\.txt/)
  } finally {
    try {
      execFileSync('git', ['rm', '--cached', '--force', '--quiet', '--', rel], { cwd: ROOT })
    } catch {
      // See the PEM test above for why this is allowed to fail harmlessly.
    }
    rmSync(fixture, { force: true })
  }
})

test('removing the .env line from .gitignore is caught, naming the fingerprint mismatch', () => {
  const original = readFileSync(GITIGNORE, 'utf8')
  try {
    const mutated = original
      .split('\n')
      .filter((line) => line !== '.env')
      .join('\n')
    assert.notEqual(mutated, original, 'fixture assumes .gitignore currently has a bare .env line')
    writeFileSync(GITIGNORE, mutated)
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /fingerprint mismatch/i)
  } finally {
    writeFileSync(GITIGNORE, original)
  }
})

test('a 40-character high-entropy value in .env.example is caught', () => {
  const original = readFileSync(ENV_EXAMPLE, 'utf8')
  try {
    const marker = 'JWT_SECRET=change-me-to-a-32-character-minimum-secret'
    assert.match(original, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const mutated = original.replace(marker, `JWT_SECRET=${randomHighEntropyValue()}`)
    writeFileSync(ENV_EXAMPLE, mutated)
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /\.env\.example/)
  } finally {
    writeFileSync(ENV_EXAMPLE, original)
  }
})

test('.env.example keeping its placeholder values stays green', () => {
  const original = readFileSync(ENV_EXAMPLE, 'utf8')
  try {
    // Not a real mutation — rewritten byte-for-byte identical — but exercised through the
    // same write/restore path as every other case, so this control case proves the
    // placeholder values actually shipped in .env.example pass rule 4 on their own merits.
    writeFileSync(ENV_EXAMPLE, original)
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    writeFileSync(ENV_EXAMPLE, original)
  }
})
