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
 * Both are measured for TWO metrics now — first paint (the gate) and the sum (a printed
 * warning, never a gate) — by the exact same rule below, applied twice.
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
 * work does not need a ceiling edit, and a new dependency pulled in whole still does. This
 * SAME rule now runs twice — once for first paint, once for the sum — off one shared
 * MIN_HEADROOM/STEP pair; there is no separate, looser rule for either.
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
 * FIRST PAINT IS THE GATE; THE SUM IS PRINTED, NEVER GATED. This check used to measure and
 * budget only the SUM of frontend/dist/assets — a number a browser's first visit does NOT
 * actually download, because code splitting turns one large chunk into several smaller ones
 * plus a little overhead at each new chunk boundary, so the sum can GROW while the real
 * download SHRINKS. That is exactly what this repo's own lazy-routes work demonstrated:
 * splitting the owner-only screens into their own chunks cut the largest chunk down while
 * the sum this row used to gate went UP — under a sum budget, code splitting can never pay
 * for itself, and a chart library added for one owner-only screen would trip the gate
 * although no operator ever downloads it. Reading `frontend/dist/.vite/manifest.json`
 * (`build: { manifest: true }` in vite.config.ts) closes that gap: first paint is the
 * manifest's entry chunk (`isEntry: true`) plus the transitive closure of its STATIC
 * `imports`, and every `css` file those chunks list — never a `dynamicImports` chunk, which
 * is precisely the code a route nobody has opened yet ships behind. A manifest with MORE
 * THAN ONE `isEntry: true` chunk (a multi-page app) sums all of them into first paint; this
 * app has exactly one. THE SUM IS WHAT THE CDN STORES; FIRST PAINT IS WHAT THE OPERATOR PAYS
 * — the sum stays measured and printed, as the SECOND unconditional WARNING line below,
 * purely so a whole-package regression is still visible on every run even though it no
 * longer fails the row by itself.
 *
 * WHAT THE OPERATOR ACTUALLY GAINED FROM THE SPLIT THAT PROMPTED THIS CHECK: on `main`,
 * before the split, first paint WAS the whole bundle — there was nothing else to measure —
 * at 295.5 KiB gzip / 1034.7 KiB raw. After splitting, first paint is 281.7 KiB gzip /
 * 962.3 KiB raw: -13.8 KiB gzip (-4.7%), -72.4 KiB raw (-7.0%). Real, but nowhere near the
 * -43% the largest-chunk WARNING line alone would suggest (276.4 KiB gzip down to
 * 157.7 KiB): `dialog-*.js` (101.3 KiB gzip / 323.8 KiB raw) is a STATIC import of the
 * entry, so splitting it out RELOCATED it into its own chunk file rather than UNLOADING it
 * from first paint. The largest-chunk line answers "how big is the single biggest file"; it
 * does not answer "how much smaller is what a first visit downloads" — only the first-paint
 * figure above answers that, which is exactly why it is the gate rather than a WARNING.
 *
 * THE SUM'S CEILING DOES NOT MOVE WITH `--write`, ON PURPOSE. The sum no longer fails this
 * row, but its ceiling is FROZEN at the last value that ever gated anything — 312320 gzip
 * bytes / 1085440 raw bytes (305.0 KiB / 1060.0 KiB) — and stays there until a deliberate
 * hand edit to this file, with its own stated reason, moves it: exactly what raising any
 * ceiling always required before first paint existed. `buildBudget()` computes the sum's
 * ceiling fresh only the very first time this file is created; every `--write` after that
 * carries the previous `maxGzipBytes`/`maxRawBytes` forward untouched and refreshes only the
 * measured/headroom fields. Letting `--write` also ratchet the sum ceiling forward on every
 * ordinary run — the way it correctly does for first paint, the metric that actually gates —
 * would silently widen a number nobody is required to look at any more, which is exactly the
 * unreviewed drift this whole layer exists to catch, just applied to this row's quieter half.
 *
 * RESIDUAL BLIND SPOTS, narrower now but not zero: this reads whatever the LAST `build` and
 * its manifest wrote, so a stale or partial pair — a manifest naming a file the assets
 * directory does not contain — is a refused verdict, not "zero bytes, budget met" (see
 * `firstPaintFiles()`). It trusts Vite's own static/dynamic classification in the manifest;
 * a chunk reachable through some other eager mechanism the manifest does not record as a
 * static `imports` edge would slip through uncounted. It measures a cold download — no HTTP
 * cache, no repeat visit — because that is the worst case the rural-operator audience this
 * check exists for actually faces on a first load. And it counts neither figure's webfonts:
 * the entry's own css `@font-face`s pull in `.woff2` files this check never opens, because
 * `measure()` only reads `.js`/`.css` under dist/assets — real bytes a first paint may block
 * on, invisible to both the sum and first paint alike.
 *
 * A THIRD unconditional line, like the two above, names the single largest `.js` chunk and
 * its gzip size on EVERY run, passing or not. This is a SIGNAL, not a gate: there is no
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
const MANIFEST = path.join(ROOT, 'frontend', 'dist', '.vite', 'manifest.json')
const MANIFEST_REL = path.relative(ROOT, MANIFEST)
const BUDGET_REL = 'scripts/verify/baselines/bundle-budget.json'
const BUDGET = path.join(ROOT, BUDGET_REL)

// The minimum headroom the ceiling must carry — sized to intent, not to a rounding
// coincidence. See the file header for why this, not the step below, is what actually
// makes the ratchet meaningful: ~25 KiB gzip / ~100 KiB raw is roughly one ordinary phase
// of feature work by the reference's own measured history (13-23 KiB gzip per phase). The
// same pair backs BOTH the first-paint ceiling and the sum ceiling.
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
 * @typedef {object} ManifestChunk
 * @property {string} file
 * @property {boolean} [isEntry]
 * @property {string[]} [imports]
 * @property {string[]} [dynamicImports]
 * @property {string[]} [css]
 */

/** @typedef {Record<string, ManifestChunk>} Manifest */

/**
 * Reads frontend/dist/.vite/manifest.json (written by Vite when `build.manifest: true`).
 * Missing or unparsable is a FAIL, never an empty first paint: without it there is nothing
 * to compute first paint FROM, which is a failure to check, not a pass.
 *
 * @returns {Manifest}
 */
function readManifest() {
  /** @type {string} */
  let raw
  try {
    raw = readFileSync(MANIFEST, 'utf8')
  } catch {
    fail([
      `${MANIFEST_REL} does not exist — build the frontend with the manifest enabled ` +
        '(vite.config.ts build.manifest, then npm run build) before running this check.',
      'A missing manifest is not "zero bytes, budget met": first paint cannot be computed ' +
        'without it, which is a failure to check, not a pass.',
    ])
  }
  /** @type {Manifest} */
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    fail([`${MANIFEST_REL} is not valid JSON (${errMessage(err)}) — rebuild the frontend.`])
  }
  return manifest
}

/**
 * First paint = the manifest's entry chunk(s) (`isEntry: true`) plus the transitive closure
 * of their STATIC `imports` — never `dynamicImports`, which is exactly the code a route the
 * user has not opened yet ships behind — plus every `css` file each of those chunks lists.
 *
 * A manifest entry naming a `file`/`css` value `${ASSETS_REL}` does not contain is a stale
 * or partial build, not "zero bytes, budget met": FAIL with the exact missing name so the
 * next run knows what to rebuild.
 *
 * @param {Manifest} manifest
 * @param {Map<string, AssetFile>} byName
 * @returns {AssetFile[]}
 */
function firstPaintFiles(manifest, byName) {
  const entryKeys = Object.keys(manifest).filter((k) => manifest[k]?.isEntry)
  if (entryKeys.length === 0) {
    fail([
      `${MANIFEST_REL} has no chunk with isEntry: true — is build.manifest actually wired ` +
        'to the real Vite entry, or is this a stale or hand-edited manifest?',
    ])
  }

  const visited = new Set()
  /** @type {Set<string>} manifest-relative paths, e.g. "assets/index-abc.js" */
  const wanted = new Set()

  /** @param {string} key */
  function visit(key) {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) return
    wanted.add(chunk.file)
    for (const c of chunk.css ?? []) wanted.add(c)
    for (const imp of chunk.imports ?? []) visit(imp)
  }
  for (const key of entryKeys) visit(key)

  /** @type {AssetFile[]} */
  const resolved = []
  const seen = new Set()
  for (const rel of wanted) {
    const name = path.basename(rel)
    if (seen.has(name)) continue
    const asset = byName.get(name)
    if (!asset) {
      fail([
        `${MANIFEST_REL} names ${rel} as part of first paint but ${ASSETS_REL} does not ` +
          `contain ${name} — the build and the manifest are out of sync (a stale or ` +
          'partial build is not "zero bytes, budget met").',
      ])
    }
    seen.add(name)
    resolved.push(asset)
  }
  return resolved
}

/**
 * @typedef {object} Budget
 * @property {string} measuredAt
 * @property {number} measuredGzipBytes
 * @property {number} measuredRawBytes
 * @property {number} measuredFirstPaintGzipBytes
 * @property {number} measuredFirstPaintRawBytes
 * @property {number} minHeadroomGzipBytes
 * @property {number} minHeadroomRawBytes
 * @property {number} stepGzipBytes
 * @property {number} stepRawBytes
 * @property {number} maxGzipBytes
 * @property {number} maxRawBytes
 * @property {number} headroomGzipBytes
 * @property {number} headroomRawBytes
 * @property {number} maxFirstPaintGzipBytes
 * @property {number} maxFirstPaintRawBytes
 * @property {number} headroomFirstPaintGzipBytes
 * @property {number} headroomFirstPaintRawBytes
 * @property {string} reason
 */

const DEFAULT_REASON =
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
  "scale: the reference itself measured ordinary phase work at 13-23 KiB gzip per " +
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
  'the one thing this whole check exists to prevent. ' +
  'FIRST PAINT ADDED 2026-09-21: this is the FIRST measurement of a new metric — the Vite ' +
  "manifest's entry chunk plus its static import closure and their css — not a raise of " +
  'an existing ceiling. It, not the sum above, now gates this row; the sum pair is kept ' +
  'and printed as an unconditional WARNING on every run instead, because code splitting ' +
  'can grow the sum while shrinking what a first visit actually downloads, and a ' +
  'whole-package regression should stay visible even though it no longer fails the row ' +
  'by itself. Same minimum-headroom-then-step rule, run twice, once per metric — for ' +
  "first paint, on EVERY --write; for the sum, ONLY the first time this file is written. " +
  "THE SUM'S CEILING IS FROZEN, not re-measured: it stays at 312320 gzip bytes / " +
  '1085440 raw bytes (305.0 KiB / 1060.0 KiB), the last value that ever gated anything, ' +
  'restored here to that value after a bug in the 2026-09-21 commit that added first ' +
  'paint let `--write` also raise it to 337920 / 1167360 bytes (330.0 / 1140.0 KiB) as an ' +
  'undocumented side effect — exactly the unreviewed widening this whole check exists to ' +
  'catch, just missed once on its own quieter half. Moving the sum ceiling from here on is ' +
  'a deliberate hand edit with its own reason, exactly like raising any ceiling always ' +
  'required before first paint existed; `--write` will not do it again. ' +
  'WHAT THE OPERATOR ACTUALLY GAINED from the split that prompted first paint to be added: ' +
  'on `main`, first paint WAS the whole bundle, 295.5 KiB gzip / 1034.7 KiB raw; after ' +
  'splitting it is 281.7 KiB gzip / 962.3 KiB raw — -13.8 KiB gzip (-4.7%), -72.4 KiB raw ' +
  '(-7.0%), real but far short of the -43% the largest-chunk WARNING line alone would ' +
  'suggest, because the biggest relocated chunk (`dialog-*.js`, 101.3 KiB gzip / 323.8 KiB ' +
  'raw) is a STATIC import of the entry — moved into its own chunk file, not unloaded from ' +
  'first paint.'

/**
 * The ceiling for one measured metric is `measurement + minimum headroom`, THEN rounded up
 * to the next step. See {@link DEFAULT_REASON} and the file header for why, in that order.
 *
 * @param {number} measured
 * @param {number} minHeadroom
 * @param {number} step
 * @returns {{ max: number, headroom: number }}
 */
function ceilingFor(measured, minHeadroom, step) {
  const max = Math.ceil((measured + minHeadroom) / step) * step
  return { max, headroom: max - measured }
}

/**
 * @param {number | undefined} n
 * @returns {number | undefined} `n` itself when it is a real, finite number — `undefined`
 *   otherwise (missing key, `null`, or anything else JSON can hand back from an old or
 *   hand-edited file).
 */
function finiteOrUndefined(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/**
 * Builds the full budget record from BOTH measured metrics — the sum and first paint.
 * First paint gets the identical minimum-headroom-then-step rule on every call, because it
 * is the metric that gates and this is meant to ratchet. THE SUM'S CEILING DOES NOT: once a
 * previous budget already carries a finite `maxGzipBytes`/`maxRawBytes`, those exact values
 * are carried forward untouched — only its `measured*`/`headroom*` fields are refreshed —
 * and `ceilingFor` runs for the sum only the very first time this file is created. See the
 * file header and `DEFAULT_REASON` for why: the sum no longer gates, so `--write` moving its
 * ceiling on every ordinary run would be exactly the unreviewed widening this whole layer
 * exists to catch, just applied to the row's own quieter half. Recording
 * `minHeadroomGzipBytes`/`minHeadroomRawBytes`/`stepGzipBytes`/`stepRawBytes` alongside the
 * result means the next person to re-measure follows this exact arithmetic instead of
 * inventing their own rounding rule (the mistake this check's own history already made
 * once — see the file header).
 *
 * @param {{ sumGzip: number, sumRaw: number, firstPaintGzip: number, firstPaintRaw: number }} measured
 * @param {Partial<Budget> | undefined} previous
 * @returns {Budget}
 */
function buildBudget(measured, previous) {
  const fpGzip = ceilingFor(measured.firstPaintGzip, MIN_HEADROOM_GZIP_BYTES, STEP_GZIP_BYTES)
  const fpRaw = ceilingFor(measured.firstPaintRaw, MIN_HEADROOM_RAW_BYTES, STEP_RAW_BYTES)

  const frozenSumMaxGzip = finiteOrUndefined(previous?.maxGzipBytes)
  const frozenSumMaxRaw = finiteOrUndefined(previous?.maxRawBytes)
  const sumMaxGzip =
    frozenSumMaxGzip ?? ceilingFor(measured.sumGzip, MIN_HEADROOM_GZIP_BYTES, STEP_GZIP_BYTES).max
  const sumMaxRaw =
    frozenSumMaxRaw ?? ceilingFor(measured.sumRaw, MIN_HEADROOM_RAW_BYTES, STEP_RAW_BYTES).max

  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    measuredGzipBytes: measured.sumGzip,
    measuredRawBytes: measured.sumRaw,
    measuredFirstPaintGzipBytes: measured.firstPaintGzip,
    measuredFirstPaintRawBytes: measured.firstPaintRaw,
    minHeadroomGzipBytes: MIN_HEADROOM_GZIP_BYTES,
    minHeadroomRawBytes: MIN_HEADROOM_RAW_BYTES,
    stepGzipBytes: STEP_GZIP_BYTES,
    stepRawBytes: STEP_RAW_BYTES,
    maxGzipBytes: sumMaxGzip,
    maxRawBytes: sumMaxRaw,
    headroomGzipBytes: sumMaxGzip - measured.sumGzip,
    headroomRawBytes: sumMaxRaw - measured.sumRaw,
    maxFirstPaintGzipBytes: fpGzip.max,
    maxFirstPaintRawBytes: fpRaw.max,
    headroomFirstPaintGzipBytes: fpGzip.headroom,
    headroomFirstPaintRawBytes: fpRaw.headroom,
    reason: previous?.reason ?? DEFAULT_REASON,
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
  /** @type {Map<string, AssetFile>} */
  const byName = new Map(files.map((f) => [f.file, f]))
  const manifest = readManifest()
  const firstPaint = firstPaintFiles(manifest, byName)
  const sum = totals(files)
  const fp = totals(firstPaint)

  if (write) {
    /** @type {Partial<Budget> | undefined} */
    let previous
    try {
      previous = JSON.parse(readFileSync(BUDGET, 'utf8'))
    } catch {
      /* first write — nothing to carry forward, and the sum ceiling gets its one-time
       * fresh computation from buildBudget() instead of being frozen at a previous value */
    }
    const budget = buildBudget(
      { sumGzip: sum.gzip, sumRaw: sum.raw, firstPaintGzip: fp.gzip, firstPaintRaw: fp.raw },
      previous,
    )
    writeFileSync(BUDGET, `${JSON.stringify(budget, null, 2)}\n`)
    process.stdout.write(
      `bundle: baseline written — first paint ${kib(fp.gzip)} gzip / ${kib(fp.raw)} raw ` +
        `(ceiling ${kib(budget.maxFirstPaintGzipBytes)} gzip / ${kib(budget.maxFirstPaintRawBytes)} raw, ` +
        `headroom ${kib(budget.headroomFirstPaintGzipBytes)} gzip / ${kib(budget.headroomFirstPaintRawBytes)} raw), ` +
        `sum ${kib(sum.gzip)} gzip / ${kib(sum.raw)} raw ` +
        `(frozen ceiling ${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw, ` +
        `headroom ${kib(budget.headroomGzipBytes)} gzip / ${kib(budget.headroomRawBytes)} raw)\n`,
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

  // AN OLD-SHAPED BUDGET FILE MUST NOT SILENTLY GATE NOTHING. Before first paint existed,
  // this file had no maxFirstPaintGzipBytes/maxFirstPaintRawBytes at all — a merge that
  // resolves toward that old side, or this check cherry-picked ahead of its own baseline,
  // leaves those fields `undefined`. Every comparison below is a `>` against that
  // `undefined`, which JavaScript quietly coerces to `false`: the row would print
  // `ceiling NaN KiB`, exit 0, and gate nothing at all — the exact false green this whole
  // layer exists to refuse. Checked explicitly, by name, rather than trusted to `fail()`'s
  // own arithmetic to notice.
  /** @type {[string, number][]} */
  const requiredMaxFields = [
    ['maxFirstPaintGzipBytes', budget.maxFirstPaintGzipBytes],
    ['maxFirstPaintRawBytes', budget.maxFirstPaintRawBytes],
    ['maxGzipBytes', budget.maxGzipBytes],
    ['maxRawBytes', budget.maxRawBytes],
  ]
  const missingMax = requiredMaxFields.filter(([, v]) => !Number.isFinite(v)).map(([name]) => name)
  if (missingMax.length > 0) {
    fail([
      `${BUDGET_REL} has a missing or non-numeric ${missingMax.join(', ')} — this is an ` +
        'old-shaped budget file (from before first paint was measured, or a merge that ' +
        'resolved toward the old side) and would otherwise gate NOTHING silently rather ' +
        `than failing loudly. Regenerate it with --write.`,
    ])
  }

  // THE GATE IS FIRST PAINT, NOT THE SUM. See the file header for why: the sum is what the
  // CDN stores, first paint is what the operator pays, and code splitting can grow one while
  // shrinking the other.
  /** @type {string[]} */
  const problems = []
  if (fp.gzip > budget.maxFirstPaintGzipBytes) {
    problems.push(
      `FIRST PAINT GZIP OVER BUDGET: ${kib(fp.gzip)} against a ceiling of ${kib(budget.maxFirstPaintGzipBytes)} ` +
        `(+${kib(fp.gzip - budget.maxFirstPaintGzipBytes)}). This is what a first visit must ` +
        'download before the app can paint.',
    )
  }
  if (fp.raw > budget.maxFirstPaintRawBytes) {
    problems.push(
      `FIRST PAINT RAW OVER BUDGET: ${kib(fp.raw)} against a ceiling of ${kib(budget.maxFirstPaintRawBytes)} ` +
        `(+${kib(fp.raw - budget.maxFirstPaintRawBytes)}). This is what the browser must parse ` +
        'and compile before the app can paint.',
    )
  }
  if (problems.length) {
    problems.push(
      `Raising the ceiling is a visible, reasoned edit to ${BUDGET_REL} — it never widens on ` +
        'its own. Lowering it is ordinary; look for a new or oversized dependency, or a chunk ' +
        'that should stay behind a dynamic import instead of a static one, first.',
    )
    fail(problems)
  }

  for (const f of [...files].sort((a, b) => b.gzip - a.gzip)) {
    process.stdout.write(`bundle:   ${f.file}  ${kib(f.raw)} raw / ${kib(f.gzip)} gzip\n`)
  }
  process.stdout.write(
    `bundle: first paint ${kib(fp.gzip)} gzip / ${kib(fp.raw)} raw — within the budget measured ` +
      `${budget.measuredAt} (ceiling ${kib(budget.maxFirstPaintGzipBytes)} gzip / ` +
      `${kib(budget.maxFirstPaintRawBytes)} raw)\n`,
  )

  // Printed on every PASSING run, not only once the budget is nearly gone: a number only
  // heard from when it breaks is a number nobody is actually watching. See the file header
  // for why this, not the pass/fail, is the thing to read. FIRST of the three unconditional
  // WARNING lines.
  const headroomFpGzip = budget.maxFirstPaintGzipBytes - fp.gzip
  const headroomFpRaw = budget.maxFirstPaintRawBytes - fp.raw
  process.stdout.write(
    `WARNING: first paint headroom is ${kib(headroomFpGzip)} gzip / ${kib(headroomFpRaw)} raw ` +
      `before the ceiling measured ${budget.measuredAt} (${kib(budget.maxFirstPaintGzipBytes)} gzip / ` +
      `${kib(budget.maxFirstPaintRawBytes)} raw) — first paint is the manifest's entry chunk plus its ` +
      'static import closure and their css, never a dynamicImports chunk; watch this number every ' +
      'run, it is the point of this row, not the pass/fail.\n',
  )

  // THE HEADROOM CAN FALL BELOW THE DESIGN MINIMUM WITHOUT ANY ROW CHANGING COLOUR, and
  // that is the regime this check's whole header argues is the dangerous one. `--write`
  // sets the ceiling to the measurement plus MIN_HEADROOM_GZIP_BYTES precisely so ordinary
  // work does not force a ceiling edit — but first paint then grows under a fixed ceiling,
  // and nothing was comparing what is left against what was intended. A budget in that
  // state still passes, and still trains exactly the behaviour the minimum exists to
  // prevent: the next ordinary commit trips it, and somebody raises the ceiling on sight.
  //
  // Derived from the budget file's own recorded minimum, not from a second copy of the
  // constant, and self-cancelling: it stops printing the moment first paint shrinks or the
  // ceiling is legitimately re-measured. It is a WARNING, never a failure — passing is
  // still the correct verdict, and inventing a new gate here would be the unreviewed
  // policy change this layer exists to avoid.
  const minGzip = budget.minHeadroomGzipBytes ?? MIN_HEADROOM_GZIP_BYTES
  const minRaw = budget.minHeadroomRawBytes ?? MIN_HEADROOM_RAW_BYTES
  if (headroomFpGzip < minGzip || headroomFpRaw < minRaw) {
    const short = []
    if (headroomFpGzip < minGzip) short.push(`gzip ${kib(headroomFpGzip)} against ${kib(minGzip)}`)
    if (headroomFpRaw < minRaw) short.push(`raw ${kib(headroomFpRaw)} against ${kib(minRaw)}`)
    process.stdout.write(
      `WARNING: first paint headroom has fallen BELOW the minimum this budget was designed ` +
        `with (${short.join(', ')}). The ceiling was set to absorb roughly one ordinary phase ` +
        'of work; there is now less than that left, so the next ordinary commit trips a red ' +
        '`bundle` row. The intended response is to reduce first paint — raising the ceiling ' +
        `is the move ${BUDGET_REL} exists to make somebody justify in writing.\n`,
    )
  }

  // SECOND unconditional WARNING line: the sum no longer gates this row, but a
  // whole-package regression should still be visible on every run — see the file header's
  // "FIRST PAINT IS THE GATE; THE SUM IS PRINTED, NEVER GATED". Its ceiling is FROZEN (see
  // buildBudget()), so this line carries BOTH the headroom figure AND, when it applies, the
  // same "fallen BELOW the minimum" clause first paint's headroom line carries above —
  // that clause is not first paint's alone; retargeting the gate away from the sum must not
  // silently drop the one piece of information that told anyone the sum was thin on room.
  const sumOverGzip = sum.gzip > budget.maxGzipBytes
  const sumOverRaw = sum.raw > budget.maxRawBytes
  let sumStatus
  if (sumOverGzip || sumOverRaw) {
    sumStatus =
      `OVER its own frozen ceiling (gzip +${kib(Math.max(0, sum.gzip - budget.maxGzipBytes))}, ` +
      `raw +${kib(Math.max(0, sum.raw - budget.maxRawBytes))})`
  } else {
    const sumHeadroomGzip = budget.maxGzipBytes - sum.gzip
    const sumHeadroomRaw = budget.maxRawBytes - sum.raw
    sumStatus =
      `within its own frozen ceiling (headroom ${kib(sumHeadroomGzip)} gzip / ${kib(sumHeadroomRaw)} raw)`
    if (sumHeadroomGzip < minGzip || sumHeadroomRaw < minRaw) {
      const sumShort = []
      if (sumHeadroomGzip < minGzip) sumShort.push(`gzip ${kib(sumHeadroomGzip)} against ${kib(minGzip)}`)
      if (sumHeadroomRaw < minRaw) sumShort.push(`raw ${kib(sumHeadroomRaw)} against ${kib(minRaw)}`)
      sumStatus +=
        `, headroom has fallen BELOW the minimum this budget was designed with (${sumShort.join(', ')})`
    }
  }
  process.stdout.write(
    `WARNING: sum of ${ASSETS_REL} is ${kib(sum.gzip)} gzip / ${kib(sum.raw)} raw against its own ` +
      `frozen ceiling of ${kib(budget.maxGzipBytes)} gzip / ${kib(budget.maxRawBytes)} raw — ${sumStatus}. ` +
      'The sum no longer gates this row; first paint does, and only a hand edit with a reason moves ' +
      'this ceiling now — `--write` never touches it once set. The sum is what the CDN stores, first ' +
      'paint is what the operator pays.\n',
  )

  // THIRD unconditional WARNING line, printed on every run regardless of size — not gated
  // behind a threshold, which would reproduce the exact failure the headroom line above was
  // fixed to avoid: a number only heard from once it crosses some line is a number nobody
  // reads until it already broke. This is deliberately not a pass/fail: no chunk-size
  // ceiling is agreed in this repo, and this check does not invent one — it only makes the
  // largest single JS chunk impossible to miss on every green run.
  const jsFiles = files.filter((f) => f.file.endsWith('.js'))
  if (jsFiles.length > 0) {
    const largestJs = jsFiles.reduce((a, b) => (b.gzip > a.gzip ? b : a))
    const shareOfTotal = ((largestJs.gzip / sum.gzip) * 100).toFixed(1)
    process.stdout.write(
      `WARNING: largest JS chunk is ${largestJs.file} at ${kib(largestJs.gzip)} gzip / ` +
        `${kib(largestJs.raw)} raw — ${shareOfTotal}% of the ${kib(sum.gzip)} gzip total. This is a ` +
        'signal, not a gate: no chunk-size ceiling exists in this repo today; watch this ' +
        'number for whether code splitting would help.\n',
    )
  }
}

main()
