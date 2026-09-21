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
 * that first paint AND lazy are both read from the manifest.
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
 * A budget file with explicit ceilings for BOTH gated pairs (first paint, lazy), so no
 * test has to read the shipped one to size a fixture — the old suite did, which coupled
 * every over-budget test to the real bundle.
 *
 * @param {{
 *   maxFirstPaintGzipBytes?: number, maxFirstPaintRawBytes?: number,
 *   maxLazyGzipBytes?: number, maxLazyRawBytes?: number,
 *   reason?: string,
 * }} over
 */
function budgetFile(over) {
  return {
    measuredAt: '2026-01-01',
    measuredFirstPaintGzipBytes: 0,
    measuredFirstPaintRawBytes: 0,
    measuredLazyGzipBytes: 0,
    measuredLazyRawBytes: 0,
    minHeadroomGzipBytes: MIN_GZIP,
    minHeadroomRawBytes: MIN_RAW,
    stepGzipBytes: 5 * KIB,
    stepRawBytes: 20 * KIB,
    headroomFirstPaintGzipBytes: 0,
    headroomFirstPaintRawBytes: 0,
    headroomLazyGzipBytes: 0,
    headroomLazyRawBytes: 0,
    reason: 'fixture',
    ...over,
  }
}

/** A budgetFile() with every ceiling wide open — for tests that don't care about either gate. */
const AMPLE = {
  maxFirstPaintGzipBytes: 1e9,
  maxFirstPaintRawBytes: 1e9,
  maxLazyGzipBytes: 1e9,
  maxLazyRawBytes: 1e9,
}

/**
 * Builds a throwaway root with `frontend/dist/assets/<files>`, an optional
 * `frontend/dist/.vite/manifest.json`, and a budget file, runs the check against it via
 * VERIFY_SCAN_ROOT, and returns what it printed.
 *
 * @param {{
 *   files?: Record<string, Buffer | string> | null,
 *   manifest?: Record<string, object> | string | null,
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
    // A raw string writes exactly that (the unparsable-JSON fixture); anything else is
    // JSON-stringified, same as every other fixture in this file.
    const manifestContent = typeof manifest === 'string' ? manifest : `${JSON.stringify(manifest, null, 2)}\n`
    writeFileSync(manifestPath, manifestContent)
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
  const r = runIn({ files: null, budget: budgetFile(AMPLE) })
  assert.equal(r.status, 1)
  assert.match(r.out, /does not exist/)
  assert.match(r.out, /not "zero bytes, budget met"/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an assets directory with no .js or .css is a failure, not an empty-set pass', () => {
  const r = runIn({
    files: { 'logo.woff2': noise(100) },
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /no \.js or \.css file/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a missing manifest fails, not passes, even with a perfectly good dist/assets', () => {
  const r = runIn({
    files: { 'app.js': noise(4 * KIB) },
    manifest: null,
    budget: budgetFile(AMPLE),
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
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /ghost-DOESNOTEXIST\.js/)
  assert.match(r.out, /out of sync|does not contain/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a manifest whose entry statically imports a key the manifest does not contain fails naming the dangling key, not a silent skip', () => {
  // Not "points at a missing FILE" (the test above) — the KEY 'ghost-missing-key' does not
  // exist in the manifest at all. The traversal this replaced used `if (!chunk) return`
  // here, silently dropping the reference from first paint instead of failing.
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB) },
    manifest: {
      'index.html': { file: 'assets/index-A.js', isEntry: true, imports: ['ghost-missing-key'] },
    },
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /ghost-missing-key/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a manifest containing the dev-only ui-kit gallery fails, naming the key — production must never ship it', () => {
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB), 'ui-kit-B.js': noise(4 * KIB) },
    manifest: {
      'index.html': {
        file: 'assets/index-A.js',
        isEntry: true,
        dynamicImports: ['src/pages/ui-kit/index.ts'],
      },
      'src/pages/ui-kit/index.ts': { file: 'assets/ui-kit-B.js' },
    },
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /src\/pages\/ui-kit\/index\.ts/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a manifest chunk reachable through neither static nor dynamic imports trips the closure invariant, not a silent pass', () => {
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB), 'orphan-B.js': noise(4 * KIB) },
    manifest: {
      'index.html': { file: 'assets/index-A.js', isEntry: true },
      // Present in the manifest, but reachable from NOTHING — not in the entry's imports,
      // not in anyone's dynamicImports. A real Vite build should never emit this; this
      // fixture exists to prove the invariant, not to model how the bug would arise.
      orphan: { file: 'assets/orphan-B.js' },
    },
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /orphan-B\.js/)
  rmSync(r.root, { recursive: true, force: true })
})

test('excluding the dynamicImports-only chunk is the difference between passing and failing first paint, not just a smaller printed number', () => {
  // A ceiling strictly BETWEEN the two possible first-paint measurements: the discriminator
  // is that the manifest's imports/dynamicImports split is what decides pass vs. fail, not
  // merely what number gets printed on an already-passing run (which a check that never
  // actually read the manifest could still fake by printing the sum, or by printing the
  // right label over the wrong bytes).
  const files = {
    'index-A.js': noise(5 * KIB),
    'index-A.css': noise(1 * KIB),
    'shared-B.js': noise(3 * KIB),
    'lazy-C.js': noise(50 * KIB), // large, so the two totals are unmistakably different
  }
  const excludingLazyGzip =
    gzipSync(files['index-A.js'], { level: 9 }).length +
    gzipSync(files['index-A.css'], { level: 9 }).length +
    gzipSync(files['shared-B.js'], { level: 9 }).length
  const includingLazyGzip = excludingLazyGzip + gzipSync(files['lazy-C.js'], { level: 9 }).length
  const ceilingBetween = excludingLazyGzip + Math.floor((includingLazyGzip - excludingLazyGzip) / 2)

  const budget = budgetFile({
    maxFirstPaintGzipBytes: ceilingBetween,
    maxFirstPaintRawBytes: 1e9, // raw stays ample: this test isolates the gzip dimension
    maxLazyGzipBytes: 1e9,
    maxLazyRawBytes: 1e9,
  })

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
    budget,
  })
  assert.equal(excludingLazy.status, 0, excludingLazy.out)

  // The identical files and the identical ceiling, but the lazy chunk is now a STATIC
  // import: first paint must now exceed the ceiling and the row must go RED.
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
    budget,
  })
  assert.equal(includingLazy.status, 1, includingLazy.out)
  assert.match(includingLazy.out, /FIRST PAINT GZIP OVER BUDGET/)

  rmSync(excludingLazy.root, { recursive: true, force: true })
  rmSync(includingLazy.root, { recursive: true, force: true })
})

test('splitting a chunk behind a dynamic import moves its weight from first paint into lazy — the two totals stay equal either way', () => {
  const files = {
    'index-A.js': noise(5 * KIB),
    'shared-B.js': noise(3 * KIB),
    'lazy-C.js': noise(50 * KIB), // large, so the swap is unmistakable
  }
  /** @param {string} out */
  const parseFigures = (out) => {
    const m = /first paint (\S+) KiB gzip \/ \S+ KiB raw, lazy (\S+) KiB gzip/.exec(out)
    assert.ok(m, `no first-paint/lazy summary line in:\n${out}`)
    return { fp: Number(m[1]), lazy: Number(m[2]) }
  }

  const staticVariant = runIn({
    files,
    manifest: {
      'index.html': {
        file: 'assets/index-A.js',
        isEntry: true,
        imports: ['shared-chunk', 'lazy-chunk'],
      },
      'shared-chunk': { file: 'assets/shared-B.js' },
      'lazy-chunk': { file: 'assets/lazy-C.js' },
    },
    budget: budgetFile(AMPLE),
  })
  assert.equal(staticVariant.status, 0, staticVariant.out)
  const staticFigures = parseFigures(staticVariant.out)

  const dynamicVariant = runIn({
    files,
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
    budget: budgetFile(AMPLE),
  })
  assert.equal(dynamicVariant.status, 0, dynamicVariant.out)
  const dynamicFigures = parseFigures(dynamicVariant.out)

  assert.ok(
    dynamicFigures.fp < staticFigures.fp,
    `first paint should shrink once lazy-C.js goes dynamic: ${JSON.stringify({ dynamicFigures, staticFigures })}`,
  )
  assert.ok(
    dynamicFigures.lazy > staticFigures.lazy,
    `lazy should grow once lazy-C.js goes dynamic: ${JSON.stringify({ dynamicFigures, staticFigures })}`,
  )
  assert.ok(
    Math.abs(dynamicFigures.fp + dynamicFigures.lazy - (staticFigures.fp + staticFigures.lazy)) < 0.2,
    'moving a chunk behind a dynamic import must relocate its bytes, not create or destroy any',
  )
  rmSync(staticVariant.root, { recursive: true, force: true })
  rmSync(dynamicVariant.root, { recursive: true, force: true })
})

test('first paint over its own ceiling fails the row even while lazy is comfortably under its own', () => {
  const entryJs = noise(80 * KIB)
  const gz = gzipSync(entryJs, { level: 9 }).length
  const r = runIn({
    files: { 'index-A.js': entryJs },
    manifest: { 'index.html': { file: 'assets/index-A.js', isEntry: true } },
    budget: budgetFile({
      maxFirstPaintGzipBytes: gz - 1,
      maxFirstPaintRawBytes: 1e9,
      maxLazyGzipBytes: 1e9,
      maxLazyRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /FIRST PAINT GZIP OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('lazy over its own ceiling fails the row, independently of first paint', () => {
  const entryJs = noise(4 * KIB)
  const lazyJs = noise(80 * KIB)
  const gzLazy = gzipSync(lazyJs, { level: 9 }).length
  const r = runIn({
    files: { 'index-A.js': entryJs, 'lazy-C.js': lazyJs },
    manifest: {
      'index.html': { file: 'assets/index-A.js', isEntry: true, dynamicImports: ['lazy-chunk'] },
      'lazy-chunk': { file: 'assets/lazy-C.js' },
    },
    budget: budgetFile({
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
      maxLazyGzipBytes: gzLazy - 1,
      maxLazyRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /LAZY GZIP OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('lazy’s WARNING line carries its own "fallen BELOW the minimum" clause too, not just first paint’s', () => {
  const entryJs = noise(4 * KIB)
  const lazyJs = noise(10 * KIB)
  const gzFp = gzipSync(entryJs, { level: 9 }).length
  const gzLazy = gzipSync(lazyJs, { level: 9 }).length
  const manifest = {
    'index.html': { file: 'assets/index-A.js', isEntry: true, dynamicImports: ['lazy-chunk'] },
    'lazy-chunk': { file: 'assets/lazy-C.js' },
  }
  const files = { 'index-A.js': entryJs, 'lazy-C.js': lazyJs }

  const r = runIn({
    files,
    manifest,
    budget: budgetFile({
      maxFirstPaintGzipBytes: gzFp + MIN_GZIP + KIB, // ample: only lazy is under test
      maxFirstPaintRawBytes: entryJs.length + MIN_RAW + KIB,
      maxLazyGzipBytes: gzLazy + KIB, // thin, under the 25 KiB design minimum
      maxLazyRawBytes: lazyJs.length + MIN_RAW + KIB,
    }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /^WARNING: lazy headroom is /m)
  assert.match(r.out, /lazy headroom has fallen BELOW the minimum/)

  // DISCRIMINATOR: the same bundle under a lazy ceiling with ample headroom must NOT carry
  // that clause, or the assertion above would pass against text that is simply always there.
  const ample = runIn({
    files,
    manifest,
    budget: budgetFile({
      maxFirstPaintGzipBytes: gzFp + MIN_GZIP + KIB,
      maxFirstPaintRawBytes: entryJs.length + MIN_RAW + KIB,
      maxLazyGzipBytes: gzLazy + MIN_GZIP + KIB,
      maxLazyRawBytes: lazyJs.length + MIN_RAW + KIB,
    }),
  })
  assert.equal(ample.status, 0, ample.out)
  assert.doesNotMatch(ample.out, /lazy headroom has fallen BELOW the minimum/)
  rmSync(r.root, { recursive: true, force: true })
  rmSync(ample.root, { recursive: true, force: true })
})

test('an under-budget dist is green and prints the first-paint headroom as a WARNING line', () => {
  const js = noise(10 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const r = runIn({
    files: { 'app.js': js },
    manifest: { 'index.html': { file: 'assets/app.js', isEntry: true } },
    budget: budgetFile({
      maxFirstPaintGzipBytes: gz + MIN_GZIP + KIB,
      maxFirstPaintRawBytes: js.length + MIN_RAW + KIB,
      maxLazyGzipBytes: 1e9,
      maxLazyRawBytes: 1e9,
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
  // and somebody raises the ceiling on sight.
  const js = noise(10 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const manifest = { 'index.html': { file: 'assets/app.js', isEntry: true } }
  const r = runIn({
    files: { 'app.js': js },
    manifest,
    budget: budgetFile({
      maxFirstPaintGzipBytes: gz + KIB,
      maxFirstPaintRawBytes: js.length + MIN_RAW + KIB,
      maxLazyGzipBytes: 1e9,
      maxLazyRawBytes: 1e9,
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
      maxFirstPaintGzipBytes: gz + MIN_GZIP + KIB,
      maxFirstPaintRawBytes: js.length + MIN_RAW + KIB,
      maxLazyGzipBytes: 1e9,
      maxLazyRawBytes: 1e9,
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
    budget: budgetFile(AMPLE),
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
      maxFirstPaintGzipBytes: 10 * KIB,
      maxFirstPaintRawBytes: 10 * KIB,
      maxLazyGzipBytes: 1e9,
      maxLazyRawBytes: 1e9,
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
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 100 * KIB,
      maxLazyGzipBytes: 1e9,
      maxLazyRawBytes: 1e9,
    }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /FIRST PAINT RAW OVER BUDGET/)
  assert.doesNotMatch(r.out, /GZIP OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write sets BOTH gated pairs (first paint and lazy) to measurement + a MINIMUM headroom, then rounds to the step', () => {
  const entryJs = noise(30 * KIB)
  const sharedJs = noise(10 * KIB)
  const lazyJs = noise(20 * KIB) // reachable only through dynamicImports: lazy, not first paint
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

  const fpGzip = gzEntry + gzShared
  const fpRaw = entryJs.length + sharedJs.length

  assert.equal(written.measuredFirstPaintGzipBytes, fpGzip)
  assert.equal(written.measuredFirstPaintRawBytes, fpRaw)
  assert.equal(written.measuredLazyGzipBytes, gzLazy)
  assert.equal(written.measuredLazyRawBytes, lazyJs.length)
  // The lazy chunk is real weight, so the two pairs must genuinely differ — this is what
  // proves --write actually consulted the manifest's dynamicImports rather than writing the
  // same figure into both pairs.
  assert.ok(written.measuredLazyGzipBytes > 0)
  assert.notEqual(written.measuredFirstPaintGzipBytes, written.measuredLazyGzipBytes)

  // The property that matters, stated as arithmetic rather than a pinned number: each
  // ceiling clears its own measurement + minimum, and is a whole number of steps.
  assert.ok(written.maxFirstPaintGzipBytes >= fpGzip + written.minHeadroomGzipBytes)
  assert.ok(written.maxFirstPaintRawBytes >= fpRaw + written.minHeadroomRawBytes)
  assert.ok(written.maxLazyGzipBytes >= gzLazy + written.minHeadroomGzipBytes)
  assert.ok(written.maxLazyRawBytes >= lazyJs.length + written.minHeadroomRawBytes)
  assert.equal(written.maxFirstPaintGzipBytes % written.stepGzipBytes, 0)
  assert.equal(written.maxFirstPaintRawBytes % written.stepRawBytes, 0)
  assert.equal(written.maxLazyGzipBytes % written.stepGzipBytes, 0)
  assert.equal(written.maxLazyRawBytes % written.stepRawBytes, 0)
  // A bare round-up with no minimum would land within one step of the measurement. This is
  // the exact regression that shipped once, at a few thousand bytes of headroom.
  assert.ok(written.maxFirstPaintGzipBytes - fpGzip > written.stepGzipBytes)
  assert.ok(written.maxLazyGzipBytes - gzLazy > written.stepGzipBytes)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write always re-baselines both gated pairs — neither first paint nor lazy is ever frozen across writes', () => {
  // The old sum ceiling used to be carried forward untouched after its first computation.
  // Neither gated pair works that way: this proves a second --write moves BOTH ceilings off
  // a deliberately wrong placeholder value planted directly into the budget file, rather
  // than preserving it the way the old frozen sum ceiling once did.
  const root = mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'))
  const assets = path.join(root, 'frontend', 'dist', 'assets')
  mkdirSync(assets, { recursive: true })
  const entryJs = noise(30 * KIB)
  const lazyJs = noise(10 * KIB)
  writeFileSync(path.join(assets, 'index-A.js'), entryJs)
  writeFileSync(path.join(assets, 'lazy-C.js'), lazyJs)
  const manifestPath = path.join(root, 'frontend', 'dist', '.vite', 'manifest.json')
  mkdirSync(path.dirname(manifestPath), { recursive: true })
  writeFileSync(
    manifestPath,
    JSON.stringify({
      'index.html': { file: 'assets/index-A.js', isEntry: true, dynamicImports: ['lazy-chunk'] },
      'lazy-chunk': { file: 'assets/lazy-C.js' },
    }),
  )
  const budgetPath = path.join(root, 'scripts', 'verify', 'baselines', 'bundle-budget.json')
  mkdirSync(path.dirname(budgetPath), { recursive: true })

  const env = { ...process.env, VERIFY_SCAN_ROOT: root }
  /** @param {string[]} args */
  const run = (args) => {
    try {
      return execFileSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env })
    } catch (err) {
      const e = /** @type {any} */ (err)
      return `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
  }

  run(['--write'])
  const firstWritten = JSON.parse(readFileSync(budgetPath, 'utf8'))

  // A deliberately wrong placeholder that ceilingFor(measured, …) would never itself
  // compute — if lazy or first paint were ever frozen the way the sum used to be, this
  // exact value would survive the next --write untouched.
  writeFileSync(
    budgetPath,
    `${JSON.stringify({ ...firstWritten, maxLazyGzipBytes: 999_999, maxFirstPaintGzipBytes: 999_998 }, null, 2)}\n`,
  )
  run(['--write'])
  const secondWritten = JSON.parse(readFileSync(budgetPath, 'utf8'))

  assert.notEqual(secondWritten.maxLazyGzipBytes, 999_999)
  assert.notEqual(secondWritten.maxFirstPaintGzipBytes, 999_998)
  assert.equal(secondWritten.maxLazyGzipBytes, firstWritten.maxLazyGzipBytes)
  assert.equal(secondWritten.maxFirstPaintGzipBytes, firstWritten.maxFirstPaintGzipBytes)
  rmSync(root, { recursive: true, force: true })
})

test('--write preserves an existing reason rather than overwriting it with the default', () => {
  const custom = 'A REASON SOMEBODY WROTE BY HAND AND WOULD NOT WANT SILENTLY REPLACED.'
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB) },
    manifest: { 'index.html': { file: 'assets/index-A.js', isEntry: true } },
    budget: budgetFile({ ...AMPLE, reason: custom }),
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.readBudget().reason, custom)
  rmSync(r.root, { recursive: true, force: true })
})

test('non-.js/.css files under dist/assets are excluded from both totals', () => {
  const js = noise(4 * KIB)
  const manifest = { 'index.html': { file: 'assets/app.js', isEntry: true } }
  const budget = budgetFile(AMPLE)
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

test('an old-shaped budget file (first paint only, no lazy fields — the shape this file had before lazy was measured) fails loudly instead of gating nothing', () => {
  // Without an explicit guard, `lz.gzip > undefined` is `false` in JavaScript, so this
  // would otherwise print "ceiling NaN KiB" and exit 0.
  const root = mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'))
  const assets = path.join(root, 'frontend', 'dist', 'assets')
  mkdirSync(assets, { recursive: true })
  writeFileSync(path.join(assets, 'app.js'), noise(4 * KIB))
  const manifestPath = path.join(root, 'frontend', 'dist', '.vite', 'manifest.json')
  mkdirSync(path.dirname(manifestPath), { recursive: true })
  writeFileSync(
    manifestPath,
    JSON.stringify({ 'index.html': { file: 'assets/app.js', isEntry: true } }),
  )
  const budgetPath = path.join(root, 'scripts', 'verify', 'baselines', 'bundle-budget.json')
  mkdirSync(path.dirname(budgetPath), { recursive: true })
  writeFileSync(
    budgetPath,
    JSON.stringify({
      measuredAt: '2026-01-01',
      measuredFirstPaintGzipBytes: 0,
      measuredFirstPaintRawBytes: 0,
      minHeadroomGzipBytes: MIN_GZIP,
      minHeadroomRawBytes: MIN_RAW,
      stepGzipBytes: 5 * KIB,
      stepRawBytes: 20 * KIB,
      // The shape this file actually had at the previous commit: an old sum ceiling
      // (maxGzipBytes/maxRawBytes) alongside a first-paint pair, but no lazy fields yet.
      maxGzipBytes: 1e9,
      maxRawBytes: 1e9,
      maxFirstPaintGzipBytes: 1e9,
      maxFirstPaintRawBytes: 1e9,
      headroomFirstPaintGzipBytes: 0,
      headroomFirstPaintRawBytes: 0,
      reason: 'old-shaped fixture — first paint only, no lazy fields at all',
      // maxLazyGzipBytes / maxLazyRawBytes deliberately absent
    }),
  )
  let status = 0
  let out = ''
  try {
    out = execFileSync(process.execPath, [CHECK], {
      encoding: 'utf8',
      env: { ...process.env, VERIFY_SCAN_ROOT: root },
    })
  } catch (err) {
    const e = /** @type {any} */ (err)
    status = e.status ?? 1
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  assert.notEqual(status, 0, out)
  assert.doesNotMatch(out, /NaN/)
  assert.match(out, /maxLazyGzipBytes/)
  assert.match(out, /maxLazyRawBytes/)
  assert.match(out, /--write/)
  rmSync(root, { recursive: true, force: true })
})

test('a manifest with no isEntry:true chunk fails, not a false pass', () => {
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB) },
    manifest: {
      'index.html': { file: 'assets/index-A.js' }, // no isEntry anywhere in this manifest
    },
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /isEntry/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an unparsable manifest fails, not passes', () => {
  const r = runIn({
    files: { 'index-A.js': noise(4 * KIB) },
    manifest: '{ this is not valid JSON',
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /manifest\.json/)
  assert.match(r.out, /not valid JSON/)
  rmSync(r.root, { recursive: true, force: true })
})

test('css listed on a chunk reachable only through dynamicImports never enters first paint, even though the chunk it belongs to might', () => {
  const entryJs = noise(5 * KIB)
  const lazyJs = noise(10 * KIB)
  const lazyCss = noise(20 * KIB) // large: makes inclusion/exclusion unmistakable
  const files = { 'index-A.js': entryJs, 'lazy-C.js': lazyJs, 'lazy-C.css': lazyCss }
  const manifest = {
    'index.html': { file: 'assets/index-A.js', isEntry: true, dynamicImports: ['lazy-chunk'] },
    'lazy-chunk': { file: 'assets/lazy-C.js', css: ['assets/lazy-C.css'] },
  }
  const r = runIn({
    files,
    manifest,
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 0, r.out)
  // First paint is the entry alone — neither the lazy chunk's own JS nor its css.
  const expectedFpGzipKib = `${(gzipSync(entryJs, { level: 9 }).length / KIB).toFixed(1)} KiB`
  assert.match(r.out, new RegExp(`first paint ${expectedFpGzipKib.replace('.', '\\.')} gzip`))
  rmSync(r.root, { recursive: true, force: true })
})

test('a .js under dist/assets the manifest never mentions counts toward the sum but not first paint or lazy', () => {
  const entryJs = noise(5 * KIB)
  const orphanJs = noise(10 * KIB) // a real file, present on disk, absent from the manifest entirely
  const files = { 'index-A.js': entryJs, 'orphan.js': orphanJs }
  const manifest = { 'index.html': { file: 'assets/index-A.js', isEntry: true } }
  const r = runIn({
    files,
    manifest,
    budget: budgetFile(AMPLE),
  })
  assert.equal(r.status, 0, r.out)
  const expectedFpGzipKib = `${(gzipSync(entryJs, { level: 9 }).length / KIB).toFixed(1)} KiB`
  const expectedSumGzipKib = `${(
    (gzipSync(entryJs, { level: 9 }).length + gzipSync(orphanJs, { level: 9 }).length) /
    KIB
  ).toFixed(1)} KiB`
  assert.match(r.out, new RegExp(`first paint ${expectedFpGzipKib.replace('.', '\\.')} gzip`))
  assert.match(
    r.out,
    new RegExp(`sum of frontend/dist/assets is ${expectedSumGzipKib.replace('.', '\\.')} gzip`),
  )
  rmSync(r.root, { recursive: true, force: true })
})
