import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'audit.mjs')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'audit.json')

/** A valid, non-stub reason — well over the 30-character floor. @type {string} */
const VALID_TEST_REASON =
  'Test-only baseline entry exercising the ratchet mechanism itself, not a real exemption.'

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ status: number, out: string }}
 */
function run(opts = {}) {
  try {
    return {
      status: 0,
      out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8', env: opts.env ?? process.env }),
    }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as money-rounding.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * A PATH-shim `npm`, in the same spirit as migration-invariants.test.mjs's `git` shim: it
 * replaces the real `npm ls`/`npm audit` this check shells out to with two fixture files
 * read off disk, so this suite is deterministic and — critically — makes NO real network
 * call. `audit.mjs`'s own row needs `['npm-registry']` precisely because `npm audit`
 * genuinely requires the registry; if this test suite called the real command, `npm run
 * test:verify` (a FAST-tier row, run by `selfcheck`) would silently start depending on
 * network reachability too, which is exactly the leak the tier split exists to prevent.
 *
 * The shim is plain CommonJS (no `import`, no `.mjs` extension) on purpose: a shebang-
 * executed file with no extension is loaded by Node as CommonJS by default, and `import`
 * syntax there would be a syntax error, not a module.
 *
 * @param {{ lsJson: unknown, auditJson: unknown }} fixtures
 * @returns {{ env: NodeJS.ProcessEnv, cleanup: () => void }}
 */
function makeNpmShim({ lsJson, auditJson }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'audit-check-npm-shim-'))
  const lsFile = path.join(dir, 'ls.json')
  const auditFile = path.join(dir, 'audit.json')
  writeFileSync(lsFile, JSON.stringify(lsJson))
  writeFileSync(auditFile, JSON.stringify(auditJson))
  const shimPath = path.join(dir, 'npm')
  writeFileSync(
    shimPath,
    [
      '#!/usr/bin/env node',
      "const { readFileSync } = require('node:fs')",
      'const sub = process.argv[2]',
      "if (sub === 'ls') {",
      "  process.stdout.write(readFileSync(process.env.ZZ_AUDIT_TEST_LS_FILE, 'utf8'))",
      '  process.exit(0)',
      '}',
      "if (sub === 'audit') {",
      "  process.stdout.write(readFileSync(process.env.ZZ_AUDIT_TEST_AUDIT_FILE, 'utf8'))",
      // Real `npm audit` exits non-zero the instant it finds anything — mirrored here so
      // this shim exercises the exact same "non-zero exit, JSON still on stdout" path
      // audit.mjs's advisories() defends against, rather than only the happy path.
      '  process.exit(1)',
      '}',
      "process.stderr.write('unsupported npm subcommand in test shim: ' + sub + '\\n')",
      'process.exit(127)',
      '',
    ].join('\n'),
  )
  chmodSync(shimPath, 0o755)
  return {
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      ZZ_AUDIT_TEST_LS_FILE: lsFile,
      ZZ_AUDIT_TEST_AUDIT_FILE: auditFile,
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * A frozen snapshot of this repo's REAL `npm ls --omit=dev --all --json` / `npm audit
 * --json` output, captured 2026-09-10 (see scripts/verify/baselines/audit.json's own
 * `note` for the commands run to verify every claim below). Frozen rather than live: the
 * real npm registry changes without this repo changing, and a test asserting on it would
 * be exactly the flakiness `needs: ['npm-registry']` exists to keep out of the FAST tier.
 */
const REAL_SNAPSHOT_AUDIT_JSON = {
  vulnerabilities: {
    '@nestjs/core': { severity: 'high', via: ['@nestjs/platform-express'] },
    '@nestjs/platform-express': { severity: 'high', via: ['@nestjs/core', 'multer'] },
    '@nestjs/terminus': { severity: 'high', via: ['@nestjs/core', '@nestjs/typeorm'] },
    '@nestjs/testing': { severity: 'high', via: ['@nestjs/core', '@nestjs/platform-express'] },
    '@nestjs/typeorm': { severity: 'high', via: ['@nestjs/core'] },
    multer: {
      severity: 'high',
      via: [
        { title: 'multer vulnerable to Denial of Service via crafted multipart field names' },
        { title: 'multer vulnerable to Denial of Service via file descriptor leak on aborted uploads' },
        { title: 'multer vulnerable to file size limit bypass via async fileFilter race condition' },
        { title: 'multer vulnerable to Denial of Service via oversized array index in field names' },
      ],
    },
  },
}
const REAL_SNAPSHOT_LS_JSON = {
  dependencies: {
    '@nestjs/core': {},
    '@nestjs/platform-express': { dependencies: { multer: {} } },
    '@nestjs/terminus': {},
    '@nestjs/typeorm': {},
    // @nestjs/testing is deliberately absent — it is a devDependency, confirmed dev-only
    // by `npm ls @nestjs/testing --omit=dev` returning an empty tree in the real repo.
  },
}

/**
 * The committed baseline carries all SIX real entries (R18), not just
 * `@nestjs/testing` — every fixture below that is not specifically exercising the
 * production-tree/productionRisk path reuses this REAL snapshot as its base and adds ONE
 * fabricated vulnerability on top, so none of the 6 real entries ever goes STALE
 * underneath an unrelated test. It was EIGHT until 2026-09-15, when npm audit stopped
 * reporting @nestjs/schedule and nestjs-pino with the lockfile untouched (see the
 * `audit` row in registry.mjs) and this ratchet's stale-entry rule deleted both from the
 * baseline; they were removed from this fixture in the same change, because a fixture
 * naming an advisory the baseline no longer carries makes every test built on it red.
 * Paired with `EMPTY_LS_JSON` (rather than
 * `REAL_SNAPSHOT_LS_JSON`) in most of those tests: none of the 6 real names is then
 * flagged `prod`, so they fall back to the plain `reason` check, which they already pass
 * — deliberately simpler than reproducing the real production-tree shape in every
 * unrelated test.
 */
const BASELINE_SAFE_AUDIT_JSON = REAL_SNAPSHOT_AUDIT_JSON
const EMPTY_LS_JSON = { dependencies: {} }

/**
 * Adds one entry to the baseline's `entries` array. Returns the ORIGINAL file content, for
 * restoring in a `finally` — same idiom as money-rounding.test.mjs's addBaselineEntry.
 *
 * @param {{ name: string, severity?: string, added?: string, reason: string, productionRisk?: { vulnerability: string, reachability: string, fix: string } }} entry
 * @returns {string}
 */
function addBaselineEntry(entry) {
  const original = readFileSync(BASELINE, 'utf8')
  const baseline = JSON.parse(original)
  /** @type {any} */
  const newEntry = {
    name: entry.name,
    severity: entry.severity ?? 'moderate',
    added: entry.added ?? '2026-09-10',
    reason: entry.reason,
  }
  if (entry.productionRisk) newEntry.productionRisk = entry.productionRisk
  baseline.entries = [...baseline.entries, newEntry]
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  return original
}

/** A complete, non-stub `productionRisk` object — well over the 30-character floor on
 * each of its three fields. @type {{ vulnerability: string, reachability: string, fix: string }} */
const VALID_PRODUCTION_RISK = {
  vulnerability: 'Test-only fixture standing in for a real GHSA advisory description, well over thirty characters.',
  reachability: 'Test-only fixture standing in for a real reachability explanation, well over thirty characters.',
  fix: 'Test-only fixture standing in for a real fix-and-blocker explanation, well over thirty characters.',
}

test('a REAL snapshot of this repo\'s advisories, re-captured 2026-09-15, is GREEN (R18) — all 6 names, including the 5 production-tree ones, are RECORDED with a complete productionRisk entry, not fixed', () => {
  const shim = makeNpmShim({ lsJson: REAL_SNAPSHOT_LS_JSON, auditJson: REAL_SNAPSHOT_AUDIT_JSON })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 0, res.out)
    // Counts read from the committed baseline rather than frozen as literals: this test
    // was pinned to 8/7 and went red on 2026-09-15 when npm audit stopped reporting two
    // names with nothing in this repo changing, which is a fact about an external
    // advisory database, not about this checker. The INVARIANT worth asserting is that
    // the checker's own summary agrees with the baseline it just compared against.
    const committed = JSON.parse(readFileSync(BASELINE, 'utf8'))
    const prodCount = committed.entries.filter((/** @type {any} */ e) => e.productionRisk).length
    assert.match(res.out, new RegExp(`${committed.entries.length} advisories \\(high: ${committed.entries.length}\\)`))
    assert.match(res.out, new RegExp(`${prodCount} reachable from the production tree, each RECORDED with a complete productionRisk`))
    assert.doesNotMatch(res.out, /PRODUCTION ADVISORY NOT BASELINED/)
    assert.doesNotMatch(res.out, /PRODUCTION ENTRY INCOMPLETE/)
    assert.doesNotMatch(res.out, /NEW ADVISORY/)
    assert.doesNotMatch(res.out, /STALE ENTRY/)
    assert.doesNotMatch(res.out, /CRITICAL/)
  } finally {
    shim.cleanup()
  }
})

test('a fabricated advisory not in the baseline is a NEW ADVISORY (brief scenario)', () => {
  const shim = makeNpmShim({
    lsJson: EMPTY_LS_JSON,
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-new-package': { severity: 'moderate', via: [{ title: 'zz fixture advisory title' }] },
      },
    },
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /NEW ADVISORY: moderate zz-audit-fixture-new-package — "zz fixture advisory title"/)
  } finally {
    shim.cleanup()
  }
})

test('a baseline entry whose advisory no longer appears is a STALE ENTRY, not a silent pass (brief scenario)', () => {
  const shim = makeNpmShim({ lsJson: EMPTY_LS_JSON, auditJson: BASELINE_SAFE_AUDIT_JSON })
  const originalBaseline = addBaselineEntry({
    name: 'zz-audit-fixture-does-not-exist',
    reason: VALID_TEST_REASON,
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /STALE ENTRY: zz-audit-fixture-does-not-exist/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
    shim.cleanup()
  }
})

test('an unrecorded production-tree advisory is PRODUCTION ADVISORY NOT BASELINED, not a silent pass and not a generic NEW ADVISORY (R18)', () => {
  const shim = makeNpmShim({
    lsJson: { dependencies: { 'zz-audit-fixture-prod-package': {} } },
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-prod-package': { severity: 'moderate', via: [{ title: 'zz fixture prod advisory' }] },
      },
    },
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /PRODUCTION ADVISORY NOT BASELINED: moderate zz-audit-fixture-prod-package — "zz fixture prod advisory"/)
    // A production-tree name gets the MORE SPECIFIC message above, not the generic one —
    // the new-advisory loop explicitly skips it (see audit.mjs's comment there).
    assert.doesNotMatch(res.out, /NEW ADVISORY/)
  } finally {
    shim.cleanup()
  }
})

test('a production-tree advisory recorded with a COMPLETE productionRisk entry passes (R18 — a production-tree finding is no longer an automatic, unconditional failure)', () => {
  const shim = makeNpmShim({
    lsJson: { dependencies: { 'zz-audit-fixture-prod-ok': {} } },
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-prod-ok': { severity: 'moderate', via: [{ title: 'zz fixture prod advisory, recorded' }] },
      },
    },
  })
  const originalBaseline = addBaselineEntry({
    name: 'zz-audit-fixture-prod-ok',
    severity: 'moderate',
    reason: VALID_TEST_REASON,
    productionRisk: VALID_PRODUCTION_RISK,
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 0, res.out)
    assert.doesNotMatch(res.out, /PRODUCTION ADVISORY NOT BASELINED/)
    assert.doesNotMatch(res.out, /PRODUCTION ENTRY INCOMPLETE/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
    shim.cleanup()
  }
})

test('a production-tree advisory whose baseline entry has NO productionRisk object at all is PRODUCTION ENTRY INCOMPLETE (R18)', () => {
  const shim = makeNpmShim({
    lsJson: { dependencies: { 'zz-audit-fixture-prod-missing-risk': {} } },
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-prod-missing-risk': { severity: 'moderate', via: [{ title: 'zz fixture prod advisory' }] },
      },
    },
  })
  // A plain `reason`, no `productionRisk` — exactly the shape a dev-only entry uses,
  // which is no longer enough once the name is production-reachable.
  const originalBaseline = addBaselineEntry({ name: 'zz-audit-fixture-prod-missing-risk', reason: VALID_TEST_REASON })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /PRODUCTION ENTRY INCOMPLETE: zz-audit-fixture-prod-missing-risk/)
    assert.match(res.out, /"productionRisk" object.*none is present/)
    assert.doesNotMatch(res.out, /PRODUCTION ADVISORY NOT BASELINED/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
    shim.cleanup()
  }
})

test('a production-tree advisory whose productionRisk has one stub field is PRODUCTION ENTRY INCOMPLETE, naming that exact field (R18)', () => {
  const shim = makeNpmShim({
    lsJson: { dependencies: { 'zz-audit-fixture-prod-stub-field': {} } },
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-prod-stub-field': { severity: 'moderate', via: [{ title: 'zz fixture prod advisory' }] },
      },
    },
  })
  const originalBaseline = addBaselineEntry({
    name: 'zz-audit-fixture-prod-stub-field',
    reason: VALID_TEST_REASON,
    productionRisk: { ...VALID_PRODUCTION_RISK, fix: 'TODO' },
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /PRODUCTION ENTRY INCOMPLETE: zz-audit-fixture-prod-stub-field/)
    assert.match(res.out, /productionRisk\.fix reason is a stub/)
    // The other two fields are fine — only `fix` should be named.
    assert.doesNotMatch(res.out, /productionRisk\.vulnerability/)
    assert.doesNotMatch(res.out, /productionRisk\.reachability/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
    shim.cleanup()
  }
})

test('a CRITICAL advisory is still never baselineable, even with a complete productionRisk — the floor keeps its teeth (R18)', () => {
  const shim = makeNpmShim({
    lsJson: { dependencies: { 'zz-audit-fixture-critical-prod': {} } },
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-critical-prod': { severity: 'critical', via: [{ title: 'zz fixture critical prod advisory' }] },
      },
    },
  })
  const originalBaseline = addBaselineEntry({
    name: 'zz-audit-fixture-critical-prod',
    severity: 'critical',
    reason: VALID_TEST_REASON,
    productionRisk: VALID_PRODUCTION_RISK,
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /CRITICAL: zz-audit-fixture-critical-prod — "zz fixture critical prod advisory"/)
    // A well-formed productionRisk buys nothing for a critical — it never even reaches
    // that check.
    assert.doesNotMatch(res.out, /PRODUCTION ADVISORY NOT BASELINED/)
    assert.doesNotMatch(res.out, /PRODUCTION ENTRY INCOMPLETE/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
    shim.cleanup()
  }
})

test('a critical-severity advisory fails outright, even outside the production tree, and is never baselineable', () => {
  const shim = makeNpmShim({
    lsJson: EMPTY_LS_JSON,
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-critical-package': { severity: 'critical', via: [{ title: 'zz fixture critical advisory' }] },
      },
    },
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /CRITICAL: zz-audit-fixture-critical-package — "zz fixture critical advisory"/)
    assert.doesNotMatch(res.out, /NEW ADVISORY/)
  } finally {
    shim.cleanup()
  }
})

test('a baseline entry whose reason is "TODO" makes the checker itself exit red, before any comparison', () => {
  const shim = makeNpmShim({ lsJson: EMPTY_LS_JSON, auditJson: BASELINE_SAFE_AUDIT_JSON })
  const originalBaseline = addBaselineEntry({ name: 'zz-audit-fixture-stub-reason', reason: 'TODO' })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /baseline itself is invalid/)
    assert.match(res.out, /reason/i)
    // The stub-reason gate runs before the new/stale comparison — neither should appear.
    assert.doesNotMatch(res.out, /NEW ADVISORY/)
    assert.doesNotMatch(res.out, /STALE ENTRY/)
  } finally {
    writeFileSync(BASELINE, originalBaseline)
    shim.cleanup()
  }
})

test('info-severity findings are ignored entirely, matching npm audit\'s own metadata semantics', () => {
  const shim = makeNpmShim({
    lsJson: EMPTY_LS_JSON,
    auditJson: {
      vulnerabilities: {
        ...BASELINE_SAFE_AUDIT_JSON.vulnerabilities,
        'zz-audit-fixture-info-package': { severity: 'info', via: [{ title: 'zz fixture info-only finding' }] },
      },
    },
  })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 0, res.out)
    assert.doesNotMatch(res.out, /zz-audit-fixture-info-package/)
  } finally {
    shim.cleanup()
  }
})
