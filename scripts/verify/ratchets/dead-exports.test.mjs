/**
 * Tests for the dead-code ratchet.
 *
 * NOTHING HERE EDITS THE REAL WORKING TREE. The suite this replaced appended an export to
 * frontend/src/shared/lib/cn.ts, DELETED frontend/src/shared/lib/useIsDesktop.ts, rewrote
 * the real knip.json and overwrote the real baseline — each restored in a `finally`. The
 * Stop hook runs the fast tier after every turn under a timeout that kills the process
 * group, and a killed process runs no `finally`, so a tracked source file was one
 * interrupted run away from staying deleted.
 *
 * The verdict is now a pure function of (found, baseline, fingerprint, tagged), so both
 * ratchet directions are asserted in-process. The config rules still run the real check,
 * but against a mkdtemp root — they reject the config before knip is ever invoked, which is
 * why those cases need no node_modules.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'ratchets', 'dead-exports.mjs')

const { compare, nameOf } = await import(CHECK)

const FINGERPRINT = 'abc123'
/** @param {string[]} entries */
const baselineOf = (entries) => ({
  createdAt: '2026-01-01',
  note: '',
  configFingerprint: FINGERPRINT,
  entries,
})
/** @param {string} kind @param {string} file @param {string} name */
const finding = (kind, file, name) => ({ kind, file, name })

/**
 * Runs the real check against a throwaway root.
 *
 * @param {(root: string) => void} build
 * @returns {{ status: number, out: string }}
 */
function runInRoot(build) {
  const root = mkdtempSync(path.join(tmpdir(), 'deadcode-'))
  try {
    build(root)
    try {
      return {
        status: 0,
        out: execFileSync(process.execPath, [CHECK], {
          encoding: 'utf8',
          env: { ...process.env, VERIFY_SCAN_ROOT: root },
        }),
      }
    } catch (err) {
      // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
      // variables as `unknown`) — same idiom every other check suite in this layer uses.
      const e = /** @type {any} */ (err)
      return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** @param {string} root @param {object} cfg */
function writeKnip(root, cfg) {
  writeFileSync(path.join(root, 'knip.json'), `${JSON.stringify(cfg, null, 2)}\n`)
}

test('the real tree is green against the committed baseline', () => {
  const out = execFileSync(process.execPath, [CHECK], { encoding: 'utf8' })
  assert.match(out, /dead-code findings on record, all present, none stale/)
})

test('DIRECTION 1: a finding the baseline does not list is a NEW FINDING', () => {
  const problems = compare({
    found: [finding('exports', 'frontend/src/a.ts', 'zzUnused')],
    baseline: baselineOf([]),
    fingerprint: FINGERPRINT,
    tagged: [],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /NEW FINDING: exports zzUnused in frontend\/src\/a\.ts/)
  // It names the exact line to add, so nobody has to guess the key format.
  assert.match(problems[0], /"exports\|frontend\/src\/a\.ts\|zzUnused"/)
})

test('DIRECTION 2: a listed finding knip no longer reports is a STALE ENTRY', () => {
  const problems = compare({
    found: [],
    baseline: baselineOf(['files|frontend/src/gone.ts|frontend/src/gone.ts']),
    fingerprint: FINGERPRINT,
    tagged: [],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /STALE ENTRY: files\|frontend\/src\/gone\.ts/)
  assert.match(problems[0], /only shrinks/)
})

test('both directions are silent when the sets match exactly — the discriminator', () => {
  // Without this, the two tests above would pass against a compare() that flagged
  // everything unconditionally.
  const key = 'exports|frontend/src/a.ts|zzUnused'
  assert.deepEqual(
    compare({
      found: [finding('exports', 'frontend/src/a.ts', 'zzUnused')],
      baseline: baselineOf([key]),
      fingerprint: FINGERPRINT,
      tagged: [],
    }),
    [],
  )
})

test('a fingerprint that does not match the recorded one is RED on its own', () => {
  const problems = compare({
    found: [],
    baseline: baselineOf([]),
    fingerprint: 'somethingelse',
    tagged: [],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /GLOBS CHANGED/)
  assert.match(problems[0], /abc123 -> somethingelse/)
})

test('a suppression tag is RED even when the finding sets agree perfectly', () => {
  const problems = compare({
    found: [],
    baseline: baselineOf([]),
    fingerprint: FINGERPRINT,
    tagged: ['frontend/src/a.ts:12 zzThing'],
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /SUPPRESSION TAG/)
})

test('a duplicates finding is NAMEABLE — the shape the old KINDS map silently dropped', () => {
  // knip reports duplicates as an ARRAY of exports, not a string or a {name} object. The
  // hand-written kind map named `duplicates` but the extractor only understood the other
  // two shapes, so every duplicate export in the repository read as nameless and was
  // skipped — a whole finding class that could never be reported.
  assert.equal(nameOf([{ name: 'foo' }, { name: 'bar' }]), 'foo + bar')
  assert.equal(nameOf(['foo', 'bar']), 'foo + bar')
  assert.equal(nameOf({ name: 'solo' }), 'solo')
  assert.equal(nameOf('solo'), 'solo')
  assert.equal(nameOf({ line: 3 }), '')
})

test('a top-level suppression key in knip.json is RED, naming the banned key', () => {
  const res = runInRoot((root) => {
    writeKnip(root, { ignore: ['src/**'], workspaces: { backend: { entry: ['src/main.ts'], project: ['src/**'] } } })
  })
  assert.equal(res.status, 1)
  assert.match(res.out, /keys outside the allowed set at its top level: ignore/)
})

test('a suppression key nested inside one workspace is caught too', () => {
  const res = runInRoot((root) => {
    writeKnip(root, {
      workspaces: { backend: { entry: ['src/main.ts'], project: ['src/**'], ignore: ['src/x.ts'] } },
    })
  })
  assert.equal(res.status, 1)
  assert.match(res.out, /workspaces\.backend has keys outside the allowed set: ignore/)
})

test('a second knip config file is RED — an invisible bypass', () => {
  const res = runInRoot((root) => {
    writeKnip(root, { workspaces: { backend: { entry: ['src/main.ts'], project: ['src/**'] } } })
    writeFileSync(path.join(root, 'knip.jsonc'), '{}\n')
  })
  assert.equal(res.status, 1)
  assert.match(res.out, /additional knip config file\(s\) at the repo root: knip\.jsonc/)
})

test('a "knip" section in a workspace package.json is RED — knip reads it, this check does not', () => {
  const res = runInRoot((root) => {
    writeKnip(root, { workspaces: { backend: { entry: ['src/main.ts'], project: ['src/**'] } } })
    mkdirSync(path.join(root, 'backend'), { recursive: true })
    writeFileSync(
      path.join(root, 'backend', 'package.json'),
      JSON.stringify({ name: 'backend', knip: { ignore: ['src/**'] } }),
    )
  })
  assert.equal(res.status, 1)
  assert.match(res.out, /backend\/package\.json has a "knip" section/)
})
