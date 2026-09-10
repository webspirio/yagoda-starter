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
 * The committed baseline carries exactly one entry, `@nestjs/testing` — every fixture
 * below includes it, unchanged, so the real baseline entry never goes STALE underneath an
 * unrelated test. It is deliberately `via: []` (no advisory of its own — real npm audit
 * output for a cascade-only name has no object-shaped `via` entries), matching production.
 */
const BASELINE_SAFE_AUDIT_JSON = { vulnerabilities: { '@nestjs/testing': { severity: 'high', via: [] } } }
const EMPTY_LS_JSON = { dependencies: {} }

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
    '@nestjs/schedule': { severity: 'high', via: ['@nestjs/core'] },
    '@nestjs/terminus': { severity: 'high', via: ['@nestjs/core', '@nestjs/typeorm'] },
    '@nestjs/testing': { severity: 'high', via: ['@nestjs/core', '@nestjs/platform-express'] },
    '@nestjs/typeorm': { severity: 'high', via: ['@nestjs/core'] },
    multer: {
      severity: 'high',
      via: [
        { title: 'multer vulnerable to Denial of Service via crafted multipart field names' },
        { title: 'multer vulnerable to Denial of Service via file descriptor leak on aborted uploads' },
        { title: 'multer vulnerable to Denial of Service via oversized array index in field names' },
      ],
    },
    'nestjs-pino': { severity: 'high', via: ['@nestjs/core'] },
  },
}
const REAL_SNAPSHOT_LS_JSON = {
  dependencies: {
    '@nestjs/core': {},
    '@nestjs/platform-express': { dependencies: { multer: {} } },
    '@nestjs/schedule': {},
    '@nestjs/terminus': {},
    '@nestjs/typeorm': {},
    'nestjs-pino': {},
    // @nestjs/testing is deliberately absent — it is a devDependency, confirmed dev-only
    // by `npm ls @nestjs/testing --omit=dev` returning an empty tree in the real repo.
  },
}

/**
 * Adds one entry to the baseline's `entries` array. Returns the ORIGINAL file content, for
 * restoring in a `finally` — same idiom as money-rounding.test.mjs's addBaselineEntry.
 *
 * @param {{ name: string, severity?: string, added?: string, reason: string }} entry
 * @returns {string}
 */
function addBaselineEntry(entry) {
  const original = readFileSync(BASELINE, 'utf8')
  const baseline = JSON.parse(original)
  baseline.entries = [
    ...baseline.entries,
    {
      name: entry.name,
      severity: entry.severity ?? 'moderate',
      added: entry.added ?? '2026-09-10',
      reason: entry.reason,
    },
  ]
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  return original
}

test('a REAL snapshot of this repo\'s advisories, captured 2026-09-10, is RED for a real reason — 7 production-tree names cannot be baselined, and only @nestjs/testing (dev-only) is', () => {
  const shim = makeNpmShim({ lsJson: REAL_SNAPSHOT_LS_JSON, auditJson: REAL_SNAPSHOT_AUDIT_JSON })
  try {
    const res = run({ env: shim.env })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /audit: RED/)
    for (const name of [
      '@nestjs/core',
      '@nestjs/platform-express',
      '@nestjs/schedule',
      '@nestjs/terminus',
      '@nestjs/typeorm',
      'nestjs-pino',
    ]) {
      assert.match(res.out, new RegExp(`IN THE PRODUCTION TREE: high ${name.replace(/[/]/g, '\\/')} —`))
    }
    assert.match(
      res.out,
      /IN THE PRODUCTION TREE: high multer — "multer vulnerable to Denial of Service via crafted multipart field names"/,
    )
    // The one legitimately dev-only, baselined name never appears in the failure list.
    assert.doesNotMatch(res.out, /@nestjs\/testing/)
    assert.doesNotMatch(res.out, /NEW ADVISORY/)
    assert.doesNotMatch(res.out, /STALE ENTRY/)
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

test('an advisory reachable from the production tree fails outright and is never offered as baselineable', () => {
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
    assert.match(res.out, /IN THE PRODUCTION TREE: moderate zz-audit-fixture-prod-package/)
    // A production-tree name is never a candidate for "add it to the baseline" — the
    // new-advisory loop skips it entirely, on purpose (see audit.mjs's hard-floor comment).
    assert.doesNotMatch(res.out, /NEW ADVISORY/)
  } finally {
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
