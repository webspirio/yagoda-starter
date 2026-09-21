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
 * BLIND SPOT, stated here because it drove the design and belongs next to the number it
 * qualifies: this measures the SUM of frontend/dist/assets, not what a browser actually
 * downloads on first paint. The sum can GROW while the user's real download SHRINKS — code
 * splitting does exactly that, by turning one large chunk into several smaller ones plus a
 * little overhead at each new chunk boundary. So a green row here is not a claim about load
 * time; it is a claim about total shipped bytes. The number worth watching, every run, is
 * the headroom line below — not the pass/fail.
 *
 * THAT BLIND SPOT IS CHEAP TO NARROW, EVEN THOUGH IT IS NOT CHEAP TO CLOSE: this repo's
 * whole JS output today is a SINGLE chunk (no code splitting at all), so the sum this check
 * gates and what a first visit actually downloads are, right now, almost the same number —
 * confirmed on every run rather than assumed once. Root CLAUDE.md's "Deployment" audience
 * (operators at rural collection points, on mobile data) is exactly who pays for that. So a
 * second line, unconditional like the headroom one, names the single largest `.js` chunk
 * and its gzip size on EVERY run, passing or not. This is a SIGNAL, not a gate: there is no
 * agreed ceiling on a single chunk's size in this repo, and this check does not invent one
 * — inventing a number nobody agreed to would be exactly the kind of unreviewed policy
 * change this whole layer exists to avoid. It only makes the number impossible to miss.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

import { errMessage } from '../hash.mjs'
import { scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const ASSETS = path.join(ROOT, 'frontend', 'dist', 'assets')
const ASSETS_REL = path.relative(ROOT, ASSETS)
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
  return files
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
 * @param {number} gzip
 * @param {number} raw
 * @param {string | undefined} previousReason
 * @returns {Budget}
 */
function buildBudget(gzip, raw, previousReason) {
  const maxGzipBytes = Math.ceil((gzip + MIN_HEADROOM_GZIP_BYTES) / STEP_GZIP_BYTES) * STEP_GZIP_BYTES
  const maxRawBytes = Math.ceil((raw + MIN_HEADROOM_RAW_BYTES) / STEP_RAW_BYTES) * STEP_RAW_BYTES
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
  const { gzip, raw } = totals(files)

  if (write) {
    /** @type {string | undefined} */
    let previousReason
    try {
      previousReason = JSON.parse(readFileSync(BUDGET, 'utf8'))?.reason
    } catch {
      /* first write — no previous reason to carry forward */
    }
    const budget = buildBudget(gzip, raw, previousReason)
    writeFileSync(BUDGET, `${JSON.stringify(budget, null, 2)}\n`)
    process.stdout.write(
      `bundle: baseline written — measured ${kib(gzip)} gzip / ${kib(raw)} raw, ceiling set to ` +
        `${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw ` +
        `(headroom ${kib(budget.headroomGzipBytes)} gzip / ${kib(budget.headroomRawBytes)} raw)\n`,
    )
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
        `(+${kib(gzip - budget.maxGzipBytes)}). This is what actually crosses the network.`,
    )
  }
  if (raw > budget.maxRawBytes) {
    problems.push(
      `RAW OVER BUDGET: ${kib(raw)} against a ceiling of ${kib(budget.maxRawBytes)} ` +
        `(+${kib(raw - budget.maxRawBytes)}). This is what the browser must parse and compile.`,
    )
  }
  if (problems.length) {
    problems.push(
      `Raising the ceiling is a visible, reasoned edit to ${BUDGET_REL} — it never widens on ` +
        'its own. Lowering it is ordinary; look for a new or oversized dependency first.',
    )
    fail(problems)
  }

  for (const f of [...files].sort((a, b) => b.gzip - a.gzip)) {
    process.stdout.write(`bundle:   ${f.file}  ${kib(f.raw)} raw / ${kib(f.gzip)} gzip\n`)
  }
  process.stdout.write(
    `bundle: total ${kib(gzip)} gzip / ${kib(raw)} raw — within the budget measured ` +
      `${budget.measuredAt} (ceiling ${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw)\n`,
  )
  // Printed on every PASSING run, not only once the budget is nearly gone: a number only
  // heard from when it breaks is a number nobody is actually watching. See the file header
  // for why this, not the pass/fail, is the thing to read.
  const headroomGzip = budget.maxGzipBytes - gzip
  const headroomRaw = budget.maxRawBytes - raw
  process.stdout.write(
    `WARNING: headroom is ${kib(headroomGzip)} gzip / ${kib(headroomRaw)} raw before the ` +
      `ceiling measured ${budget.measuredAt} (${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw) ` +
      '— this measures the SUM of frontend/dist/assets, not what a browser downloads on first ' +
      'paint, so watch this number every run; it is the point of this row, not the pass/fail.\n',
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

  // A SECOND unconditional signal, printed on every run regardless of size — not gated
  // behind a threshold, which would reproduce the exact failure the headroom line above was
  // fixed to avoid: a number only heard from once it crosses some line is a number nobody
  // reads until it already broke. This is deliberately not a pass/fail: no chunk-size
  // ceiling is agreed in this repo, and this check does not invent one — it only makes the
  // largest single JS chunk (what a first visit largely downloads today, since there is no
  // code splitting at all) impossible to miss on every green run.
  const jsFiles = files.filter((f) => f.file.endsWith('.js'))
  if (jsFiles.length > 0) {
    const largestJs = jsFiles.reduce((a, b) => (b.gzip > a.gzip ? b : a))
    const shareOfTotal = ((largestJs.gzip / gzip) * 100).toFixed(1)
    process.stdout.write(
      `WARNING: largest JS chunk is ${largestJs.file} at ${kib(largestJs.gzip)} gzip / ` +
        `${kib(largestJs.raw)} raw — ${shareOfTotal}% of the ${kib(gzip)} gzip total. This is a ` +
        'signal, not a gate: no chunk-size ceiling exists in this repo today; watch this ' +
        'number for whether code splitting would help.\n',
    )
  }
}

main()
