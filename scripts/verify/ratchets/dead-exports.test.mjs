import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'ratchets', 'dead-exports.mjs')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'dead-exports.json')
const KNIP_CONFIG = path.join(ROOT, 'knip.json')
const CN_TS = path.join(ROOT, 'frontend', 'src', 'shared', 'lib', 'cn.ts')
const USE_IS_DESKTOP = path.join(ROOT, 'frontend', 'src', 'shared', 'lib', 'useIsDesktop.ts')

/** A valid, non-stub reason — well over the 30-character floor. @type {string} */
const VALID_TEST_REASON = 'Test-only baseline entry exercising the ratchet mechanism itself, not a real finding.'

/** @returns {{ status: number, out: string }} */
function run() {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8', cwd: ROOT }) }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as money-rounding.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * Reads knip.json, applies `mutate` to the parsed object, writes it back, and returns the
 * ORIGINAL text for restoring in a `finally` — same idiom lint-exempt.test.mjs and
 * money-rounding.test.mjs use for mutating a real config/source file in place.
 *
 * @param {(cfg: any) => void} mutate
 * @returns {string}
 */
function mutateKnipConfig(mutate) {
  const original = readFileSync(KNIP_CONFIG, 'utf8')
  const cfg = JSON.parse(original)
  mutate(cfg)
  writeFileSync(KNIP_CONFIG, `${JSON.stringify(cfg, null, 2)}\n`)
  return original
}

/**
 * Adds one entry to the baseline's `entries` array and returns the ORIGINAL file content,
 * for restoring in a `finally` — same idiom as lint-exempt.test.mjs's addBaselineEntry.
 *
 * @param {{ key: string, kind: string, file: string, name: string, added?: string, reason: string }} entry
 * @returns {string}
 */
function addBaselineEntry(entry) {
  const original = readFileSync(BASELINE, 'utf8')
  const baseline = JSON.parse(original)
  baseline.entries = [
    ...baseline.entries,
    {
      key: entry.key,
      kind: entry.kind,
      file: entry.file,
      name: entry.name,
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
  assert.match(res.out, /123 dead-code findings on record/)
  assert.match(res.out, /knip\.json carries only entry\/project/)
})

test('DIRECTION 1: a new unused export is a NEW FINDING', () => {
  const original = readFileSync(CN_TS, 'utf8')
  try {
    writeFileSync(CN_TS, `${original}\nexport function zzDeadExportsFixtureUnused() {\n  return 1;\n}\n`)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW FINDING/)
    assert.match(res.out, /export zzDeadExportsFixtureUnused in frontend\/src\/shared\/lib\/cn\.ts/)
  } finally {
    writeFileSync(CN_TS, original)
  }
})

test('DIRECTION 2: deleting a file the baseline lists is a STALE ENTRY, not a silent pass', () => {
  const original = readFileSync(USE_IS_DESKTOP, 'utf8')
  try {
    rmSync(USE_IS_DESKTOP)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE ENTRY/)
    assert.match(res.out, /file frontend\/src\/shared\/lib\/useIsDesktop\.ts/)
  } finally {
    writeFileSync(USE_IS_DESKTOP, original)
  }
})

test('DIRECTION 3: a top-level suppression key added to knip.json is RED, naming the banned key', () => {
  const original = mutateKnipConfig((cfg) => {
    cfg.ignore = ['src/foo.ts']
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /knip\.json is not compliant/)
    assert.match(res.out, /outside the allowed set at its top level: ignore/)
    // The stub-reason / new-finding machinery must never even run once the config itself
    // is non-compliant.
    assert.doesNotMatch(res.out, /NEW FINDING/)
  } finally {
    writeFileSync(KNIP_CONFIG, original)
  }
})

test('DIRECTION 3b: a suppression key nested inside one workspace is caught too, not just at the top level', () => {
  const original = mutateKnipConfig((cfg) => {
    cfg.workspaces.backend.ignoreDependencies = ['left-pad']
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /workspaces\.backend has keys outside the allowed set: ignoreDependencies/)
  } finally {
    writeFileSync(KNIP_CONFIG, original)
  }
})

test('DIRECTION 4: changing a project glob without updating the baseline fingerprint is RED', () => {
  const original = mutateKnipConfig((cfg) => {
    cfg.workspaces.frontend.project = ['src/**/*.ts']
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /GLOBS CHANGED/)
  } finally {
    writeFileSync(KNIP_CONFIG, original)
  }
})

test('a second knip config file at the repo root (knip.jsonc) is RED — an invisible bypass', () => {
  const shadowConfig = path.join(ROOT, 'knip.jsonc')
  writeFileSync(shadowConfig, '{}\n')
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /additional knip config file\(s\) at the repo root: knip\.jsonc/)
  } finally {
    rmSync(shadowConfig, { force: true })
  }
})

test('a "knip" section in backend/package.json is RED — knip would read it, this check would not', () => {
  const pkgPath = path.join(ROOT, 'backend', 'package.json')
  const original = readFileSync(pkgPath, 'utf8')
  try {
    const pkg = JSON.parse(original)
    pkg.knip = { ignore: ['src/foo.ts'] }
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /backend\/package\.json has a "knip" section/)
  } finally {
    writeFileSync(pkgPath, original)
  }
})

test('an @public JSDoc tag on an export is a SUPPRESSION TAG, not a silent pass', () => {
  const original = readFileSync(CN_TS, 'utf8')
  try {
    // Reachable (imported by main.ts transitively through the app) yet the tagged export
    // itself has no real caller — knip honours @public by default and would otherwise
    // simply omit the finding, which is exactly the invisible suppression this scans for.
    writeFileSync(CN_TS, `${original}\n/** @public */\nexport function zzDeadExportsFixtureTagged() {\n  return 1;\n}\n`)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /SUPPRESSION TAG/)
    assert.match(res.out, /frontend\/src\/shared\/lib\/cn\.ts/)
    assert.match(res.out, /@public/)
    // knip really did stay silent about the tagged export itself — proving this check adds
    // something a bare `knip` run would not have caught.
    assert.doesNotMatch(res.out, /zzDeadExportsFixtureTagged/)
  } finally {
    writeFileSync(CN_TS, original)
  }
})

test('a baseline entry whose reason is a stub makes the checker itself exit red, before any comparison', () => {
  const original = addBaselineEntry({
    key: 'export|zz-fixture-file.ts|zzFixtureExport',
    kind: 'export',
    file: 'zz-fixture-file.ts',
    name: 'zzFixtureExport',
    reason: 'TODO',
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /baseline itself is invalid/)
    assert.match(res.out, /"reason" is a stub \("TODO"\)/)
    // The stub-reason gate runs BEFORE the new/stale comparison.
    assert.doesNotMatch(res.out, /NEW FINDING/)
    assert.doesNotMatch(res.out, /STALE ENTRY/)
  } finally {
    writeFileSync(BASELINE, original)
  }
})

test('a baseline entry whose reason is shorter than 30 characters is rejected', () => {
  const shortReason = 'x'.repeat(29) // deliberately one character under the 30-character floor
  assert.equal(shortReason.length, 29)
  const original = addBaselineEntry({
    key: 'export|zz-fixture-file.ts|zzFixtureExport',
    kind: 'export',
    file: 'zz-fixture-file.ts',
    name: 'zzFixtureExport',
    reason: shortReason,
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /baseline itself is invalid/)
    assert.match(res.out, /30 characters/)
  } finally {
    writeFileSync(BASELINE, original)
  }
})

test('a duplicate key in the baseline is rejected', () => {
  const original = readFileSync(BASELINE, 'utf8')
  try {
    const baseline = JSON.parse(original)
    const dupe = baseline.entries[0]
    baseline.entries = [...baseline.entries, { ...dupe }]
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /duplicate key in the baseline/)
  } finally {
    writeFileSync(BASELINE, original)
  }
})

test('a well-formed but fabricated baseline entry is reported STALE, not accepted on faith', () => {
  // Proves this does not just check "is the reason long enough" and stop there — an entry
  // can be perfectly well-formed and still wrong, because nothing on disk produces it.
  const original = addBaselineEntry({
    key: 'export|zz-fixture-file-that-does-not-exist.ts|zzNoSuchExport',
    kind: 'export',
    file: 'zz-fixture-file-that-does-not-exist.ts',
    name: 'zzNoSuchExport',
    reason: VALID_TEST_REASON,
  })
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE ENTRY/)
    assert.match(res.out, /zz-fixture-file-that-does-not-exist\.ts/)
  } finally {
    writeFileSync(BASELINE, original)
  }
})
