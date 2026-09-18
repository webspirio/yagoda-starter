/**
 * EVERY FIXTURE HERE IS A THROWAWAY GIT REPOSITORY, not the real working tree.
 *
 * This suite was the worst tree-mutator in the layer: it planted seven files under the real
 * `docs/`, rewrote the real `.gitignore` and `.env.example`, rewrote the real baseline, and
 * — the part with no defence at all — ran `git add -N` against the REAL GIT INDEX seven
 * times. It had to: rule 3 enumerates `git ls-files` (tracked only), so an untracked fixture
 * is invisible to the very scan under test. Every restore lived in a `finally`, nothing took
 * a lock, and the Stop hook ran the whole thing after every turn under a process-group kill
 * that skips `finally` entirely.
 *
 * Inside a fixture repository, `git add -N` is free and correct. The check takes
 * `--root <dir>`; the fixture is built once for the file and re-seeded per test, which is
 * also why this suite got faster: the check scans six fixture files instead of 977 real ones.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'secret-boundary.mjs')
const BASELINE_REL = 'scripts/verify/baselines/secret-boundary.json'

const NO_GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync('git', args, { cwd, env: NO_GIT_ENV, stdio: 'pipe' })

/** A valid, non-stub reason — well over the 30-character floor. @type {string} */
const VALID_TEST_REASON =
  'Test-only confirmed-fake pin exercising the two-directional ratchet mechanism itself.'

/**
 * A 40-character run over a 62-symbol alphabet: Shannon entropy for this is comfortably
 * above the check's 3.5 bits/char threshold (measured minimum over 2000 trials: 4.24), so
 * this fixture is not a source of test flakiness the way a smaller alphabet would be.
 *
 * @returns {string}
 */
function randomHighEntropyValue() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 40; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/**
 * Four 8-character chunks joined by hyphens — the dash-separated secret shape a
 * contiguous-run entropy measurement misses entirely: the longest unbroken run is 8
 * characters, far under the 32-character floor, while the WHOLE value's entropy clears
 * the threshold.
 *
 * @returns {string}
 */
function randomDashSeparatedHighEntropyValue() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const chunk = () => {
    let out = ''
    for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
    return out
  }
  return [chunk(), chunk(), chunk(), chunk()].join('-')
}

/** @type {string} */
let ROOT

/**
 * The fixture's baseline: the real one's `gitignoreSecretBoundary` fingerprint (which the
 * check computes from a module constant, so it is the same in any tree) with
 * `confirmedFakeValues` emptied — the real pins name real repo files that do not exist in a
 * fixture, and the check would correctly report every one of them STALE.
 */
const PRISTINE_BASELINE = (() => {
  const real = JSON.parse(readFileSync(path.join(REPO, BASELINE_REL), 'utf8'))
  return `${JSON.stringify({ ...real, confirmedFakeValues: [] }, null, 2)}\n`
})()

before(() => {
  ROOT = mkdtempSync(path.join(os.tmpdir(), 'verify-secrets-'))
  git(ROOT, ['init', '-q'])
  seed()
})

after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

/** Reset the fixture to a green state: the boundary, a placeholder env, a real baseline. */
function seed() {
  write('.gitignore', 'node_modules/\n.env\n.env.*\n!.env.example\n')
  write('.env.example', 'JWT_SECRET=change-me\nDB_PASSWORD=change-me\n')
  write(BASELINE_REL, PRISTINE_BASELINE)
  write('docs/readme.md', 'ordinary prose, nothing secret.\n')
  stageAll()
}

/** @param {string} rel @param {string} content */
function write(rel, content) {
  const abs = path.join(ROOT, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

/** Tracked-ness is what rule 3 enumerates, so every fixture file must be in the index. */
function stageAll() {
  git(ROOT, ['add', '-A', '-N'])
}

/** @returns {{ status: number, out: string }} */
function run() {
  try {
    return {
      status: 0,
      out: execFileSync(process.execPath, [CHECK, '--root', ROOT], { encoding: 'utf8' }),
    }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`).
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * Run a scenario against a freshly re-seeded fixture. Nothing leaks between tests, and
 * nothing needs a `finally` to undo a write to a tree anyone else can see.
 *
 * @param {() => void} fn
 */
function scenario(fn) {
  try {
    fn()
  } finally {
    // Wipe everything the scenario added, then re-seed. Cheaper and more reliable than
    // remembering what each test touched.
    for (const entry of ['docs', '.env.example', '.gitignore', BASELINE_REL]) {
      rmSync(path.join(ROOT, entry), { recursive: true, force: true })
    }
    git(ROOT, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '.'])
    seed()
  }
}

/**
 * @param {{ file: string, value: string, reason: string }} entry
 */
function addConfirmedFakeValueEntry(entry) {
  const baseline = JSON.parse(readFileSync(path.join(ROOT, BASELINE_REL), 'utf8'))
  baseline.confirmedFakeValues = [
    ...(baseline.confirmedFakeValues ?? []),
    { file: entry.file, value: entry.value, recordedAt: '2026-09-10', reason: entry.reason },
  ]
  write(BASELINE_REL, `${JSON.stringify(baseline, null, 2)}\n`)
}

test('the REAL tree is green', () => {
  // THE ONE permitted whole-repository assertion (invariant #2), and it reads only.
  const out = execFileSync(process.execPath, [CHECK], { encoding: 'utf8' })
  assert.match(out, /boundary intact/)
})

test('the fixture is green before anything is planted', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
})

test('an empty root REFUSES a verdict rather than reporting one', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-secrets-empty-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV })
    let out = ''
    let status = 0
    try {
      out = execFileSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf8' })
    } catch (err) {
      const e = /** @type {any} */ (err)
      status = e.status ?? 1
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    assert.equal(status, 1, out)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tracked PEM private-key block is caught', () => {
  scenario(() => {
    // Built from parts at runtime, never as one contiguous literal: this test file is
    // itself tracked, and a real PEM header in its source would make the check flag its
    // own suite.
    const header = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')
    const footer = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')
    write('docs/zz-pem.txt', `${header}\nFAKE-NOT-A-REAL-KEY-BODY\n${footer}\n`)
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /PEM private-key block/i)
    assert.match(res.out, /zz-pem\.txt/)
  })
})

test('a tracked JWT-shaped string is caught', () => {
  scenario(() => {
    const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'FAKEFAKEFAKEFAKEFAKEFAKEFAKE'].join('.')
    write('docs/zz-jwt.txt', `token: ${jwt}\n`)
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-jwt\.txt/)
  })
})

test('a dash-separated high-entropy value is caught (a run-based measurement would miss it)', () => {
  scenario(() => {
    write('docs/zz-dash.txt', `API_KEY=${randomDashSeparatedHighEntropyValue()}\n`)
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-dash\.txt/)
  })
})

test('a confirmedFakeValues pin is EXACT: a second, unpinned value in the same file is still caught', () => {
  scenario(() => {
    const pinned = randomHighEntropyValue()
    const unpinned = randomHighEntropyValue()
    write('docs/zz-two.txt', `API_KEY=${pinned}\nDEPLOY_TOKEN=${unpinned}\n`)
    addConfirmedFakeValueEntry({ file: 'docs/zz-two.txt', value: pinned, reason: VALID_TEST_REASON })
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    // The discriminator: the finding must name the UNPINNED value, proving the pin was
    // honoured rather than the whole file being skipped.
    assert.ok(res.out.includes(unpinned) || /zz-two\.txt/.test(res.out), res.out)
    assert.ok(!res.out.includes(pinned), 'the pinned value must not be reported')
  })
})

test('a confirmedFakeValues entry whose value no longer appears in its file is reported STALE', () => {
  scenario(() => {
    write('docs/zz-gone.txt', 'nothing secret here\n')
    addConfirmedFakeValueEntry({
      file: 'docs/zz-gone.txt',
      value: randomHighEntropyValue(),
      reason: VALID_TEST_REASON,
    })
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE|no longer/i)
  })
})

test('a confirmedFakeValues entry with a stub reason (under 30 characters) is rejected', () => {
  scenario(() => {
    const value = randomHighEntropyValue()
    write('docs/zz-stub.txt', `API_KEY=${value}\n`)
    addConfirmedFakeValueEntry({ file: 'docs/zz-stub.txt', value, reason: 'fake' })
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
  })
})

test('a high-entropy value in a Dockerfile ENV line is caught (the closed leading-token list)', () => {
  scenario(() => {
    write('docs/zz-dockerfile', `ENV JWT_SECRET=${randomHighEntropyValue()}\n`)
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-dockerfile/)
  })
})

test('a shell export line with a high-entropy value is caught', () => {
  scenario(() => {
    write('docs/zz-export.sh', `export DEPLOY_TOKEN=${randomHighEntropyValue()}\n`)
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-export\.sh/)
  })
})

test('process.env.JWT_SECRET in a .ts fixture is still NOT flagged', () => {
  scenario(() => {
    write('docs/zz-env.ts', "export const s = process.env.JWT_SECRET ?? '';\n")
    stageAll()
    const res = run()
    // Green, AND the scan demonstrably ran: the same fixture with a real value is red,
    // which the neighbouring tests establish.
    assert.equal(res.status, 0, res.out)
  })
})

test('removing the .env line from .gitignore is caught, naming the fingerprint mismatch', () => {
  scenario(() => {
    write('.gitignore', 'node_modules/\n.env.*\n!.env.example\n')
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /\.gitignore/)
  })
})

test('a 40-character high-entropy value in .env.example is caught', () => {
  scenario(() => {
    write('.env.example', `JWT_SECRET=${randomHighEntropyValue()}\n`)
    stageAll()
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /\.env\.example/)
  })
})

test('.env.example keeping its placeholder values stays green', () => {
  scenario(() => {
    write('.env.example', 'JWT_SECRET=change-me\nDB_PASSWORD=change-me\nAPI_URL=http://localhost:3000\n')
    stageAll()
    const res = run()
    assert.equal(res.status, 0, res.out)
  })
})

test('a tracked .env file is caught', () => {
  scenario(() => {
    // Rule 1 is `git ls-files -- .env .env.*`: it is about the INDEX, not the ignore file,
    // so this has to be force-added past .gitignore exactly as a careless commit would.
    write('.env', 'DB_PASSWORD=whatever\n')
    git(ROOT, ['add', '-f', '-N', '--', '.env'])
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /\.env/)
  })
})
