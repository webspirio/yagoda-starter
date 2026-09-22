#!/usr/bin/env node
/**
 * The bundle size budget.
 *
 * `build` (Task 14) proves only that Vite exited zero. It prints "(!) Some chunks are
 * larger than 500 kB after minification" and nothing records or gates that number, so the
 * shipped payload could double without any row changing colour. Root CLAUDE.md's
 * "Deployment" section already names the audience this matters for: operators at rural
 * collection points, on mobile data. Transfer size is not a nice-to-have metric for them —
 * it is the user-visible product.
 *
 * Gzip is the number with a budget, because gzip is what actually crosses the wire. Raw is
 * measured and budgeted too, at a separate, wider step, because it is what the phone must
 * parse and compile, which is a real cost on cheap hardware even after the network is done.
 *
 * THE CEILING IS NOT THE MEASUREMENT, AND THE HEADROOM IS NOT AN ACCIDENT OF ROUNDING
 * EITHER. This check went through two corrections to get here, both worth keeping visible
 * because the same mistake is easy to make twice, at two different scales:
 *
 * (1) The reference this check was ported from (webspirio/yagoda-crm) first pinned its
 *     budget to the measured byte count exactly, with zero slack, and it broke on the very
 *     next commit over an **18-byte** gzip increase from adding one small helper — ordinary
 *     work, not a regression.
 * (2) This port's own first version fixed that by rounding the measurement up to the next
 *     5 KiB (gzip) / 20 KiB (raw) step and stopping there — which sounds safer, but a
 *     measurement that happens to fall just past a step boundary rounds up to almost
 *     nothing: the very first real measurement here landed at 3,719 B of gzip headroom,
 *     1.3% of the bundle. That is the SAME failure as (1) at a smaller scale: the reference
 *     itself measured ordinary phase work at 13–23 KiB gzip per phase, so a ceiling with a
 *     few KiB of slack — or less — still trips on the next ordinary commit, and someone
 *     raises it without reading, which is exactly the behaviour a budget exists to prevent.
 *
 * THE RULE THIS CHECK ACTUALLY USES: `--write` sets the ceiling to the measurement plus a
 * MINIMUM headroom sized to intent — 25 KiB for gzip, 100 KiB for raw, roughly one
 * ordinary phase of work by the reference's own numbers — and only THEN rounds that sum up
 * to the next step (5 KiB / 20 KiB). The step is cosmetic (it keeps the ceiling a round
 * number); the minimum headroom is what actually does the ratcheting work. A ceiling with
 * single-digit-percent headroom is not a stricter budget, it is a budget that trains people
 * to raise it on sight — this rule sizes the slack to what ordinary work costs so ordinary
 * work does not need a ceiling edit, and a new dependency pulled in whole still does.
 *
 * What must still fail is a REGRESSION: a new dependency pulled in whole, an accidental
 * whole-package import, a chart library added for one small feature. Those are tens or
 * hundreds of KiB, not bytes — comfortably outside the minimum headroom, and exactly what
 * this check exists to catch.
 *
 * The headroom is not a secret kept for the day the budget breaks — it is printed, as a
 * line starting with the literal word `WARNING`, on every run that passes. The runner's own
 * `warningLines()` (scripts/verify/run.mjs) surfaces any line matching `/WARNING|\(!\)/`
 * from a check's output even when that check's exit code is 0, specifically so a green
 * `bundle` row is never read as "nothing to watch here" — a budget only ever heard from
 * when it breaks is a budget nobody watches, and the point of this row is the number, not
 * the colour.
 *
 * WHAT THIS GATES IS THE FIRST-LOAD SET, NOT THE SUM OF dist/assets, and that is a third
 * correction, learned the same way as the two above. This check gated the sum until
 * 2026-09-21, on a premise its own header stated out loud: the app's JS output was a SINGLE
 * chunk, no code splitting at all, so the sum and what a first visit downloads were very
 * nearly the same number. Splitting the owner-only routes out of the operator's bundle
 * falsified that premise — and turned this row RED while making the operator's real
 * download 17.9 KiB gzip SMALLER, because two chunks compress worse than one does. A budget
 * that goes red exactly when the thing it exists to protect improves is not a strict budget,
 * it is a broken one. The cheap answer was to raise the ceiling; it was refused, and the
 * ceiling has not moved.
 *
 * THE FIRST-LOAD SET IS READ FROM frontend/dist/index.html, never pattern-matched off
 * filenames: the entry `<script type="module">`, every `<link rel="stylesheet">`, and every
 * `<link rel="modulepreload">`. That last one is what keeps this a gate rather than an
 * accounting trick. Vite emits a modulepreload for any chunk the entry statically needs, so
 * a split that hoists shared code into new eagerly-preloaded chunks lands back INSIDE the
 * budget and is caught — measured on this repo, six lazy entry points produced seven such
 * chunks and GREW the first load rather than shrinking it. Only genuinely deferred code
 * escapes the ceiling, and it escapes by being deferred, which is the whole point.
 *
 * THE SUM IS STILL MEASURED AND STILL PRINTED, as an unconditional WARNING line on every
 * run, alongside how much of it is deferred. It is what the CDN stores and what somebody
 * who opens every screen eventually pays, so dropping it would trade one blind spot for
 * another. It simply is not the gate any more.
 *
 * WHAT REMAINS INVISIBLE HERE, stated next to the number it qualifies: caching, so a
 * returning visitor's real cost is smaller than anything printed; the deferred bytes, which
 * carry no ceiling at all, so a lazy route may grow without limit and this row stays green;
 * per-chunk size, so one eager file may grow to the whole budget on its own; and the
 * build's freshness, since this measures whatever the last `build` left on disk. A green
 * row is a claim about bytes, never about load time.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

import { errMessage } from '../hash.mjs'
import { scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const ASSETS = path.join(ROOT, 'frontend', 'dist', 'assets')
const ASSETS_REL = path.relative(ROOT, ASSETS)
const INDEX_HTML = path.join(ROOT, 'frontend', 'dist', 'index.html')
const INDEX_REL = path.relative(ROOT, INDEX_HTML)
const BUDGET_REL = 'scripts/verify/baselines/bundle-budget.json'
const BUDGET = path.join(ROOT, BUDGET_REL)

// The minimum headroom the ceiling must carry — sized to intent, not to a rounding
// coincidence. See the file header for why this, not the step below, is what actually
// makes the ratchet meaningful: ~25 KiB gzip / ~100 KiB raw is roughly one ordinary phase
// of feature work by the reference's own measured history (13-23 KiB gzip per phase).
const MIN_HEADROOM_GZIP_BYTES = 25 * 1024
const MIN_HEADROOM_RAW_BYTES = 100 * 1024

// The rounding step applied AFTER the minimum headroom is added — cosmetic (keeps the
// ceiling a round number), not the source of the ratchet's slack.
const STEP_GZIP_BYTES = 5 * 1024
const STEP_RAW_BYTES = 20 * 1024

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('bundle: RED\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/** @param {number} n @returns {string} */
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`

/**
 * @typedef {object} AssetFile
 * @property {string} file
 * @property {number} raw
 * @property {number} gzip
 */

/**
 * Reads every `.js`/`.css` file directly under frontend/dist/assets and measures its raw
 * and gzip (level 9, matching what a production server would negotiate at best-effort)
 * size. Font files and other static assets Vite also copies into dist/assets are counted
 * in neither total: they do not grow with this codebase's own source the way script and
 * style bundles do, and mixing them in would let a genuine JS/CSS regression hide inside an
 * unrelated font swap.
 *
 * @returns {AssetFile[]}
 */
function measure() {
  /** @type {string[]} */
  let names
  try {
    names = readdirSync(ASSETS)
  } catch {
    fail([
      `${ASSETS_REL} does not exist — build the frontend first (npm run build).`,
      'A missing directory is not "zero bytes, budget met": there is nothing to measure, ' +
        'which is a failure to check, not a pass.',
    ])
  }
  /** @type {AssetFile[]} */
  const files = []
  for (const f of names) {
    if (!/\.(js|css)$/.test(f)) continue
    const b = readFileSync(path.join(ASSETS, f))
    files.push({ file: f, raw: b.length, gzip: gzipSync(b, { level: 9 }).length })
  }
  if (files.length === 0) {
    fail([`${ASSETS_REL} has no .js or .css file in it — is the build actually producing output?`])
  }
  assertProductionBuild(files)
  return files
}

/**
 * React's development runtime, shipped to users, is a bug this check can actually see —
 * and the only one it can, because the output is still MINIFIED and therefore looks
 * entirely normal. It cost ~291 KiB raw / ~82 KiB gzip here and, worse, swaps React for
 * its slow path with DevTools hooks and warning machinery attached.
 *
 * How it happened, so the next person recognises it: the repo keeps ONE `.env` at the
 * root because docker compose reads it, and it carries `NODE_ENV=development` for the
 * backend. Any arrangement that lets Vite's env machinery see that file — `envDir: '..'`
 * is the obvious one, `loadEnv('..', 'VITE_')` is the one that looks safe and is not —
 * makes Vite honour that NODE_ENV and build in development mode. Nothing warns. The
 * build succeeds, the bundle is minified, and the only symptom is a bigger number on a
 * row somebody has to be reading.
 *
 * These marker strings are dev-only React branches that survive minification because
 * they are string literals. Checked against the first-load JS only: a dev-mode build
 * puts them in the entry chunk, and scanning every asset would make this O(bundle) for
 * no extra signal.
 *
 * @param {AssetFile[]} files
 */
function assertProductionBuild(files) {
  const markers = ['Each child in a list should have a unique', 'Invalid hook call']
  for (const f of files) {
    if (!f.file.endsWith('.js')) continue
    const text = readFileSync(path.join(ASSETS, f.file), 'utf8')
    const hit = markers.find((m) => text.includes(m))
    if (hit === undefined) continue
    fail([
      `${ASSETS_REL}/${f.file} contains React's DEVELOPMENT runtime (matched ${JSON.stringify(hit)}).`,
      'This build shipped dev-only React to users: warning machinery, DevTools hooks and the',
      'slow render path, for roughly 291 KiB raw / 82 KiB gzip of dead weight. It is still',
      'minified, so nothing else about the output looks wrong and no other row here catches it.',
      '',
      'Almost always the cause is Vite reading the repo-root .env, which carries',
      'NODE_ENV=development for the backend and compose. See frontend/vite.config.ts: the root',
      "file's VITE_ keys are read by hand precisely so Vite's env machinery never sees",
      'NODE_ENV. `envDir: \'..\'` and `loadEnv(mode, \'..\', \'VITE_\')` both reintroduce it —',
      'the prefix argument filters what loadEnv RETURNS, not what it reads.',
    ])
  }
}

/**
 * The first-load set: every asset the browser fetches before it can paint, read from
 * index.html rather than guessed from filenames. Vite writes three tag shapes that mean
 * "fetch this now" — the entry `<script type="module">`, `<link rel="stylesheet">` and
 * `<link rel="modulepreload">` — and reading the markup means this stays correct through
 * any future change to chunk naming or splitting strategy without anyone editing a regex.
 *
 * Both failure modes below exist because the dangerous outcome here is not a red row, it is
 * a green one measured over less than the truth: a stale index.html naming a file that is
 * gone, or one naming nothing at all, would both otherwise report a comfortably small first
 * load and pass. See `refuseEmptyScan`'s rationale in the verify skill — a check that
 * scanned nothing must refuse a verdict.
 *
 * @param {AssetFile[]} files
 * @returns {AssetFile[]}
 */
function firstLoad(files) {
  /** @type {string} */
  let html
  try {
    html = readFileSync(INDEX_HTML, 'utf8')
  } catch {
    fail([
      `${INDEX_REL} does not exist — build the frontend first (npm run build).`,
      'It is what names the first-load set, so without it that set is UNKNOWN, which ' +
        'cannot be read as "nothing loads": a ceiling met by measuring nothing is not a ' +
        'budget, it is a check that did not run.',
    ])
  }

  /** @type {string[]} */
  const refs = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) refs.push(m[1])
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel=["']?([a-z-]+)/i.exec(m[0])?.[1]?.toLowerCase()
    if (rel !== 'stylesheet' && rel !== 'modulepreload') continue
    const href = /\bhref=["']([^"']+)["']/i.exec(m[0])?.[1]
    if (href) refs.push(href)
  }

  const byName = new Map(files.map((f) => [f.file, f]))
  /** @type {AssetFile[]} */
  const set = []
  /** @type {string[]} */
  const missing = []
  const seen = new Set()
  for (const ref of refs) {
    const name = ref.split('/').pop() ?? ''
    if (!/\.(js|css)$/.test(name) || seen.has(name)) continue
    seen.add(name)
    const f = byName.get(name)
    if (f) set.push(f)
    else missing.push(name)
  }

  if (missing.length > 0) {
    fail([
      `${INDEX_REL} references ${missing.join(', ')}, which ${ASSETS_REL} does not contain.`,
      'That is a stale or half-written build. Measuring only the referenced files that ' +
        'happen to be present would report a SMALLER first load than the truth and pass, ' +
        'and under-measuring is the one outcome worse than a red row here — rebuild.',
    ])
  }
  if (set.length === 0) {
    fail([
      `${INDEX_REL} names no script or stylesheet under ${ASSETS_REL}.`,
      'Nothing was measured, so there is no verdict to give: reporting zero bytes against ' +
        'a ceiling and calling it a pass is the failure this refusal exists to prevent.',
    ])
  }
  return set
}

/**
 * @typedef {object} Budget
 * @property {string} measuredAt
 * @property {number} measuredGzipBytes
 * @property {number} measuredRawBytes
 * @property {number} minHeadroomGzipBytes
 * @property {number} minHeadroomRawBytes
 * @property {number} stepGzipBytes
 * @property {number} stepRawBytes
 * @property {number} maxGzipBytes
 * @property {number} maxRawBytes
 * @property {number} headroomGzipBytes
 * @property {number} headroomRawBytes
 * @property {string} reason
 */

/**
 * The ceiling is `measurement + minimum headroom`, THEN rounded up to the next step — the
 * minimum headroom is what makes this a ratchet with real teeth; the step only keeps the
 * result a round number. Recording `minHeadroomGzipBytes`/`minHeadroomRawBytes`/
 * `stepGzipBytes`/`stepRawBytes` alongside the result means the next person to re-measure
 * follows this exact arithmetic instead of inventing their own rounding rule (the mistake
 * this check's own history already made once — see the file header).
 *
 * THE RATCHET IS ARITHMETIC HERE, NOT PROSE IN THE BASELINE. The derived ceiling is
 * clamped to any ceiling already recorded, so `--write` can only ever LOWER a ceiling;
 * raising one takes `--raise` and is announced. Without that clamp, `--write` is a
 * one-command widening that produces a diff reading like a routine re-measurement —
 * which is precisely what every paragraph of `reason` exists to prevent, and it became
 * reachable the moment the recorded ceiling stopped equalling this function's own output
 * (2026-09-21: the ceiling was held while the measured quantity was corrected, so the
 * file is now deliberately tighter than the arithmetic below would derive).
 *
 * @param {number} gzip
 * @param {number} raw
 * @param {string | undefined} previousReason
 * @param {{ maxGzipBytes?: number, maxRawBytes?: number } | undefined} [previous] existing baseline, whose ceiling caps the result
 * @param {boolean} [allowRaise] explicit `--raise`: permit a ceiling above `previous`
 * @returns {Budget}
 */
function buildBudget(gzip, raw, previousReason, previous, allowRaise = false) {
  const derivedGzip = Math.ceil((gzip + MIN_HEADROOM_GZIP_BYTES) / STEP_GZIP_BYTES) * STEP_GZIP_BYTES
  const derivedRaw = Math.ceil((raw + MIN_HEADROOM_RAW_BYTES) / STEP_RAW_BYTES) * STEP_RAW_BYTES
  const prevGzip = typeof previous?.maxGzipBytes === 'number' ? previous.maxGzipBytes : undefined
  const prevRaw = typeof previous?.maxRawBytes === 'number' ? previous.maxRawBytes : undefined
  const maxGzipBytes =
    !allowRaise && prevGzip !== undefined ? Math.min(derivedGzip, prevGzip) : derivedGzip
  const maxRawBytes =
    !allowRaise && prevRaw !== undefined ? Math.min(derivedRaw, prevRaw) : derivedRaw
  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    measuredGzipBytes: gzip,
    measuredRawBytes: raw,
    minHeadroomGzipBytes: MIN_HEADROOM_GZIP_BYTES,
    minHeadroomRawBytes: MIN_HEADROOM_RAW_BYTES,
    stepGzipBytes: STEP_GZIP_BYTES,
    stepRawBytes: STEP_RAW_BYTES,
    maxGzipBytes,
    maxRawBytes,
    headroomGzipBytes: maxGzipBytes - gzip,
    headroomRawBytes: maxRawBytes - raw,
    reason:
      previousReason ??
      'The ceiling is `measurement + a MINIMUM headroom`, THEN rounded up to the next step ' +
        '(minHeadroomGzipBytes/minHeadroomRawBytes are the headroom; stepGzipBytes/' +
        'stepRawBytes are only cosmetic rounding on top of it) — never the measurement ' +
        'itself, and never a bare round-up with no minimum either. Both corrections in that ' +
        'sentence are load-bearing, learned in that order. First: the reference this check ' +
        'was ported from (webspirio/yagoda-crm) pinned the ceiling to the exact measured ' +
        'byte count with zero slack, and it broke on the very next commit over an 18-byte ' +
        'gzip increase from adding one small helper — ordinary work, not a regression. ' +
        "Second, and this repo's own mistake: this check's first version fixed that by " +
        'rounding the raw measurement up to the next step and stopping there, with no ' +
        'minimum — and the very first real measurement here landed at 3,719 B of gzip ' +
        'headroom, 1.3% of the bundle, because the measurement happened to fall just past a ' +
        'step boundary. That is the SAME failure as the 18-byte story, just at a larger ' +
        'scale: the reference itself measured ordinary phase work at 13-23 KiB gzip per ' +
        'phase, so single-digit-percent headroom does not defend against ordinary growth, ' +
        'it just delays the next forced, unread ceiling raise by one commit. The fix is ' +
        'this minimum: 25 KiB gzip / 100 KiB raw, sized to absorb roughly one ordinary ' +
        "phase of feature work without tripping, while a new dependency pulled in whole — " +
        'tens or hundreds of KiB, not tens of KiB — still trips it. Lowering the ceiling is ' +
        'an ordinary edit. Raising it must be a visible, reasoned diff to this file that ' +
        'states what changed and why it could not fit in the existing headroom — and the ' +
        'number worth reading on every run is the headroom this check prints as a WARNING ' +
        'line when it passes, never the pass/fail alone: a ceiling with single-digit-percent ' +
        'headroom trains people to raise budgets on sight rather than to read them, which is ' +
        'the one thing this whole check exists to prevent.',
  }
}

/**
 * @param {AssetFile[]} files
 * @returns {{ gzip: number, raw: number }}
 */
function totals(files) {
  return {
    raw: files.reduce((a, f) => a + f.raw, 0),
    gzip: files.reduce((a, f) => a + f.gzip, 0),
  }
}

function main() {
  const write = process.argv.includes('--write')
  const files = measure()
  // The gate is the first-load set; the sum is a signal printed beside it. Both are
  // measured on every run, including under --write, so the baseline can never be written
  // from one quantity and compared against the other.
  const entry = firstLoad(files)
  const { gzip, raw } = totals(entry)
  const shipped = totals(files)

  if (write) {
    const raise = process.argv.includes('--raise')
    /** @type {Budget | undefined} */
    let previous
    try {
      previous = JSON.parse(readFileSync(BUDGET, 'utf8'))
    } catch {
      /* first write — no previous baseline to carry forward or clamp against */
    }
    const budget = buildBudget(gzip, raw, previous?.reason, previous, raise)
    writeFileSync(BUDGET, `${JSON.stringify(budget, null, 2)}\n`)
    process.stdout.write(
      `bundle: baseline written — measured ${kib(gzip)} gzip / ${kib(raw)} raw, ceiling set to ` +
        `${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw ` +
        `(headroom ${kib(budget.headroomGzipBytes)} gzip / ${kib(budget.headroomRawBytes)} raw)\n`,
    )
    // A refused raise is ANNOUNCED, never silent: the writer asked to re-record a
    // baseline and got a tighter one than the arithmetic derives, and the whole value of
    // the clamp is that they find out here rather than discovering a red `bundle` row
    // later and assuming the check is broken.
    const heldGzip = previous?.maxGzipBytes !== undefined && budget.maxGzipBytes < gzip + MIN_HEADROOM_GZIP_BYTES
    const heldRaw = previous?.maxRawBytes !== undefined && budget.maxRawBytes < raw + MIN_HEADROOM_RAW_BYTES
    if (!raise && (heldGzip || heldRaw)) {
      process.stdout.write(
        `WARNING: the recorded ceiling was HELD, not re-derived — this measurement wants ` +
          `${kib(Math.ceil((gzip + MIN_HEADROOM_GZIP_BYTES) / STEP_GZIP_BYTES) * STEP_GZIP_BYTES)} gzip / ` +
          `${kib(Math.ceil((raw + MIN_HEADROOM_RAW_BYTES) / STEP_RAW_BYTES) * STEP_RAW_BYTES)} raw to keep the ` +
          `designed minimum headroom, which is ABOVE the ceiling already on file. --write can only ever ` +
          `lower a ceiling; the headroom written above is therefore below the minimum and the check will say ` +
          `so on every run. The intended response is to make the bundle smaller. If the ceiling genuinely has ` +
          `to rise, re-run with --raise and say in ${BUDGET_REL}'s reason what changed and why it could not ` +
          `fit in the existing headroom.\n`,
      )
    }
    if (raise && previous !== undefined) {
      process.stdout.write(
        `WARNING: --raise was given, so the ceiling was re-derived from the measurement rather than clamped ` +
          `to the ${kib(previous.maxGzipBytes)} gzip / ${kib(previous.maxRawBytes)} raw already on file. ` +
          `This WIDENS the budget. The diff must carry a reason stating what changed and why it could not fit ` +
          `in the existing headroom — a ceiling raised without one is the unread ratchet this check exists to ` +
          `prevent.\n`,
      )
    }
    return
  }

  /** @type {Budget} */
  let budget
  try {
    budget = JSON.parse(readFileSync(BUDGET, 'utf8'))
  } catch (err) {
    fail([`${BUDGET_REL} is missing or is not valid JSON (${errMessage(err)}) — create it with --write.`])
  }

  /** @type {string[]} */
  const problems = []
  if (gzip > budget.maxGzipBytes) {
    problems.push(
      `GZIP OVER BUDGET: ${kib(gzip)} against a ceiling of ${kib(budget.maxGzipBytes)} ` +
        `(+${kib(gzip - budget.maxGzipBytes)}). This is what crosses the network before ` +
        'the app can paint.',
    )
  }
  if (raw > budget.maxRawBytes) {
    problems.push(
      `RAW OVER BUDGET: ${kib(raw)} against a ceiling of ${kib(budget.maxRawBytes)} ` +
        `(+${kib(raw - budget.maxRawBytes)}). This is what the browser must parse and ` +
        'compile before the app can paint.',
    )
  }
  if (problems.length) {
    problems.push(
      `Raising the ceiling is a visible, reasoned edit to ${BUDGET_REL} — it never widens on ` +
        'its own. Lowering it is ordinary; look for a new or oversized dependency first, ' +
        'then for eager code that could be deferred behind a lazy route.',
    )
    fail(problems)
  }

  // Every file, deferred ones included, each marked with which side of the gate it is on —
  // so the listing answers "why is the ceiling not the total?" without anyone reading this
  // file to find out.
  const inEntry = new Set(entry.map((f) => f.file))
  for (const f of [...files].sort((a, b) => b.gzip - a.gzip)) {
    const side = inEntry.has(f.file) ? 'first load' : 'deferred  '
    process.stdout.write(`bundle:   ${side}  ${f.file}  ${kib(f.raw)} raw / ${kib(f.gzip)} gzip\n`)
  }
  process.stdout.write(
    `bundle: first load ${kib(gzip)} gzip / ${kib(raw)} raw across ${entry.length} of ` +
      `${files.length} files — within the budget measured ${budget.measuredAt} ` +
      `(ceiling ${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw)\n`,
  )
  // Printed on every PASSING run, not only once the budget is nearly gone: a number only
  // heard from when it breaks is a number nobody is actually watching. See the file header
  // for why this, not the pass/fail, is the thing to read.
  const headroomGzip = budget.maxGzipBytes - gzip
  const headroomRaw = budget.maxRawBytes - raw
  process.stdout.write(
    `WARNING: headroom is ${kib(headroomGzip)} gzip / ${kib(headroomRaw)} raw before the ` +
      `ceiling measured ${budget.measuredAt} (${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw) ` +
      `— this budgets the first-load set named by ${INDEX_REL}, not the sum of ` +
      `${ASSETS_REL} and not load time, so watch this number every run; it is the point of ` +
      'this row, not the pass/fail.\n',
  )

  // THE HEADROOM CAN FALL BELOW THE DESIGN MINIMUM WITHOUT ANY ROW CHANGING COLOUR, and
  // that is the regime this check's whole header argues is the dangerous one. `--write`
  // sets the ceiling to the measurement plus MIN_HEADROOM_GZIP_BYTES precisely so ordinary
  // work does not force a ceiling edit — but the bundle then grows under a fixed ceiling,
  // and nothing was comparing what is left against what was intended. A budget in that
  // state still passes, and still trains exactly the behaviour the minimum exists to
  // prevent: the next ordinary commit trips it, and somebody raises the ceiling on sight.
  //
  // Derived from the budget file's own recorded minimum, not from a second copy of the
  // constant, and self-cancelling: it stops printing the moment the bundle shrinks or the
  // ceiling is legitimately re-measured. It is a WARNING, never a failure — passing is
  // still the correct verdict, and inventing a new gate here would be the unreviewed
  // policy change this layer exists to avoid.
  const minGzip = budget.minHeadroomGzipBytes ?? MIN_HEADROOM_GZIP_BYTES
  const minRaw = budget.minHeadroomRawBytes ?? MIN_HEADROOM_RAW_BYTES
  if (headroomGzip < minGzip || headroomRaw < minRaw) {
    const short = []
    if (headroomGzip < minGzip) short.push(`gzip ${kib(headroomGzip)} against ${kib(minGzip)}`)
    if (headroomRaw < minRaw) short.push(`raw ${kib(headroomRaw)} against ${kib(minRaw)}`)
    process.stdout.write(
      `WARNING: headroom has fallen BELOW the minimum this budget was designed with ` +
        `(${short.join(', ')}). The ceiling was set to absorb roughly one ordinary phase of ` +
        'work; there is now less than that left, so the next ordinary commit trips a red ' +
        '`bundle` row. The intended response is to reduce the bundle — raising the ceiling ' +
        `is the move ${BUDGET_REL} exists to make somebody justify in writing.\n`,
    )
  }

  // THE SUM, WHICH THIS ROW USED TO GATE AND NOW ONLY REPORTS. Unconditional, like the
  // headroom line and for the same reason: a number heard from only once it crosses some
  // line is a number nobody reads until it already broke. Dropping it when the gate moved
  // would have traded one blind spot for another — it is still what the CDN stores, and
  // the deferred half of it carries no ceiling whatsoever, which this line has to say out
  // loud precisely because the gate above cannot see it.
  const deferredGzip = shipped.gzip - gzip
  const deferredRaw = shipped.raw - raw
  process.stdout.write(
    `WARNING: total shipped ${kib(shipped.gzip)} gzip / ${kib(shipped.raw)} raw, of which ` +
      `${kib(deferredGzip)} gzip / ${kib(deferredRaw)} raw is deferred and therefore OUTSIDE ` +
      'the ceiling above. Nothing budgets the deferred bytes: a lazy route can grow without ' +
      'limit and this row stays green. A signal, not a gate.\n',
  )

  // A THIRD unconditional signal, on the same principle. Deliberately not a pass/fail: no
  // chunk-size ceiling is agreed in this repo, and this check does not invent one —
  // inventing a number nobody agreed to would be the unreviewed policy change this layer
  // exists to avoid. It only makes the largest single JS chunk impossible to miss, since
  // the gate above budgets a SET and says nothing about how it is distributed inside it.
  const jsFiles = files.filter((f) => f.file.endsWith('.js'))
  if (jsFiles.length > 0) {
    const largestJs = jsFiles.reduce((a, b) => (b.gzip > a.gzip ? b : a))
    const shareOfShipped = ((largestJs.gzip / shipped.gzip) * 100).toFixed(1)
    process.stdout.write(
      `WARNING: largest JS chunk is ${largestJs.file} at ${kib(largestJs.gzip)} gzip / ` +
        `${kib(largestJs.raw)} raw — ${shareOfShipped}% of the ${kib(shipped.gzip)} gzip ` +
        'shipped. This is a signal, not a gate: no chunk-size ceiling exists in this repo ' +
        'today; watch this number for whether a further split would help.\n',
    )
  }
}

main()
