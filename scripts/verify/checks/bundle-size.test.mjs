/**
 * Tests for the bundle budget.
 *
 * NOT ONE OF THESE TOUCHES THE REAL frontend/dist OR THE REAL BUDGET FILE. The suite this
 * replaced did both: it COPIED a real build's output aside, deleted it, wrote a fabricated
 * dist in its place, and restored the copy in a `finally` — and separately overwrote
 * scripts/verify/baselines/bundle-budget.json to test `--write`. The Stop hook runs the
 * fast tier after every turn under a timeout that kills the process group, and a killed
 * process runs no `finally`, so a hundreds-of-KB fabricated bundle and a clobbered budget
 * file were both one interrupted run away. `scanRoot()` is what makes a fixture a
 * `mkdtempSync` directory instead — including its `frontend/dist/.vite/manifest.json` now
 * that first paint is read from the manifest too.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'bundle-size.mjs')

const KIB = 1024
const MIN_GZIP = 25 * KIB
const MIN_RAW = 100 * KIB

/**
 * A budget file with explicit ceilings, so no test has to read the shipped one to size a
 * fixture — the old suite did, which coupled every over-budget test to the real bundle.
 *
 * @param {{
 *   maxGzipBytes?: number, maxRawBytes?: number,
 *   maxFirstPaintGzipBytes?: number, maxFirstPaintRawBytes?: number,
 *   reason?: string,
 * }} over
 */
function budgetFile(over) {
  return {
    measuredAt: '2026-01-01',
    measuredGzipBytes: 0,
    measuredRawBytes: 0,
    measuredFirstPaintGzipBytes: 0,
    measuredFirstPaintRawBytes: 0,
    minHeadroomGzipBytes: MIN_GZIP,
    minHeadroomRawBytes: MIN_RAW,
    stepGzipBytes: 5 * KIB,
    stepRawBytes: 20 * KIB,
    headroomGzipBytes: 0,
    headroomRawBytes: 0,
    headroomFirstPaintGzipBytes: 0,
    headroomFirstPaintRawBytes: 0,
    reason: 'fixture',
    ...over,
  }
}

/**
 * Builds a throwaway root with `frontend/dist/assets/<files>`, an optional
 * `frontend/dist/.vite/manifest.json`, and a budget file, runs the check against it via
 * VERIFY_SCAN_ROOT, and returns what it printed.
 *
 * @param {{
 *   files?: Record<string, Buffer | string> | null,
 *   manifest?: Record<string, object> | null,
 *   budget?: object | null,
 *   args?: string[],
 * }} opts
 * @returns {{ status: number, out: string, root: string, readBudget: () => any }}
 */
function runIn({ files, manifest, budget, args = [] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'))
  if (files) {
    const assets = path.join(root, 'frontend', 'dist', 'assets')
    mkdirSync(assets, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(assets, name), content)
    }
  }
  if (manifest) {
    const manifestPath = path.join(root, 'frontend', 'dist', '.vite', 'manifest.json')
    mkdirSync(path.dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  const budgetPath = path.join(root, 'scripts', 'verify', 'baselines', 'bundle-budget.json')
  mkdirSync(path.dirname(budgetPath), { recursive: true })
  if (budget) writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`)

  const env = { ...process.env, VERIFY_SCAN_ROOT: root }
  let status = 0
  let out = ''
  try {
    out = execFileSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env })
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom every other check suite in this layer uses.
    const e = /** @type {any} */ (err)
    status = e.status ?? 1
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  return {
    status,
    out,
    root,
    readBudget: () => JSON.parse(readFileSync(budgetPath, 'utf8')),
  }
}

/**
 * Incompressible bytes — gzip cannot shrink these, so raw and gzip move together.
 *
 * @param {number} n
 * @returns {Buffer}
 */
const noise = (n) => randomBytes(n)

test('a missing frontend/dist/assets fails clearly, not with a stack trace', () => {
  const r = runIn({ files: null, budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }) })
  assert.equal(r.status, 1)
  assert.match(r.out, /does not exist/)
  assert.match(r.out, /not "zero bytes, budget met"/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an assets directory with no .js or .css is a failure, not an empty-set pass', () => {
  const r = runIn({
    files: { 'logo.woff2': noise(100) },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /no \.js or \.css file/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a missing manifest fails, not passes, even with a perfectly good dist/assets', () => {
  const r = runIn({
    files: { 'app.js': noise(4 * KIB) },
    manifest: null,
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /manifest\.json/)
  assert.match(r.out, /does not exist/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a manifest naming a file absent from dist/assets fails with the named reason, not a false pass', () => {
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB) },
    manifest: {
      'index.html': { file: 'assets/index-A.js', isEntry: true, imports: ['ghost'] },
      ghost: { file: 'assets/ghost-DOESNOTEXIST.js' },
    },
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /ghost-DOESNOTEXIST\.js/)
  assert.match(r.out, /out of sync|does not contain/)
  rmSync(r.root, { recursive: true, force: true })
})

test('first paint follows the manifest’s static import closure and css, excluding a chunk reachable only through dynamicImports', () => {
  const files = {
    'index-A.js': noise(5 * KIB),
    'index-A.css': noise(1 * KIB),
    'shared-B.js': noise(3 * KIB),
    'lazy-C.js': noise(50 * KIB), // large, so inclusion/exclusion is unmistakable
  }
  const huge = 1e9
  const ample = budgetFile({
    maxGzipBytes: huge,
    maxRawBytes: huge,
    maxFirstPaintGzipBytes: huge,
    maxFirstPaintRawBytes: huge,
  })
  /** @param {string} out */
  const firstPaintOf = (out) => /first paint (\S+ KiB) gzip \/ (\S+ KiB) raw/.exec(out)?.[1]
  /** @param {string} kibStr */
  const toBytes = (kibStr) => Number.parseFloat(kibStr) * KIB

  const excludingLazy = runIn({
    files,
    manifest: {
      'index.html': {
        file: 'assets/index-A.js',
        css: ['assets/index-A.css'],
        isEntry: true,
        imports: ['shared-chunk'],
        dynamicImports: ['lazy-chunk'],
      },
      'shared-chunk': { file: 'assets/shared-B.js' },
      'lazy-chunk': { file: 'assets/lazy-C.js' },
    },
    budget: ample,
  })
  assert.equal(excludingLazy.status, 0, excludingLazy.out)
  const excluded = firstPaintOf(excludingLazy.out)
  assert.ok(excluded, excludingLazy.out)

  // DISCRIMINATOR: the identical files, but the lazy chunk is now a STATIC import — first
  // paint must measure strictly larger, proving the exclusion above was real and not an
  // accident of a check that never actually reads the manifest's imports/dynamicImports split.
  const includingLazy = runIn({
    files,
    manifest: {
      'index.html': {
        file: 'assets/index-A.js',
        css: ['assets/index-A.css'],
        isEntry: true,
        imports: ['shared-chunk', 'lazy-chunk'],
      },
      'shared-chunk': { file: 'assets/shared-B.js' },
      'lazy-chunk': { file: 'assets/lazy-C.js' },
    },
    budget: ample,
  })
  assert.equal(includingLazy.status, 0, includingLazy.out)
  const included = firstPaintOf(includingLazy.out)
  assert.ok(included, includingLazy.out)

  assert.ok(
    toBytes(included) > toBytes(excluded),
    `expected ${included} > ${excluded}`,
  )
  rmSync(excludingLazy.root, { recursive: true, force: true })
  rmSync(includingLazy.root, { recursive: true, force: true })
})

test('first paint over its own ceiling fails the row even while the sum is comfortably under its own', () => {
  const entryJs = noise(80 * KIB)
  const gz = gzipSync(entryJs, { level: 9 }).length
  const r = runIn({
    files: { 'index-A.js': entryJs },
    manifest: { 'index.html': { file: 'assets/index-A.js', isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: gz - 1,
      maxFirstPaintRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /FIRST PAINT GZIP OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('sum over its own ceiling does not fail the row when first paint is under, and prints as a WARNING', () => {
  const entryJs = noise(80 * KIB)
  const gz = gzipSync(entryJs, { level: 9 }).length
  const r = runIn({
    files: { 'index-A.js': entryJs },
    manifest: { 'index.html': { file: 'assets/index-A.js', isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: gz - 1,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /WARNING: sum of frontend\/dist\/assets .* OVER its own ceiling/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an under-budget dist is green and prints the first-paint headroom as a WARNING line', () => {
  const js = noise(10 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const r = runIn({
    files: { 'app.js': js },
    manifest: { 'index.html': { file: 'assets/app.js', isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: gz + MIN_GZIP + KIB,
      maxRawBytes: js.length + MIN_RAW + KIB,
      maxFirstPaintGzipBytes: gz + MIN_GZIP + KIB,
      maxFirstPaintRawBytes: js.length + MIN_RAW + KIB,
    }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /^WARNING: first paint headroom is /m)
  rmSync(r.root, { recursive: true, force: true })
})

test('first-paint headroom below the budget’s own designed minimum is WARNED about, while still passing', () => {
  // THE REGIME THIS CHECK'S HEADER CALLS THE DANGEROUS ONE, and until this line existed
  // nothing said a word about it: the ceiling holds, the row is green, and there is less
  // slack left than one ordinary phase of work — so the next ordinary commit turns it red
  // and somebody raises the ceiling on sight. This now watches FIRST PAINT's headroom,
  // because first paint is the gate.
  const js = noise(10 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const manifest = { 'index.html': { file: 'assets/app.js', isEntry: true } }
  const r = runIn({
    files: { 'app.js': js },
    manifest,
    budget: budgetFile({
      maxGzipBytes: gz + MIN_GZIP + KIB,
      maxRawBytes: js.length + MIN_RAW + KIB,
      maxFirstPaintGzipBytes: gz + KIB,
      maxFirstPaintRawBytes: js.length + MIN_RAW + KIB,
    }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /first paint headroom has fallen BELOW the minimum/)
  assert.match(r.out, /gzip .* against 25\.0 KiB/)
  // DISCRIMINATOR: the same bundle under a first-paint ceiling with ample headroom must NOT
  // warn, or the assertion above would pass against a line that is simply always printed.
  const ample = runIn({
    files: { 'app.js': js },
    manifest,
    budget: budgetFile({
      maxGzipBytes: gz + MIN_GZIP + KIB,
      maxRawBytes: js.length + MIN_RAW + KIB,
      maxFirstPaintGzipBytes: gz + MIN_GZIP + KIB,
      maxFirstPaintRawBytes: js.length + MIN_RAW + KIB,
    }),
  })
  assert.equal(ample.status, 0, ample.out)
  assert.doesNotMatch(ample.out, /fallen BELOW the minimum/)
  rmSync(r.root, { recursive: true, force: true })
  rmSync(ample.root, { recursive: true, force: true })
})

test('a green run also prints the largest-JS-chunk signal, and it ignores .css', () => {
  const small = noise(2 * KIB)
  const bigCss = noise(40 * KIB)
  const r = runIn({
    files: { 'app.js': small, 'style.css': bigCss },
    manifest: { 'index.html': { file: 'assets/app.js', css: ['assets/style.css'], isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /WARNING: largest JS chunk is app\.js/)
  assert.doesNotMatch(r.out, /largest JS chunk is style\.css/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an incompressible over-first-paint-budget file is RED, naming both the gzip and raw overage', () => {
  const js = noise(200 * KIB)
  const r = runIn({
    files: { 'huge.js': js },
    manifest: { 'index.html': { file: 'assets/huge.js', isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 10 * KIB,
      maxFirstPaintRawBytes: 10 * KIB,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /FIRST PAINT GZIP OVER BUDGET/)
  assert.match(r.out, /FIRST PAINT RAW OVER BUDGET/)
  assert.match(r.out, /reasoned edit/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a highly compressible file trips FIRST PAINT RAW OVER BUDGET without tripping gzip', () => {
  // Zeros gzip to almost nothing: this is the case a gzip-only budget would miss entirely,
  // and it is a real cost — the browser still parses and compiles every raw byte.
  const js = Buffer.alloc(400 * KIB, 0x61)
  const r = runIn({
    files: { 'repetitive.js': js },
    manifest: { 'index.html': { file: 'assets/repetitive.js', isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 100 * KIB,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /FIRST PAINT RAW OVER BUDGET/)
  assert.doesNotMatch(r.out, /GZIP OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write sets BOTH pairs (first paint and sum) to measurement + a MINIMUM headroom, then rounds to the step', () => {
  const entryJs = noise(30 * KIB)
  const sharedJs = noise(10 * KIB)
  const lazyJs = noise(20 * KIB) // reachable only through dynamicImports: in the sum, not first paint
  const gzEntry = gzipSync(entryJs, { level: 9 }).length
  const gzShared = gzipSync(sharedJs, { level: 9 }).length
  const gzLazy = gzipSync(lazyJs, { level: 9 }).length

  const r = runIn({
    files: { 'index-A.js': entryJs, 'shared-B.js': sharedJs, 'lazy-C.js': lazyJs },
    manifest: {
      'index.html': {
        file: 'assets/index-A.js',
        isEntry: true,
        imports: ['shared-chunk'],
        dynamicImports: ['lazy-chunk'],
      },
      'shared-chunk': { file: 'assets/shared-B.js' },
      'lazy-chunk': { file: 'assets/lazy-C.js' },
    },
    budget: null,
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  const written = r.readBudget()

  const sumGzip = gzEntry + gzShared + gzLazy
  const sumRaw = entryJs.length + sharedJs.length + lazyJs.length
  const fpGzip = gzEntry + gzShared
  const fpRaw = entryJs.length + sharedJs.length

  assert.equal(written.measuredGzipBytes, sumGzip)
  assert.equal(written.measuredRawBytes, sumRaw)
  assert.equal(written.measuredFirstPaintGzipBytes, fpGzip)
  assert.equal(written.measuredFirstPaintRawBytes, fpRaw)
  // The lazy chunk is real weight, so the two pairs must genuinely differ — this is what
  // proves --write actually consulted the manifest rather than writing the sum twice.
  assert.ok(written.measuredFirstPaintGzipBytes < written.measuredGzipBytes)
  assert.ok(written.measuredFirstPaintRawBytes < written.measuredRawBytes)

  // The property that matters, stated as arithmetic rather than a pinned number: each
  // ceiling clears its own measurement + minimum, and is a whole number of steps.
  assert.ok(written.maxGzipBytes >= sumGzip + written.minHeadroomGzipBytes)
  assert.ok(written.maxRawBytes >= sumRaw + written.minHeadroomRawBytes)
  assert.ok(written.maxFirstPaintGzipBytes >= fpGzip + written.minHeadroomGzipBytes)
  assert.ok(written.maxFirstPaintRawBytes >= fpRaw + written.minHeadroomRawBytes)
  assert.equal(written.maxGzipBytes % written.stepGzipBytes, 0)
  assert.equal(written.maxRawBytes % written.stepRawBytes, 0)
  assert.equal(written.maxFirstPaintGzipBytes % written.stepGzipBytes, 0)
  assert.equal(written.maxFirstPaintRawBytes % written.stepRawBytes, 0)
  // A bare round-up with no minimum would land within one step of the measurement. This is
  // the exact regression that shipped once, at 3,719 B of headroom.
  assert.ok(written.maxFirstPaintGzipBytes - fpGzip > written.stepGzipBytes)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write preserves an existing reason rather than overwriting it with the default', () => {
  const custom = 'A REASON SOMEBODY WROTE BY HAND AND WOULD NOT WANT SILENTLY REPLACED.'
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB) },
    manifest: { 'index.html': { file: 'assets/index-A.js', isEntry: true } },
    budget: budgetFile({
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
      reason: custom,
    }),
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.readBudget().reason, custom)
  rmSync(r.root, { recursive: true, force: true })
})

test('non-.js/.css files under dist/assets are excluded from both totals', () => {
  const js = noise(4 * KIB)
  const manifest = { 'index.html': { file: 'assets/app.js', isEntry: true } }
  const budget = budgetFile({
    maxGzipBytes: 1e9,
    maxRawBytes: 1e9,
    maxFirstPaintGzipBytes: 1e9,
    maxFirstPaintRawBytes: 1e9,
  })
  const withFont = runIn({
    files: { 'app.js': js, 'font.woff2': noise(300 * KIB) },
    manifest,
    budget,
  })
  const without = runIn({ files: { 'app.js': js }, manifest, budget })
  /** @param {string} out */
  const sumOf = (out) => /sum of frontend\/dist\/assets is (\S+ KiB) gzip \/ (\S+ KiB) raw/.exec(out)?.slice(1, 3)
  assert.deepEqual(sumOf(withFont.out), sumOf(without.out))
  rmSync(withFont.root, { recursive: true, force: true })
  rmSync(without.root, { recursive: true, force: true })
})
