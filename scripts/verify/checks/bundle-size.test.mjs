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
 * `mkdtempSync` directory instead.
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
 * @param {{ maxGzipBytes: number, maxRawBytes: number, reason?: string }} over
 */
function budgetFile(over) {
  return {
    measuredAt: '2026-01-01',
    measuredGzipBytes: 0,
    measuredRawBytes: 0,
    minHeadroomGzipBytes: MIN_GZIP,
    minHeadroomRawBytes: MIN_RAW,
    stepGzipBytes: 5 * KIB,
    stepRawBytes: 20 * KIB,
    headroomGzipBytes: 0,
    headroomRawBytes: 0,
    reason: 'fixture',
    ...over,
  }
}

/**
 * `index.html` as Vite writes it: the entry as a module `<script>`, CSS as a
 * `<link rel="stylesheet">`, and any chunk the entry statically needs as a
 * `<link rel="modulepreload">`. This markup IS the first-load set, which is why the check
 * reads it rather than pattern-matching filenames.
 *
 * @param {(string | { name: string, rel: string })[]} named
 * @returns {string}
 */
function indexHtml(named) {
  const tags = named.map((n) => {
    const name = typeof n === 'string' ? n : n.name
    const rel = typeof n === 'string' ? (name.endsWith('.css') ? 'stylesheet' : null) : n.rel
    if (rel === null) return `    <script type="module" crossorigin src="/assets/${name}"></script>`
    return `    <link rel="${rel}" crossorigin href="/assets/${name}">`
  })
  return `<!doctype html>\n<html>\n  <head>\n    <link rel="icon" href="/favicon.svg" />\n${tags.join('\n')}\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`
}

/**
 * Builds a throwaway root with `frontend/dist/assets/<files>`, a `frontend/dist/index.html`
 * and a budget file, runs the check against it via VERIFY_SCAN_ROOT, and returns what it
 * printed.
 *
 * `entry` names the first-load set. Omitted, it defaults to every `.js`/`.css` fixture
 * file, so a test with nothing to say about code splitting reads exactly as it did while
 * the gate was the sum — first load and sum are then the same number. `entry: null` writes
 * no index.html at all.
 *
 * @param {{ files?: Record<string, Buffer | string> | null, entry?: (string | { name: string, rel: string })[] | null, budget?: object | null, args?: string[] }} opts
 * @returns {{ status: number, out: string, root: string, readBudget: () => any }}
 */
function runIn({ files, entry, budget, args = [] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'))
  if (files) {
    const dist = path.join(root, 'frontend', 'dist')
    const assets = path.join(dist, 'assets')
    mkdirSync(assets, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(assets, name), content)
    }
    if (entry !== null) {
      const named = entry ?? Object.keys(files).filter((n) => /\.(js|css)$/.test(n))
      writeFileSync(path.join(dist, 'index.html'), indexHtml(named))
    }
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

test('an under-budget dist is green and prints the headroom as a WARNING line', () => {
  const js = noise(10 * KIB)
  const r = runIn({
    files: { 'app.js': js },
    budget: budgetFile({
      maxGzipBytes: gzipSync(js, { level: 9 }).length + MIN_GZIP + KIB,
      maxRawBytes: js.length + MIN_RAW + KIB,
    }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /^WARNING: headroom is /m)
  rmSync(r.root, { recursive: true, force: true })
})

test('headroom below the budget’s own designed minimum is WARNED about, while still passing', () => {
  // THE REGIME THIS CHECK'S HEADER CALLS THE DANGEROUS ONE, and until this line existed
  // nothing said a word about it: the ceiling holds, the row is green, and there is less
  // slack left than one ordinary phase of work — so the next ordinary commit turns it red
  // and somebody raises the ceiling on sight.
  const js = noise(10 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const r = runIn({
    files: { 'app.js': js },
    budget: budgetFile({ maxGzipBytes: gz + KIB, maxRawBytes: js.length + MIN_RAW + KIB }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /headroom has fallen BELOW the minimum/)
  assert.match(r.out, /gzip .* against 25\.0 KiB/)
  // DISCRIMINATOR: the same bundle under a ceiling with ample headroom must NOT warn, or
  // the assertion above would pass against a line that is simply always printed.
  const ample = runIn({
    files: { 'app.js': js },
    budget: budgetFile({
      maxGzipBytes: gz + MIN_GZIP + KIB,
      maxRawBytes: js.length + MIN_RAW + KIB,
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
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /WARNING: largest JS chunk is app\.js/)
  assert.doesNotMatch(r.out, /largest JS chunk is style\.css/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an incompressible over-budget file is RED, naming both the gzip and raw overage', () => {
  const js = noise(200 * KIB)
  const r = runIn({
    files: { 'huge.js': js },
    budget: budgetFile({ maxGzipBytes: 10 * KIB, maxRawBytes: 10 * KIB }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /GZIP OVER BUDGET/)
  assert.match(r.out, /RAW OVER BUDGET/)
  assert.match(r.out, /reasoned edit/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a highly compressible file trips RAW OVER BUDGET without tripping gzip', () => {
  // Zeros gzip to almost nothing: this is the case a gzip-only budget would miss entirely,
  // and it is a real cost — the browser still parses and compiles every raw byte.
  const js = Buffer.alloc(400 * KIB, 0x61)
  const r = runIn({
    files: { 'repetitive.js': js },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 100 * KIB }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /RAW OVER BUDGET/)
  assert.doesNotMatch(r.out, /GZIP OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write sets the ceiling to measurement + a MINIMUM headroom, then rounds up to the step', () => {
  const js = noise(30 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const r = runIn({ files: { 'app.js': js }, budget: null, args: ['--write'] })
  assert.equal(r.status, 0, r.out)
  const written = r.readBudget()

  assert.equal(written.measuredGzipBytes, gz)
  assert.equal(written.measuredRawBytes, js.length)
  // The property that matters, stated as arithmetic rather than a pinned number: the
  // ceiling clears measurement + minimum, and is a whole number of steps.
  assert.ok(written.maxGzipBytes >= gz + written.minHeadroomGzipBytes)
  assert.ok(written.maxRawBytes >= js.length + written.minHeadroomRawBytes)
  assert.equal(written.maxGzipBytes % written.stepGzipBytes, 0)
  assert.equal(written.maxRawBytes % written.stepRawBytes, 0)
  // A bare round-up with no minimum would land within one step of the measurement. This is
  // the exact regression that shipped once, at 3,719 B of headroom.
  assert.ok(written.maxGzipBytes - gz > written.stepGzipBytes)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write preserves an existing reason rather than overwriting it with the default', () => {
  const custom = 'A REASON SOMEBODY WROTE BY HAND AND WOULD NOT WANT SILENTLY REPLACED.'
  const r = runIn({
    files: { 'app.js': noise(4 * KIB) },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9, reason: custom }),
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  assert.equal(r.readBudget().reason, custom)
  rmSync(r.root, { recursive: true, force: true })
})

/**
 * THE RATCHET, AS ARITHMETIC RATHER THAN PROSE.
 *
 * On 2026-09-21 the recorded ceiling stopped equalling what `buildBudget()` derives: the
 * measured quantity was corrected from the sum of dist/assets to the first-load set while
 * the ceiling itself was deliberately HELD, which left the file tighter than the formula.
 * From that moment a bare `--write` — the one command the baseline's own `reason` tells
 * people to use — would have silently re-derived and WIDENED both ceilings, producing a
 * diff that reads like a routine re-measurement. That is exactly the unread ceiling raise
 * every paragraph of that `reason` exists to prevent, so the guarantee cannot live in the
 * prose it is a guarantee about.
 *
 * The fixture is that situation exactly: a ceiling far below what this measurement would
 * derive. Before the clamp, `maxGzipBytes` comes back above 1 KiB and this fails.
 */
test('--write can only LOWER an existing ceiling, never raise it', () => {
  const js = noise(40 * KIB)
  const r = runIn({
    files: { 'app.js': js },
    // Absurdly tight on purpose: any re-derivation from a 40 KiB measurement must exceed it.
    budget: budgetFile({ maxGzipBytes: KIB, maxRawBytes: 4 * KIB }),
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  const written = r.readBudget()

  assert.equal(written.maxGzipBytes, KIB, 'the recorded gzip ceiling must be held, not re-derived')
  assert.equal(written.maxRawBytes, 4 * KIB, 'the recorded raw ceiling must be held, not re-derived')
  // Held rather than re-derived means the headroom it writes is NEGATIVE, and the writer
  // has to be told so — a silent clamp would just move the surprise to the next run.
  assert.ok(written.headroomGzipBytes < 0)
  assert.match(r.out, /WARNING: the recorded ceiling was HELD/)
  assert.match(r.out, /--raise/)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write --raise re-derives the ceiling and says out loud that it widened it', () => {
  const js = noise(40 * KIB)
  const gz = gzipSync(js, { level: 9 }).length
  const r = runIn({
    files: { 'app.js': js },
    budget: budgetFile({ maxGzipBytes: KIB, maxRawBytes: 4 * KIB }),
    args: ['--write', '--raise'],
  })
  assert.equal(r.status, 0, r.out)
  const written = r.readBudget()

  // The escape hatch genuinely works — the ratchet is one-way, not welded shut.
  assert.ok(written.maxGzipBytes > KIB)
  assert.ok(written.maxGzipBytes >= gz + written.minHeadroomGzipBytes)
  assert.match(r.out, /WARNING: --raise was given/)
  assert.match(r.out, /WIDENS/)
  rmSync(r.root, { recursive: true, force: true })
})

/**
 * The clamp must not turn the ordinary case — a bundle that genuinely SHRANK — into a
 * frozen ceiling that can never come back down. Lowering is the whole point of re-recording.
 */
test('--write still lowers the ceiling when the bundle shrank', () => {
  const r = runIn({
    files: { 'app.js': noise(4 * KIB) },
    budget: budgetFile({ maxGzipBytes: 500 * KIB, maxRawBytes: 2000 * KIB }),
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  const written = r.readBudget()

  assert.ok(written.maxGzipBytes < 500 * KIB, 'a shrunk bundle must still tighten the ceiling')
  assert.ok(written.maxRawBytes < 2000 * KIB)
  assert.doesNotMatch(r.out, /WARNING: the recorded ceiling was HELD/)
  rmSync(r.root, { recursive: true, force: true })
})

/**
 * The dev-runtime guard, in the shape the real failure had: a MINIFIED bundle that is
 * nonetheless React's development build. Size alone cannot catch it — a dev build that
 * still fits under the ceiling passes every other assertion in this file — so the marker
 * is the only signal, and this is the test that keeps it wired up.
 */
test('a first-load chunk carrying React’s development runtime is RED, however small', () => {
  const r = runIn({
    // Deliberately tiny: this must fail on the MARKER, not on the byte count.
    files: { 'app.js': Buffer.from('var a=1;/*Each child in a list should have a unique key*/') },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /DEVELOPMENT runtime/)
  assert.match(r.out, /envDir/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an ordinary production chunk is not mistaken for a development one', () => {
  const r = runIn({
    files: { 'app.js': noise(8 * KIB) },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 0, r.out)
  assert.doesNotMatch(r.out, /DEVELOPMENT runtime/)
  rmSync(r.root, { recursive: true, force: true })
})

test('non-.js/.css files under dist/assets are excluded from both totals', () => {
  const js = noise(4 * KIB)
  const withFont = runIn({
    files: { 'app.js': js, 'font.woff2': noise(300 * KIB) },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  const without = runIn({
    files: { 'app.js': js },
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  /** @param {string} out */
  const total = (out) => /total shipped (\S+ KiB) gzip \/ (\S+ KiB) raw/.exec(out)?.slice(1, 3)
  assert.deepEqual(total(withFont.out), total(without.out))
  rmSync(withFont.root, { recursive: true, force: true })
  rmSync(without.root, { recursive: true, force: true })
})

// --- The gate is the FIRST-LOAD set, not the sum -------------------------------------
//
// These six are the whole argument for reading index.html. The two that matter most are
// the first two: identical bytes on disk, one `<link>` apart, opposite verdicts. Without
// that pair, "a lazy chunk is outside the gate" could be satisfied by a check that had
// simply stopped measuring the second file for any reason at all.

test('a chunk index.html does not name is outside the gate, and is still counted in the printed sum', () => {
  const eager = noise(10 * KIB)
  const lazy = noise(60 * KIB)
  const r = runIn({
    files: { 'index.js': eager, 'owner-pages.js': lazy },
    entry: ['index.js'],
    budget: budgetFile({
      maxGzipBytes: gzipSync(eager, { level: 9 }).length + KIB,
      maxRawBytes: eager.length + KIB,
    }),
  })
  assert.equal(r.status, 0, r.out)
  // The sum is far over that ceiling. Being green is the claim.
  assert.match(r.out, /first load /)
  // And the bytes nobody downloads on first paint are still reported, not hidden.
  assert.match(r.out, /WARNING: total shipped /)
  assert.match(r.out, /owner-pages\.js/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a chunk index.html modulepreloads IS inside the gate — the same bytes, one link away', () => {
  // DISCRIMINATOR for the test above, and the regression Task 15 measured for real: six
  // lazy entry points made rolldown hoist shared code into chunks Vite then modulepreloads
  // from index.html, and the operator's first load GREW. A gate that read only the
  // `<script>` tag would have called that green.
  const eager = noise(10 * KIB)
  const lazy = noise(60 * KIB)
  const files = { 'index.js': eager, 'shared.js': lazy }
  const budget = budgetFile({
    maxGzipBytes: gzipSync(eager, { level: 9 }).length + KIB,
    maxRawBytes: eager.length + KIB,
  })
  const r = runIn({
    files,
    entry: ['index.js', { name: 'shared.js', rel: 'modulepreload' }],
    budget,
  })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /GZIP OVER BUDGET/)
  assert.match(r.out, /RAW OVER BUDGET/)
  rmSync(r.root, { recursive: true, force: true })
})

test('a stylesheet index.html links counts toward first load; one it does not link does not', () => {
  const js = noise(4 * KIB)
  const css = noise(40 * KIB)
  const budget = budgetFile({
    maxGzipBytes: gzipSync(js, { level: 9 }).length + KIB,
    maxRawBytes: js.length + KIB,
  })
  const linked = runIn({ files: { 'index.js': js, 'index.css': css }, budget })
  assert.equal(linked.status, 1, linked.out)
  const unlinked = runIn({
    files: { 'index.js': js, 'index.css': css },
    entry: ['index.js'],
    budget,
  })
  assert.equal(unlinked.status, 0, unlinked.out)
  rmSync(linked.root, { recursive: true, force: true })
  rmSync(unlinked.root, { recursive: true, force: true })
})

test('a missing frontend/dist/index.html fails clearly: the first-load set is unknown, not empty', () => {
  const r = runIn({
    files: { 'index.js': noise(4 * KIB) },
    entry: null,
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /index\.html/)
  assert.match(r.out, /cannot be read as "nothing loads"/)
  rmSync(r.root, { recursive: true, force: true })
})

test('index.html naming an asset that is not on disk is a failure, not a quieter measurement', () => {
  // A stale index.html against a fresh assets directory measures a SMALLER first load than
  // the truth and passes. Silently under-measuring is the one outcome worse than red here.
  const r = runIn({
    files: { 'index.js': noise(4 * KIB) },
    entry: ['index.js', { name: 'gone.js', rel: 'modulepreload' }],
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /gone\.js/)
  assert.match(r.out, /stale/)
  rmSync(r.root, { recursive: true, force: true })
})

test('an index.html that names no script refuses a verdict rather than passing on zero bytes', () => {
  const r = runIn({
    files: { 'index.js': noise(4 * KIB) },
    entry: [],
    budget: budgetFile({ maxGzipBytes: 1e9, maxRawBytes: 1e9 }),
  })
  assert.equal(r.status, 1)
  assert.match(r.out, /no script/)
  rmSync(r.root, { recursive: true, force: true })
})

test('--write records the first-load measurement, not the sum of dist/assets', () => {
  const eager = noise(30 * KIB)
  const lazy = noise(90 * KIB)
  const r = runIn({
    files: { 'index.js': eager, 'owner-pages.js': lazy },
    entry: ['index.js'],
    budget: null,
    args: ['--write'],
  })
  assert.equal(r.status, 0, r.out)
  const written = r.readBudget()
  assert.equal(written.measuredRawBytes, eager.length)
  assert.equal(written.measuredGzipBytes, gzipSync(eager, { level: 9 }).length)
  rmSync(r.root, { recursive: true, force: true })
})
