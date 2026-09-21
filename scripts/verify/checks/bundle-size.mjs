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
 * Both are measured for TWO GATED metrics — first paint and lazy, defined below — by the
 * exact same rule, applied twice per metric (gzip and raw). The sum of everything under
 * dist/assets is measured too, but it is neither gated nor a metric with a ceiling of its
 * own any more: see "FIRST PAINT AND LAZY ARE THE GATES" below for why.
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
 * SAME rule runs on EVERY `--write`, for BOTH gated metrics, off one shared MIN_HEADROOM/
 * STEP pair; neither metric is ever frozen or treated as a one-time computation.
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
 * FIRST PAINT AND LAZY ARE THE GATES; THE SUM IS PRINTED, NEVER GATED. This check used to
 * measure and budget only the SUM of frontend/dist/assets — a number a browser's first
 * visit does NOT actually download, because code splitting turns one large chunk into
 * several smaller ones plus a little overhead at each new chunk boundary, so the sum can
 * GROW while the real download SHRINKS. That is exactly what this repo's own lazy-routes
 * work demonstrated: splitting the owner-only screens into their own chunks cut the largest
 * chunk down while the sum this row used to gate went UP — under a sum budget, code
 * splitting can never pay for itself, and a chart library added for one owner-only screen
 * would trip the gate although no operator ever downloads it. Reading
 * `frontend/dist/.vite/manifest.json` (`build: { manifest: true }` in vite.config.ts) closes
 * that gap in TWO halves rather than one: first paint is the manifest's entry chunk
 * (`isEntry: true`) plus the transitive closure of its STATIC `imports`, and every `css`
 * file those chunks list; lazy is every OTHER manifest-listed chunk (and its `css`) —
 * everything reachable from the entry only by crossing at least one `dynamicImports` edge,
 * which is precisely the code a route nobody has opened yet ships behind. A chunk reached
 * statically FROM a lazy chunk still belongs to lazy, transitively; a chunk already claimed
 * by first paint is never counted twice. Between them they cover EVERY manifest-listed
 * `.js`/`.css` file with no gap and no overlap — an invariant this check asserts and FAILS
 * loudly if a manifest ever violates (see `assertClosureInvariant()`). Splitting a screen
 * off into a lazy chunk now moves its bytes from the first-paint ceiling to the lazy
 * ceiling; it cannot escape a ceiling entirely, which a sum-only budget always let it do. A
 * manifest with MORE THAN ONE `isEntry: true` chunk (a multi-page app) sums all of them into
 * first paint; this app has exactly one. THE SUM IS WHAT THE CDN STORES; FIRST PAINT PLUS
 * LAZY IS WHAT THE OPERATOR EVENTUALLY PAYS, SPLIT BY WHEN — the sum stays measured and
 * printed, as an unconditional WARNING line below, purely so a whole-package regression
 * that somehow lands in neither closure is still visible, even though the sum itself no
 * longer carries a ceiling of its own: gating it on top of first paint and lazy would just
 * double-book bytes both of them already cover.
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
 * figure above answers that, which is exactly why it — and now lazy alongside it — are the
 * gates rather than a WARNING.
 *
 * LAZY HAD NO CEILING AT ALL UNTIL NOW, AND THAT WAS THE GAP THIS REVISION CLOSES. The
 * version of this check that first added first paint kept the OLD sum ceiling as a frozen,
 * printed-only figure — meaning the five split-off owner screens, and any future chart
 * library added behind a dynamic import, could grow without bound: no row would ever fail
 * for it, because first paint does not see dynamicImports and the frozen sum ceiling was
 * never designed to gate anything again. Giving lazy its own ceiling — ratcheted by
 * `--write` exactly like first paint's, never frozen — closes that gap: splitting code
 * between first paint and lazy now moves bytes between two BUDGETS, not out of every budget
 * that exists.
 *
 * RESIDUAL BLIND SPOTS, narrower now but not zero: this reads whatever the LAST `build` and
 * its manifest wrote, so a stale or partial pair — a manifest naming a file the assets
 * directory does not contain — is a refused verdict, not "zero bytes, budget met" (see
 * `resolveWanted()`). It trusts Vite's own static/dynamic classification in the manifest; a
 * chunk reachable through some other eager mechanism the manifest does not record as a
 * static `imports` edge would slip through uncounted, though `assertClosureInvariant()` at
 * least guarantees every LISTED chunk lands in one gated figure or the other. It measures a
 * cold download — no HTTP cache, no repeat visit — because that is the worst case the
 * rural-operator audience this check exists for actually faces on a first load. And it
 * counts neither figure's webfonts: the entry's own css `@font-face`s pull in `.woff2`
 * files this check never opens, because `measure()` only reads `.js`/`.css` under
 * dist/assets — real bytes a first paint may block on, invisible to first paint, lazy and
 * the sum alike.
 *
 * A THIRD unconditional line, like the sum above, names the single largest `.js` chunk and
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
// same pair backs BOTH gated ceilings — first paint and lazy.
const MIN_HEADROOM_GZIP_BYTES = 25 * 1024
const MIN_HEADROOM_RAW_BYTES = 100 * 1024

// The rounding step applied AFTER the minimum headroom is added — cosmetic (keeps the
// ceiling a round number), not the source of the ratchet's slack.
const STEP_GZIP_BYTES = 5 * 1024
const STEP_RAW_BYTES = 20 * 1024

/**
 * The one place this check's "must never ship" scope is DECLARED, so it stays mechanically
 * tied to what it enforces rather than drifting into a second, hand-kept copy. Mirrors
 * `frontend/src/app/router.tsx`'s own guard: `routes` spreads the `/ui-kit` gallery in only
 * `...(import.meta.env.DEV ? [ { path: '/ui-kit', ... } ] : [])`, so the production bundle
 * is meant to never contain that route's module at all. A leaked chunk here would be LAZY
 * (it sits behind its own `lazy()` import, excluded from first paint by definition), so
 * this is the only gate in this file that would ever see it.
 */
export const DEV_ONLY_SOURCE_PREFIXES = ['src/pages/ui-kit/']

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
 * FAILs if the manifest contains anything under {@link DEV_ONLY_SOURCE_PREFIXES}, by KEY or
 * by `file` name — a dev-only gallery must never reach a production build, and because a
 * leaked chunk would be lazy (see the file header), no other check in this file would ever
 * notice on its own.
 *
 * @param {Manifest} manifest
 */
function assertNoDevOnlyChunksShipped(manifest) {
  /** @type {string[]} */
  const problems = []
  for (const [key, chunk] of Object.entries(manifest)) {
    if (DEV_ONLY_SOURCE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      problems.push(
        `${MANIFEST_REL} contains ${key} — a dev-only source that router.tsx keeps out of a ` +
          'production build behind `import.meta.env.DEV`; a leaked chunk here means that gate ' +
          'failed or was bypassed, and it would otherwise ship silently inside the lazy figure.',
      )
    }
    if (typeof chunk?.file === 'string' && chunk.file.includes('ui-kit')) {
      problems.push(
        `${MANIFEST_REL}'s ${key} names a file (${chunk.file}) containing "ui-kit" — a dev-only ` +
          'chunk must never reach a production build.',
      )
    }
  }
  if (problems.length > 0) fail(problems)
}

/**
 * Shared graph walk for both first paint and lazy: visits `startKeys`, always following
 * `imports` edges and, when `followDynamic` is true, `dynamicImports` edges too, recording
 * every newly-visited chunk's `file` and `css` entries. `visited` is shared across BOTH
 * calls (first paint's, then lazy's) so a chunk first paint already claimed is silently
 * skipped here rather than counted twice — "a chunk already in first paint is never counted
 * twice" is enforced by this one shared Set, not by a second pass of de-duplication.
 *
 * A key that appears as an edge target but has no entry in `manifest` at all FAILS naming
 * that dangling key. The function this replaced used `if (!chunk) return` here — silently
 * dropping the reference from first paint's closure instead of failing — which is exactly
 * the kind of under-measurement every other guard in this file refuses.
 *
 * @param {Manifest} manifest
 * @param {string[]} startKeys
 * @param {Set<string>} visited mutated in place
 * @param {{ followDynamic: boolean, label: string }} opts
 * @returns {Set<string>} manifest-relative file paths (e.g. "assets/index-abc.js")
 */
function traverse(manifest, startKeys, visited, { followDynamic, label }) {
  /** @type {Set<string>} */
  const wanted = new Set()

  /** @param {string} key */
  function visit(key) {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) {
      fail([
        `${MANIFEST_REL} names ${key} as part of ${label} but has no chunk entry for it — the ` +
          'manifest and the build it describes are out of sync (a dangling reference is not ' +
          '"zero bytes, budget met").',
      ])
    }
    wanted.add(chunk.file)
    for (const c of chunk.css ?? []) wanted.add(c)
    for (const imp of chunk.imports ?? []) visit(imp)
    if (followDynamic) for (const dyn of chunk.dynamicImports ?? []) visit(dyn)
  }
  for (const key of startKeys) visit(key)
  return wanted
}

/**
 * Resolves a `wanted` set of manifest-relative paths against the real files on disk,
 * de-duplicated by basename. `exclude` additionally skips any basename already claimed by
 * a DIFFERENT closure (first paint, when resolving lazy) — belt-and-braces alongside the
 * key-level `visited` de-duplication in {@link traverse}, in case the same physical file
 * were ever named from two chunks that fall on either side of the first-paint/lazy split.
 * A manifest entry naming a `file`/`css` value `${ASSETS_REL}` does not contain is a stale
 * or partial build, not "zero bytes, budget met": FAILs with the exact missing name.
 *
 * @param {Set<string>} wanted
 * @param {Map<string, AssetFile>} byName
 * @param {string} label
 * @param {Set<string>} [exclude]
 * @returns {AssetFile[]}
 */
function resolveWanted(wanted, byName, label, exclude = new Set()) {
  /** @type {AssetFile[]} */
  const resolved = []
  const seen = new Set(exclude)
  for (const rel of wanted) {
    const name = path.basename(rel)
    if (seen.has(name)) continue
    const asset = byName.get(name)
    if (!asset) {
      fail([
        `${MANIFEST_REL} names ${rel} as part of ${label} but ${ASSETS_REL} does not contain ` +
          `${name} — the build and the manifest are out of sync (a stale or partial build is ` +
          'not "zero bytes, budget met").',
      ])
    }
    seen.add(name)
    resolved.push(asset)
  }
  return resolved
}

/**
 * First paint = the manifest's entry chunk(s) (`isEntry: true`) plus the transitive closure
 * of their STATIC `imports` — never `dynamicImports`, which is exactly the code a route the
 * user has not opened yet ships behind — plus every `css` file each of those chunks lists.
 *
 * @param {Manifest} manifest
 * @param {Map<string, AssetFile>} byName
 * @returns {{ resolved: AssetFile[], visited: Set<string> }}
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
  const wanted = traverse(manifest, entryKeys, visited, { followDynamic: false, label: 'first paint' })
  const resolved = resolveWanted(wanted, byName, 'first paint')
  return { resolved, visited }
}

/**
 * Lazy = every OTHER manifest-listed chunk (and its `css`) reachable from the entry ONLY by
 * crossing at least one `dynamicImports` edge — transitively: a chunk reached statically
 * FROM a lazy chunk still belongs to lazy, and a chunk already claimed by first paint is
 * never counted twice (see {@link traverse}'s shared `visited` set). The roots of this walk
 * are every `dynamicImports` target listed on any chunk first paint already claims — from
 * there, both `imports` and `dynamicImports` edges are followed, so a chunk reachable only
 * through a CHAIN of dynamic imports (a lazy chunk that itself lazily imports another) still
 * lands in lazy rather than falling through the invariant this file asserts below.
 *
 * @param {Manifest} manifest
 * @param {Map<string, AssetFile>} byName
 * @param {Set<string>} firstPaintVisited
 * @param {Set<string>} firstPaintFileNames basenames first paint already resolved — passed
 *   through to {@link resolveWanted} so the same physical file can never be double-counted.
 * @returns {{ resolved: AssetFile[], visited: Set<string> }}
 */
function lazyFiles(manifest, byName, firstPaintVisited, firstPaintFileNames) {
  const visited = new Set(firstPaintVisited)
  /** @type {string[]} */
  const roots = []
  for (const key of firstPaintVisited) {
    for (const dyn of manifest[key]?.dynamicImports ?? []) roots.push(dyn)
  }
  const wanted = traverse(manifest, roots, visited, { followDynamic: true, label: 'the lazy closure' })
  const resolved = resolveWanted(wanted, byName, 'the lazy closure', firstPaintFileNames)
  return { resolved, visited }
}

/**
 * The class invariant this whole split depends on: every manifest-listed `.js`/`.css` file
 * — every chunk's own `.file` when it ends in `.js`/`.css`, and every name in every chunk's
 * `.css` array — must be claimed by first paint or by lazy. Neither closure is allowed to
 * silently miss one: a chunk reachable through neither is exactly the under-measurement
 * this whole check exists to refuse, not a smaller, quieter number.
 *
 * @param {Manifest} manifest
 * @param {AssetFile[]} firstPaint
 * @param {AssetFile[]} lazy
 */
function assertClosureInvariant(manifest, firstPaint, lazy) {
  const covered = new Set([...firstPaint, ...lazy].map((f) => f.file))
  /** @type {Set<string>} */
  const missing = new Set()
  for (const chunk of Object.values(manifest)) {
    if (typeof chunk.file === 'string' && /\.(js|css)$/.test(chunk.file)) {
      const name = path.basename(chunk.file)
      if (!covered.has(name)) missing.add(name)
    }
    for (const c of chunk.css ?? []) {
      const name = path.basename(c)
      if (!covered.has(name)) missing.add(name)
    }
  }
  if (missing.size > 0) {
    fail([
      `${MANIFEST_REL} lists ${[...missing].sort().join(', ')} but neither first paint nor the ` +
        'lazy closure claims it — every manifest-listed .js/.css file must be reachable from ' +
        'the entry through static imports (first paint) or through some dynamicImports edge ' +
        '(lazy). A chunk reachable through neither is a blind spot this check refuses to leave ' +
        'silent.',
    ])
  }
}

/**
 * @typedef {object} Budget
 * @property {string} measuredAt
 * @property {number} measuredFirstPaintGzipBytes
 * @property {number} measuredFirstPaintRawBytes
 * @property {number} measuredLazyGzipBytes
 * @property {number} measuredLazyRawBytes
 * @property {number} minHeadroomGzipBytes
 * @property {number} minHeadroomRawBytes
 * @property {number} stepGzipBytes
 * @property {number} stepRawBytes
 * @property {number} maxFirstPaintGzipBytes
 * @property {number} maxFirstPaintRawBytes
 * @property {number} headroomFirstPaintGzipBytes
 * @property {number} headroomFirstPaintRawBytes
 * @property {number} maxLazyGzipBytes
 * @property {number} maxLazyRawBytes
 * @property {number} headroomLazyGzipBytes
 * @property {number} headroomLazyRawBytes
 * @property {string} reason
 */

const DEFAULT_REASON =
  'The ceiling for EACH gated metric (first paint, lazy) is `measurement + a MINIMUM ' +
  'headroom`, THEN rounded up to the next step (minHeadroomGzipBytes/minHeadroomRawBytes ' +
  'are the headroom; stepGzipBytes/stepRawBytes are only cosmetic rounding on top of it) — ' +
  'never the measurement itself, and never a bare round-up with no minimum either. Both ' +
  'corrections in that sentence are load-bearing, learned in that order. First: the ' +
  'reference this check was ported from (webspirio/yagoda-crm) pinned its ceiling to the ' +
  'exact measured byte count with zero slack, and it broke on the very next commit over an ' +
  '18-byte gzip increase from adding one small helper — ordinary work, not a regression. ' +
  "Second, and this repo's own mistake: this check's first version fixed that by rounding " +
  'the raw measurement up to the next step and stopping there, with no minimum — and the ' +
  'very first real measurement here landed at 3,719 B of gzip headroom, 1.3% of the ' +
  'bundle, because the measurement happened to fall just past a step boundary. That is the ' +
  "SAME failure as the 18-byte story, just at a larger scale: the reference itself " +
  'measured ordinary phase work at 13-23 KiB gzip per phase, so single-digit-percent ' +
  'headroom does not defend against ordinary growth, it just delays the next forced, ' +
  'unread ceiling raise by one commit. The fix is this minimum: 25 KiB gzip / 100 KiB raw, ' +
  'sized to absorb roughly one ordinary phase of feature work without tripping, while a ' +
  'new dependency pulled in whole — tens or hundreds of KiB, not tens of KiB — still trips ' +
  'it. THIS RULE NEVER FREEZES: `--write` re-baselines BOTH gated pairs, first paint and ' +
  'lazy, to a fresh measurement plus the minimum headroom every time it runs — there is no ' +
  'hand-edit required to keep either ceiling honest, and nothing about either pair is ever ' +
  'carried forward untouched the way the old sum ceiling once was. What looks like ' +
  '"raising the ceiling" is simply `--write` doing exactly that because the measurement ' +
  'grew: the number worth reading on every run is the headroom this check prints as a ' +
  'WARNING line, not the pass/fail alone — a ceiling with single-digit-percent headroom ' +
  'trains people to skim past budgets rather than read them, which is the one thing this ' +
  'whole check exists to prevent. ' +
  'FIRST PAINT was first measured 2026-09-21, as the FIRST measurement of that metric — ' +
  "the Vite manifest's entry chunk plus its static import closure and their css — and has " +
  'gated this row, ratcheting on every `--write`, ever since. LAZY was first measured on ' +
  'the same date, closing the gap first paint alone left open: every OTHER manifest-listed ' +
  'chunk, reachable from the entry only by crossing a dynamicImports edge, previously had ' +
  'no ceiling at all — a chart library added behind one lazy route could have grown ' +
  'without bound and no row would ever have failed for it. Lazy now ratchets on every ' +
  '`--write` exactly like first paint; neither is ever frozen. The SUM across ' +
  'frontend/dist/assets is still measured and printed on every run, but as of the same ' +
  'date it carries no ceiling of its own and this file records no field for one: first ' +
  'paint and lazy between them already cover every manifest-listed byte, so gating a third, ' +
  'overlapping figure on top would only double-book bytes the other two already price. ' +
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
 * Builds the full budget record from BOTH gated metrics — first paint and lazy. Both get
 * the identical minimum-headroom-then-step rule on EVERY call: unlike the old sum ceiling
 * this file used to freeze after its first computation, neither pair is ever carried
 * forward untouched — `--write` always re-baselines both from a fresh measurement. Recording
 * `minHeadroomGzipBytes`/`minHeadroomRawBytes`/`stepGzipBytes`/`stepRawBytes` alongside the
 * result means the next person to re-measure follows this exact arithmetic instead of
 * inventing their own rounding rule (the mistake this check's own history already made
 * once — see the file header).
 *
 * @param {{ firstPaintGzip: number, firstPaintRaw: number, lazyGzip: number, lazyRaw: number }} measured
 * @param {Partial<Budget> | undefined} previous
 * @returns {Budget}
 */
function buildBudget(measured, previous) {
  const fpGzip = ceilingFor(measured.firstPaintGzip, MIN_HEADROOM_GZIP_BYTES, STEP_GZIP_BYTES)
  const fpRaw = ceilingFor(measured.firstPaintRaw, MIN_HEADROOM_RAW_BYTES, STEP_RAW_BYTES)
  const lazyGzip = ceilingFor(measured.lazyGzip, MIN_HEADROOM_GZIP_BYTES, STEP_GZIP_BYTES)
  const lazyRaw = ceilingFor(measured.lazyRaw, MIN_HEADROOM_RAW_BYTES, STEP_RAW_BYTES)

  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    measuredFirstPaintGzipBytes: measured.firstPaintGzip,
    measuredFirstPaintRawBytes: measured.firstPaintRaw,
    measuredLazyGzipBytes: measured.lazyGzip,
    measuredLazyRawBytes: measured.lazyRaw,
    minHeadroomGzipBytes: MIN_HEADROOM_GZIP_BYTES,
    minHeadroomRawBytes: MIN_HEADROOM_RAW_BYTES,
    stepGzipBytes: STEP_GZIP_BYTES,
    stepRawBytes: STEP_RAW_BYTES,
    maxFirstPaintGzipBytes: fpGzip.max,
    maxFirstPaintRawBytes: fpRaw.max,
    headroomFirstPaintGzipBytes: fpGzip.headroom,
    headroomFirstPaintRawBytes: fpRaw.headroom,
    maxLazyGzipBytes: lazyGzip.max,
    maxLazyRawBytes: lazyRaw.max,
    headroomLazyGzipBytes: lazyGzip.headroom,
    headroomLazyRawBytes: lazyRaw.headroom,
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
  assertNoDevOnlyChunksShipped(manifest)
  const { resolved: firstPaint, visited: firstPaintVisited } = firstPaintFiles(manifest, byName)
  const firstPaintFileNames = new Set(firstPaint.map((f) => f.file))
  const { resolved: lazy } = lazyFiles(manifest, byName, firstPaintVisited, firstPaintFileNames)
  assertClosureInvariant(manifest, firstPaint, lazy)

  const sum = totals(files)
  const fp = totals(firstPaint)
  const lz = totals(lazy)

  if (write) {
    /** @type {Partial<Budget> | undefined} */
    let previous
    try {
      previous = JSON.parse(readFileSync(BUDGET, 'utf8'))
    } catch {
      /* first write — nothing to carry forward except the default reason */
    }
    const budget = buildBudget(
      { firstPaintGzip: fp.gzip, firstPaintRaw: fp.raw, lazyGzip: lz.gzip, lazyRaw: lz.raw },
      previous,
    )
    writeFileSync(BUDGET, `${JSON.stringify(budget, null, 2)}\n`)
    process.stdout.write(
      `bundle: baseline written — first paint ${kib(fp.gzip)} gzip / ${kib(fp.raw)} raw ` +
        `(ceiling ${kib(budget.maxFirstPaintGzipBytes)} gzip / ${kib(budget.maxFirstPaintRawBytes)} raw, ` +
        `headroom ${kib(budget.headroomFirstPaintGzipBytes)} gzip / ${kib(budget.headroomFirstPaintRawBytes)} raw), ` +
        `lazy ${kib(lz.gzip)} gzip / ${kib(lz.raw)} raw ` +
        `(ceiling ${kib(budget.maxLazyGzipBytes)} gzip / ${kib(budget.maxLazyRawBytes)} raw, ` +
        `headroom ${kib(budget.headroomLazyGzipBytes)} gzip / ${kib(budget.headroomLazyRawBytes)} raw), ` +
        `sum ${kib(sum.gzip)} gzip / ${kib(sum.raw)} raw (informational only, no ceiling)\n`,
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

  // AN OLD-SHAPED BUDGET FILE MUST NOT SILENTLY GATE NOTHING. Before lazy existed, this
  // file had no maxLazyGzipBytes/maxLazyRawBytes at all — a merge that resolves toward that
  // old side, or this check cherry-picked ahead of its own baseline, leaves those fields
  // `undefined`. Every comparison below is a `>` against that `undefined`, which JavaScript
  // quietly coerces to `false`: the row would print `ceiling NaN KiB`, exit 0, and gate
  // nothing at all — the exact false green this whole layer exists to refuse. Checked
  // explicitly, by name, for all FOUR gated fields (first paint + lazy) rather than trusted
  // to `fail()`'s own arithmetic to notice.
  /** @type {[string, number][]} */
  const requiredMaxFields = [
    ['maxFirstPaintGzipBytes', budget.maxFirstPaintGzipBytes],
    ['maxFirstPaintRawBytes', budget.maxFirstPaintRawBytes],
    ['maxLazyGzipBytes', budget.maxLazyGzipBytes],
    ['maxLazyRawBytes', budget.maxLazyRawBytes],
  ]
  const missingMax = requiredMaxFields.filter(([, v]) => !Number.isFinite(v)).map(([name]) => name)
  if (missingMax.length > 0) {
    fail([
      `${BUDGET_REL} has a missing or non-numeric ${missingMax.join(', ')} — this is an ` +
        'old-shaped budget file (from before the lazy closure was measured, or a merge that ' +
        'resolved toward the old side) and would otherwise gate NOTHING silently rather than ' +
        `failing loudly. Regenerate it with --write.`,
    ])
  }

  // BOTH GATES, FIRST PAINT AND LAZY — NEITHER THE SUM NOR ANY OTHER FIGURE. See the file
  // header for why: splitting code between the two moves its bytes from one ceiling to the
  // other, never out of every ceiling that exists.
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
  if (lz.gzip > budget.maxLazyGzipBytes) {
    problems.push(
      `LAZY GZIP OVER BUDGET: ${kib(lz.gzip)} against a ceiling of ${kib(budget.maxLazyGzipBytes)} ` +
        `(+${kib(lz.gzip - budget.maxLazyGzipBytes)}). This is every chunk reachable from the ` +
        'entry only through a dynamic import — code a route nobody has opened yet ships behind.',
    )
  }
  if (lz.raw > budget.maxLazyRawBytes) {
    problems.push(
      `LAZY RAW OVER BUDGET: ${kib(lz.raw)} against a ceiling of ${kib(budget.maxLazyRawBytes)} ` +
        `(+${kib(lz.raw - budget.maxLazyRawBytes)}). This is what the browser must parse and ` +
        'compile the first time this code actually runs.',
    )
  }
  if (problems.length) {
    problems.push(
      `Raising a ceiling is a visible, reasoned edit to ${BUDGET_REL} — it never widens on its ` +
        'own. Lowering it is ordinary; look for a new or oversized dependency, or a chunk that ' +
        'should move to (or out of) a dynamic import.',
    )
    fail(problems)
  }

  for (const f of [...files].sort((a, b) => b.gzip - a.gzip)) {
    process.stdout.write(`bundle:   ${f.file}  ${kib(f.raw)} raw / ${kib(f.gzip)} gzip\n`)
  }
  process.stdout.write(
    `bundle: first paint ${kib(fp.gzip)} gzip / ${kib(fp.raw)} raw, lazy ${kib(lz.gzip)} gzip / ` +
      `${kib(lz.raw)} raw — within budget measured ${budget.measuredAt} (first paint ceiling ` +
      `${kib(budget.maxFirstPaintGzipBytes)} gzip / ${kib(budget.maxFirstPaintRawBytes)} raw; lazy ` +
      `ceiling ${kib(budget.maxLazyGzipBytes)} gzip / ${kib(budget.maxLazyRawBytes)} raw)\n`,
  )

  // Printed on every PASSING run, not only once the budget is nearly gone: a number only
  // heard from when it breaks is a number nobody is actually watching. See the file header
  // for why this, not the pass/fail, is the thing to read. FIRST of four unconditional
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

  // SECOND unconditional WARNING line: lazy's own headroom, mirroring first paint's pair
  // above exactly — lazy is a full gate now, not a printed-only afterthought, so it earns
  // the same "watch this every run" and "fallen BELOW the minimum" treatment.
  const headroomLzGzip = budget.maxLazyGzipBytes - lz.gzip
  const headroomLzRaw = budget.maxLazyRawBytes - lz.raw
  process.stdout.write(
    `WARNING: lazy headroom is ${kib(headroomLzGzip)} gzip / ${kib(headroomLzRaw)} raw before ` +
      `the ceiling measured ${budget.measuredAt} (${kib(budget.maxLazyGzipBytes)} gzip / ` +
      `${kib(budget.maxLazyRawBytes)} raw) — lazy is every manifest-listed chunk reachable from ` +
      'the entry only through a dynamicImports edge; watch this number every run, it is the ' +
      'point of this row, not the pass/fail.\n',
  )
  if (headroomLzGzip < minGzip || headroomLzRaw < minRaw) {
    const short = []
    if (headroomLzGzip < minGzip) short.push(`gzip ${kib(headroomLzGzip)} against ${kib(minGzip)}`)
    if (headroomLzRaw < minRaw) short.push(`raw ${kib(headroomLzRaw)} against ${kib(minRaw)}`)
    process.stdout.write(
      `WARNING: lazy headroom has fallen BELOW the minimum this budget was designed with ` +
        `(${short.join(', ')}). The ceiling was set to absorb roughly one ordinary phase of ` +
        'work; there is now less than that left, so the next ordinary commit trips a red ' +
        '`bundle` row. The intended response is to reduce lazy — raising the ceiling is the ' +
        `move ${BUDGET_REL} exists to make somebody justify in writing.\n`,
    )
  }

  // THIRD unconditional WARNING line: the sum, purely informational now — no ceiling, no
  // headroom clause. First paint and lazy between them already cover every manifest-listed
  // byte (assertClosureInvariant() guarantees it), so this figure exists only to keep a
  // whole-package regression visible even in the (invariant-refused) case where it somehow
  // landed in neither gated closure.
  process.stdout.write(
    `WARNING: sum of ${ASSETS_REL} is ${kib(sum.gzip)} gzip / ${kib(sum.raw)} raw — first paint ` +
      'plus lazy plus anything unlisted; informational only, no ceiling of its own. First paint ' +
      'and lazy are the two gated budgets code moves between when you split; this figure is not ' +
      'a third one.\n',
  )

  // FOURTH unconditional WARNING line, printed on every run regardless of size — not gated
  // behind a threshold, which would reproduce the exact failure the headroom lines above
  // were fixed to avoid: a number only heard from once it crosses some line is a number
  // nobody reads until it already broke. This is deliberately not a pass/fail: no
  // chunk-size ceiling is agreed in this repo, and this check does not invent one — it
  // only makes the largest single JS chunk impossible to miss on every green run.
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

if (process.argv[1]?.endsWith('bundle-size.mjs')) main()
