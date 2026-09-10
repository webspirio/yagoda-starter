import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'bundle-size.mjs')
const DIST_DIR = path.join(ROOT, 'frontend', 'dist')
const ASSETS_DIR = path.join(DIST_DIR, 'assets')
const BUDGET_PATH = path.join(ROOT, 'scripts', 'verify', 'baselines', 'bundle-budget.json')

/**
 * @param {string[]} args
 * @returns {{ status: number, out: string }}
 */
function run(...args) {
  try {
    return {
      status: 0,
      out: execFileSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' }),
    }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom every other check's test file in this layer uses.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * Backs up a real frontend/dist by COPYING it aside (`cpSync`, not `renameSync`): this
 * worktree's `frontend/` and the OS temp directory can sit on different filesystems, and a
 * cross-device `rename` throws EXDEV — confirmed empirically running this suite the first
 * time. A copy works regardless of device.
 *
 * @returns {string | null} the backup directory, or null if there was nothing to back up
 */
function backupRealDist() {
  if (!existsSync(DIST_DIR)) return null
  const backupDir = mkdtempSync(path.join(os.tmpdir(), 'bundle-size-dist-backup-'))
  cpSync(DIST_DIR, path.join(backupDir, 'dist'), { recursive: true })
  rmSync(DIST_DIR, { recursive: true, force: true })
  return backupDir
}

/**
 * @param {string | null} backupDir from {@link backupRealDist}
 * @returns {void}
 */
function restoreRealDist(backupDir) {
  rmSync(DIST_DIR, { recursive: true, force: true })
  if (backupDir) {
    cpSync(path.join(backupDir, 'dist'), DIST_DIR, { recursive: true })
    rmSync(backupDir, { recursive: true, force: true })
  }
}

/**
 * Swaps a fabricated frontend/dist into place for the duration of `fn`, then restores
 * whatever was really there — a real build's output if one existed, or nothing at all if it
 * didn't. This is the one thing the brief is explicit about not getting wrong: leaving a
 * fabricated `frontend/dist` behind after this suite runs. `frontend/dist` is a build
 * artifact (gitignored — `git status --short` would never show it either way), but a stray
 * multi-hundred-KB fixture directory left on disk is still a mess the next real `npm run
 * build` should not have to silently clobber for us.
 *
 * @param {Record<string, Buffer | string>} files basename -> content, written under dist/assets
 * @param {() => void} fn
 * @returns {void}
 */
function withFixtureDist(files, fn) {
  const backupDir = backupRealDist()
  try {
    mkdirSync(ASSETS_DIR, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(ASSETS_DIR, name), content)
    }
    fn()
  } finally {
    restoreRealDist(backupDir)
  }
}

/**
 * frontend/dist absent entirely (no directory at all) — the state a fresh checkout that has
 * never run `npm run build` is in.
 *
 * @param {() => void} fn
 * @returns {void}
 */
function withNoDist(fn) {
  const backupDir = backupRealDist()
  try {
    fn()
  } finally {
    restoreRealDist(backupDir)
  }
}

test('a missing frontend/dist/assets fails clearly, not with a stack trace', () => {
  withNoDist(() => {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /does not exist/)
    assert.match(res.out, /npm run build/)
  })
})

test('an under-budget dist is green and prints the headroom as a WARNING line', () => {
  withFixtureDist(
    {
      'app.js': 'console.log("small fixture bundle");\n'.repeat(20),
      'app.css': 'body { color: red; }\n'.repeat(10),
    },
    () => {
      const res = run()
      assert.equal(res.status, 0, res.out)
      // The line must start with the literal word WARNING — that is what the runner's
      // warningLines() (`/WARNING|\(!\)/`) is written to catch, on stdout, on a PASSING run.
      assert.match(res.out, /^WARNING: /m)
      assert.match(res.out, /headroom/i)
      assert.match(res.out, /KiB gzip/)
      assert.match(res.out, /KiB raw/)
      // Blind spot, restated where a reader of the actual run output will see it: this
      // is a SUM, not a first-paint download figure.
      assert.match(res.out, /SUM of frontend\/dist\/assets/)
    },
  )
})

test('an incompressible over-budget file is RED, naming both the gzip and raw overage', () => {
  /** @type {{maxGzipBytes:number, maxRawBytes:number}} */
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
  // Random bytes barely compress at all, so a file sized comfortably past maxRawBytes pushes
  // both totals over their ceilings at once.
  const oversized = randomBytes(budget.maxRawBytes + 200_000)
  withFixtureDist({ 'huge.js': oversized }, () => {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /bundle: RED/)
    assert.match(res.out, /GZIP OVER BUDGET/)
    assert.match(res.out, /RAW OVER BUDGET/)
    // The overage itself is named as a figure, not just asserted as "too big".
    assert.match(res.out, /GZIP OVER BUDGET:.*\(\+[\d.]+ KiB\)/)
    assert.match(res.out, /RAW OVER BUDGET:.*\(\+[\d.]+ KiB\)/)
  })
})

test('a highly compressible but oversized-raw file trips RAW OVER BUDGET without necessarily tripping gzip', () => {
  /** @type {{maxGzipBytes:number, maxRawBytes:number}} */
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
  // A single repeated byte compresses to almost nothing, so this file's raw size clears the
  // raw ceiling while its gzip size stays far under the gzip ceiling — proof the two rules
  // are independent, not one derived from the other.
  const raw = Buffer.alloc(budget.maxRawBytes + 200_000, 0x61)
  withFixtureDist({ 'repetitive.js': raw }, () => {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RAW OVER BUDGET/)
    assert.doesNotMatch(res.out, /GZIP OVER BUDGET/)
  })
})

test('an over-budget run names the fix as a reasoned edit to the budget file, not a silent widen', () => {
  /** @type {{maxRawBytes:number}} */
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
  const oversized = randomBytes(budget.maxRawBytes + 200_000)
  withFixtureDist({ 'huge.js': oversized }, () => {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /reasoned edit/)
    assert.match(res.out, /bundle-budget\.json/)
  })
})

test('--write rounds measurement + a MINIMUM headroom UP to the documented step — never a bare round-up with no minimum', () => {
  const original = readFileSync(BUDGET_PATH, 'utf8')
  try {
    withFixtureDist(
      {
        // Exactly 1000 raw bytes of a single repeated character — deterministic gzip size
        // (measured directly below, not assumed) so the arithmetic can be checked exactly.
        'fixed.js': Buffer.alloc(1000, 0x61),
      },
      () => {
        const res = run('--write')
        assert.equal(res.status, 0, res.out)
        /** @type {any} */
        const written = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
        assert.equal(written.measuredRawBytes, 1000)
        // The whole point of fix round 1: a bare round-up-to-the-next-step can leave as
        // little as a few bytes of headroom when the measurement lands just past a step
        // boundary (this repo's own real baseline did exactly that once — 3,719 B of gzip
        // headroom, 1.3%). The ceiling must clear measurement + the declared MINIMUM
        // headroom, not merely exceed the measurement itself.
        assert.ok(written.maxRawBytes >= written.measuredRawBytes + written.minHeadroomRawBytes)
        assert.ok(written.maxGzipBytes >= written.measuredGzipBytes + written.minHeadroomGzipBytes)
        assert.equal(written.minHeadroomGzipBytes, 25 * 1024)
        assert.equal(written.minHeadroomRawBytes, 100 * 1024)
        // The step is still applied on top of the minimum (cosmetic rounding, not the
        // source of the slack) — the ceiling still lands on a step boundary.
        assert.equal(written.maxRawBytes % written.stepRawBytes, 0)
        assert.equal(written.maxGzipBytes % written.stepGzipBytes, 0)
        assert.equal(written.headroomRawBytes, written.maxRawBytes - written.measuredRawBytes)
        assert.equal(written.headroomGzipBytes, written.maxGzipBytes - written.measuredGzipBytes)
        assert.ok(written.reason && written.reason.length > 30)
      },
    )
  } finally {
    writeFileSync(BUDGET_PATH, original)
  }
})

test('--write preserves an existing reason rather than overwriting it with the default', () => {
  const original = readFileSync(BUDGET_PATH, 'utf8')
  try {
    /** @type {any} */
    const before = JSON.parse(original)
    const customReason = `test-fixture custom reason, over thirty characters long — ${Date.now()}`
    writeFileSync(BUDGET_PATH, JSON.stringify({ ...before, reason: customReason }, null, 2))
    withFixtureDist({ 'fixed.js': Buffer.alloc(500, 0x62) }, () => {
      const res = run('--write')
      assert.equal(res.status, 0, res.out)
      /** @type {any} */
      const written = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
      assert.equal(written.reason, customReason)
    })
  } finally {
    writeFileSync(BUDGET_PATH, original)
  }
})

test('font and other non-.js/.css files under dist/assets are excluded from both totals', () => {
  withFixtureDist(
    {
      'app.js': 'x'.repeat(500),
      'font.woff2': randomBytes(500_000), // large, but not .js/.css — must not affect totals
    },
    () => {
      const res = run()
      assert.equal(res.status, 0, res.out)
      assert.doesNotMatch(res.out, /font\.woff2/)
    },
  )
})
