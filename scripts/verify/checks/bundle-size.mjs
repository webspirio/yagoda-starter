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
 * THE CEILING IS NOT THE MEASUREMENT. This is a correction, not a stylistic choice: the
 * reference this check was ported from (webspirio/yagoda-crm) pinned its budget to the
 * measured byte count exactly, with zero slack, and it broke on the very next commit over
 * an **18-byte** gzip increase from adding one small helper — ordinary work, not a
 * regression. A check that demands a budget edit for 18 bytes teaches people to raise
 * budgets without reading them, which is precisely the failure mode a budget exists to
 * prevent. So `--write` rounds the measured total UP — 5 KiB steps for gzip, 20 KiB steps
 * for raw — and records both the measurement and the resulting ceiling, so a reader can
 * always see which is which and how much slack the rounding bought.
 *
 * What must still fail is a REGRESSION: a new dependency pulled in whole, an accidental
 * whole-package import, a chart library added for one small feature. Those are tens or
 * hundreds of KiB, not bytes — comfortably outside the rounding step, and exactly what this
 * check exists to catch.
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
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

import { errMessage } from '../hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const ASSETS = path.join(ROOT, 'frontend', 'dist', 'assets')
const ASSETS_REL = path.relative(ROOT, ASSETS)
const BUDGET_REL = 'scripts/verify/baselines/bundle-budget.json'
const BUDGET = path.join(ROOT, BUDGET_REL)

// Rounding steps this check's whole ratchet discipline rests on — see the file header for
// why these are steps up from the measurement, never the measurement itself.
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
 * @property {number} maxGzipBytes
 * @property {number} maxRawBytes
 * @property {number} headroomGzipBytes
 * @property {number} headroomRawBytes
 * @property {string} reason
 */

/**
 * @param {number} gzip
 * @param {number} raw
 * @param {string | undefined} previousReason
 * @returns {Budget}
 */
function buildBudget(gzip, raw, previousReason) {
  const maxGzipBytes = Math.ceil(gzip / STEP_GZIP_BYTES) * STEP_GZIP_BYTES
  const maxRawBytes = Math.ceil(raw / STEP_RAW_BYTES) * STEP_RAW_BYTES
  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    measuredGzipBytes: gzip,
    measuredRawBytes: raw,
    maxGzipBytes,
    maxRawBytes,
    headroomGzipBytes: maxGzipBytes - gzip,
    headroomRawBytes: maxRawBytes - raw,
    reason:
      previousReason ??
      'The ceiling is the measured total ROUNDED UP — 5 KiB steps for gzip, 20 KiB steps ' +
        'for raw — never the measurement itself. This is a deliberate correction, not slack ' +
        'left in by accident: the reference this check was ported from (webspirio/yagoda-crm) ' +
        'first pinned the ceiling to the exact measured byte count, and it broke on the very ' +
        'next commit over an 18-byte gzip increase from adding one small helper — ordinary ' +
        'work, not a regression. A check that demands a budget edit for 18 bytes teaches ' +
        'people to raise budgets without reading them, which defeats the one thing a budget ' +
        'is for. What this ceiling exists to catch is a REGRESSION — a new dependency pulled ' +
        'in whole, an accidental whole-package import — measured in tens or hundreds of KiB, ' +
        'never bytes. Lowering the ceiling is an ordinary edit. Raising it must be a visible, ' +
        'reasoned diff to this file, and only after ruling out that the increase is exactly ' +
        'the kind of regression this row exists to stop.',
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
}

main()
