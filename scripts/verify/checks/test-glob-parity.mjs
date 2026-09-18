#!/usr/bin/env node
/**
 * Every file that looks like a test in this repository must be collected by exactly one
 * of the six test runners -- never zero, never two.
 *
 * There are SIX collectors here, and their globs do not overlap by design:
 *   - jest-unit  -- backend/jest.config.js (testRegex, rootDir: 'src') -- moved out of
 *                   backend/package.json's "jest" key by Task 20 (verify-layer plan), so
 *                   coverageThreshold there could be computed from process.env; a static
 *                   JSON block in package.json cannot do that.
 *   - jest-db    -- backend/jest.db.config.js (a separate testRegex, also rootDir: 'src')
 *   - vitest     -- frontend/vite.config.ts, vitest's DEFAULT include (not set explicitly)
 *   - node-test  -- scripts/**\/*.test.mjs AND .claude/hooks/**\/*.test.mjs, both run by
 *                   `npm run test:verify` (two globs passed to the same `node --test`
 *                   invocation -- see package.json). The Stop-hook `stop-gate.mjs` (Task
 *                   19) is the first file under .claude/hooks/ with a colocated test, and
 *                   is why this collector covers that directory too, not just scripts/.
 *   - playwright -- e2e/**\/*.spec.ts, run by `npm run test:e2e` (playwright.config.ts's
 *                   `testDir: './e2e'`, Playwright's own DEFAULT `testMatch` -- not set
 *                   explicitly there either)
 *   - shell-test -- scripts/ci/*.test.sh, run by `npm run test:ci-scripts` (see the
 *                   `test:ci-scripts` row, scripts/verify/registry.mjs). Task 21
 *                   (verify-layer reconciliation) added this collector after a whole-branch
 *                   review found, BY HAND, that origin/main's `checks` job ran these two
 *                   suites with a bare shell line (`bash scripts/ci/coolify-deploy.test.sh
 *                   && bash scripts/ci/ghcr-cleanup.test.sh`) that this check's own
 *                   CANDIDATE_FILE regex -- [cm]?[jt]sx? extensions only -- could not see:
 *                   a `checks` job deleted out from under that line would have stopped it
 *                   running with NO row here noticing, because a `.sh` file was invisible on
 *                   both sides of this comparison, not merely uncollected. This collector,
 *                   and the SHELL_TEST_FILE candidate net below, close that gap mechanically
 *                   so the same class of miss cannot recur unnoticed.
 *
 * playwright was the fifth collector this check's own registry entry (`testfiles`,
 * scripts/verify/registry.mjs) already admitted would show up eventually ("a fifth
 * collector added later is unseen by this row until this row is taught about it") --
 * Task 17 (`smoke`) was that later, and this file was the teaching; shell-test is the
 * sixth, taught the identical way. The same admission applies one directory at a time, not
 * just one runner at a time: node-test's OWN reach grew from scripts/ to scripts/ PLUS
 * .claude/hooks/ in Task 19, for the identical reason.
 *
 * The cheapest way to get a dead test suite is a glob that quietly excludes a whole file:
 * `backend/src/foo.test.ts` matches neither backend testRegex (both require .spec.ts or
 * .db-spec.ts) nor any other collector's root, so it would sit green forever -- nobody runs
 * it, and nothing says so. Conversely, if the two backend regexes ever started overlapping,
 * the same file would run twice under two configs without anyone deciding that on purpose.
 *
 * The two backend regexes are read OUT OF backend/jest.config.js and
 * backend/jest.db.config.js at runtime rather than copied here: a hard-coded copy is a
 * second source of truth that can drift from the config it claims to describe, which is
 * exactly the class of bug this check exists to catch.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const require = createRequire(import.meta.url)

/**
 * Exit loud, never fall back.
 *
 * A derivation that cannot read the runner it models has learned something real: "I can no
 * longer tell what runs" and "something does not run" deserve the same red. Falling back to
 * a hard-coded glob would recreate the exact defect this derivation exists to remove — a
 * second source of truth that looks green while the runner has moved.
 *
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`test:files: CANNOT DERIVE RUNNER GLOBS -- ${message}\n`)
  process.exit(1)
}

// Candidate test files: anything that looks like a test, spec, or db-spec, in any of the
// extensions jest/vitest recognise ([cm]?[jt]sx?). Broader than any single collector's
// pattern on purpose -- a file this misses could never be reported as an orphan.
const CANDIDATE_FILE = /\.(test|spec|db-spec)\.[cm]?[jt]sx?$/

// A second, separate candidate net for shell tests: anything named *.test.sh, ANYWHERE in
// the repo -- not scoped to scripts/ci/ the way the shell-test COLLECTOR below is. Candidate
// detection and collection are deliberately two different questions: this net exists so a
// *.test.sh file written somewhere the shell-test collector does not reach is reported as an
// ORPHAN (see main()), not silently invisible the way every .sh file was before Task 21 --
// exactly the gap a whole-branch review found by hand in origin/main's `checks` job.
// It stays WIDER than the collector on purpose; that is what makes the ORPHAN report
// possible at all.
const SHELL_TEST_FILE = /\.test\.sh$/

// vitest's own default `include` pattern. frontend/vite.config.ts does not set `test.include`,
// so this is vitest's built-in default -- not a copy of anything this repo's own config owns --
// which is why, unlike the two backend regexes below, it is fine to state here directly.
const VITEST_DEFAULT_INCLUDE = /\.(test|spec)\.[cm]?[jt]sx?$/

// Playwright's own default `testMatch`, read straight off the installed package
// (node_modules/playwright/lib/common/index.js: `"**/*.@(spec|test).?(c|m)[jt]s?(x)"`) --
// playwright.config.ts does not set `testMatch` either, so, like vitest's default above,
// this is a built-in default rather than a copy of anything this repo's own config owns.
// Same shape as VITEST_DEFAULT_INCLUDE (this repo's one e2e spec is `.spec.ts`, not
// `.db-spec.ts` -- Playwright's own default never matches that middle segment at all).
const PLAYWRIGHT_DEFAULT_INCLUDE = /\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * @param {string} file
 * @param {readonly string[]} args
 * @returns {string}
 */
function run(file, args) {
  return execFileSync(file, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** @returns {string[]} every tracked-or-untracked candidate test file, repo-root relative */
function candidates() {
  // Built at runtime rather than typed as an escape literal: this environment has a known
  // failure mode where a typed unicode escape lands as the raw control byte instead, which
  // would make this very file inconsistent with its own recorded byte-scan.
  const NUL = String.fromCharCode(0)
  const raw = run('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'])
  return [
    ...new Set(
      raw.split(NUL).filter((f) => f && (CANDIDATE_FILE.test(f) || SHELL_TEST_FILE.test(f))),
    ),
  ].sort()
}

/**
 * Reads the unit-test regex out of backend/jest.config.js at runtime, by loading the
 * actual config module jest itself loads -- not a copy of it. Was backend/package.json's
 * "jest" key until Task 20 (verify-layer plan) moved it into this file so
 * coverageThreshold could be computed from process.env -- a static JSON block in
 * package.json cannot do that.
 *
 * @returns {RegExp}
 */
function jestUnitRegex() {
  const file = path.join(ROOT, 'backend', 'jest.config.js')
  /** @type {{ testRegex?: unknown }} */
  const config = require(file)
  const src = config.testRegex
  if (typeof src !== 'string') {
    throw new Error(`${path.relative(ROOT, file)}: testRegex not found`)
  }
  return new RegExp(src)
}

/**
 * Reads the db-spec regex out of backend/jest.db.config.js at runtime, by loading the
 * actual config module jest itself loads -- not a copy of it.
 *
 * @returns {RegExp}
 */
function jestDbRegex() {
  const file = path.join(ROOT, 'backend', 'jest.db.config.js')
  /** @type {{ testRegex?: unknown }} */
  const config = require(file)
  const src = config.testRegex
  if (typeof src !== 'string') {
    throw new Error(`${path.relative(ROOT, file)}: testRegex not found`)
  }
  return new RegExp(src)
}

/**
 * A shell one-liner split into tokens, honouring single and double quotes. Enough for the
 * two npm scripts below and deliberately no more — anything it cannot parse is an error,
 * never a fallback.
 *
 * @param {string} src
 * @returns {string[]}
 */
function tokenize(src) {
  return (src.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((t) =>
    /^['"]/.test(t) ? t.slice(1, -1) : t,
  )
}

/**
 * @param {string} id
 * @returns {string}
 */
function scriptSource(id) {
  /** @type {{ scripts?: Record<string, string> }} */
  const pkg = require(path.join(ROOT, 'package.json'))
  const src = pkg.scripts?.[id]
  if (typeof src !== 'string') {
    fail(`package.json has no "${id}" script — this check models a runner that does not exist`)
  }
  return src
}

/**
 * THE GLOBS `npm run test:verify` ACTUALLY PASSES TO `node --test`, read at runtime.
 *
 * `node --test 'a/**' 'b/**'` — the positionals are the surface. A hard-coded copy is a
 * second source of truth, and the copy this replaced was wider than the runner, which is
 * how a `.test.mjs` under scripts/ci/ could read as collected and never run.
 *
 * @returns {string[]}
 */
export function nodeTestGlobs() {
  const src = scriptSource('test:verify')
  const tokens = tokenize(src)
  if (tokens[0] !== 'node' || !tokens.includes('--test')) {
    fail(`package.json scripts["test:verify"] is no longer a bare \`node --test …\` command: ${src}`)
  }
  if (tokens.some((t) => t === '&&' || t === '||' || t === ';' || t === '|')) {
    fail(`package.json scripts["test:verify"] is a compound shell command this check cannot parse: ${src}`)
  }
  const globs = tokens.slice(1).filter((t) => !t.startsWith('-'))
  if (!globs.length) fail(`package.json scripts["test:verify"] passes no positional test globs: ${src}`)
  return globs
}

/**
 * THE GLOBS `npm run test:ci-scripts` ACTUALLY ITERATES, read at runtime.
 *
 * `for f in scripts/ci/*.test.sh; do …; done`. A POSIX `*` never crosses a `/`, which the
 * hand-written `startsWith('scripts/ci/')` prefix test it replaces did.
 *
 * @returns {string[]}
 */
export function shellTestGlobs() {
  const src = scriptSource('test:ci-scripts')
  const m = /^\s*for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+([^;]+);\s*do\b/.exec(src)
  if (!m) {
    fail(
      'package.json scripts["test:ci-scripts"] is not the expected ' +
        `\`for VAR in <globs>; do … done\` form: ${src}`,
    )
  }
  const globs = tokenize(m[1])
  if (!globs.length) fail(`package.json scripts["test:ci-scripts"] iterates over nothing: ${src}`)
  return globs
}

/**
 * @param {string} file repo-root-relative, posix-separated (as `git ls-files` prints it)
 * @param {RegExp} unitRe
 * @param {RegExp} dbRe
 * @param {string[]} nodeGlobs positionals of package.json's `test:verify`
 * @param {string[]} shellGlobs the iteration globs of package.json's `test:ci-scripts`
 * @returns {string[]} the collectors that would pick this file up
 */
export function collectorsFor(file, unitRe, dbRe, nodeGlobs, shellGlobs) {
  /** @type {string[]} */
  const collectors = []
  if (file.startsWith('backend/src/') && unitRe.test(file)) collectors.push('jest-unit')
  if (file.startsWith('backend/src/') && dbRe.test(file)) collectors.push('jest-db')
  if (file.startsWith('frontend/') && VITEST_DEFAULT_INCLUDE.test(file)) collectors.push('vitest')
  // BOTH of these are the runner's OWN globs, read out of package.json at startup and
  // matched with the same glob semantics node itself applies. They used to be hand-written
  // prefix tests, and both were wider than the command they modelled:
  //
  //   node-test    modelled `scripts/` + endsWith('.test.mjs'); the runner's glob is
  //                `scripts/verify/**/*.test.mjs`. So scripts/ci/x.test.mjs — or anything
  //                under scripts/vps/ — read as "collected by exactly one runner" and was
  //                never executed by anything. A dead suite, green forever.
  //   shell-test   modelled a `scripts/ci/` PREFIX, which recurses; the runner is
  //                `for f in scripts/ci/*.test.sh`, and a POSIX `*` never crosses a `/`.
  //                So scripts/ci/nested/y.test.sh had the same defect.
  //
  // The file's own comment claimed "both sides are the SAME glob today". They were not,
  // and that sentence is why nobody looked. Deriving them is invariant #5 — read globs
  // from the config that owns them, never keep a second copy.
  if (nodeGlobs.some((g) => path.matchesGlob(file, g))) collectors.push('node-test')
  if (file.startsWith('e2e/') && PLAYWRIGHT_DEFAULT_INCLUDE.test(file)) collectors.push('playwright')
  if (shellGlobs.some((g) => path.matchesGlob(file, g))) collectors.push('shell-test')
  return collectors
}

function main() {
  const unitRe = jestUnitRegex()
  const dbRe = jestDbRegex()
  const nodeGlobs = nodeTestGlobs()
  const shellGlobs = shellTestGlobs()
  const files = candidates()

  // A scan that matched nothing must never print a positive claim. Without this the check
  // reports "each collected by exactly one runner" over an empty list and exits 0 — the
  // exact shape of false green this whole layer exists to refuse.
  if (files.length === 0) {
    process.stderr.write(
      'test:files: found ZERO candidate test files under this root — refusing to report a ' +
        'verdict. Either the enumeration broke or the root is wrong.\n',
    )
    process.exit(1)
  }

  /** @type {string[]} */
  const problems = []
  for (const file of files) {
    const collectors = collectorsFor(file, unitRe, dbRe, nodeGlobs, shellGlobs)
    if (collectors.length === 0) {
      problems.push(`ORPHAN: ${file} -- no runner collects it (zero collectors matched).`)
    } else if (collectors.length > 1) {
      problems.push(`DOUBLE-COLLECTED: ${file} -- claimed by both ${collectors.join(' + ')}.`)
    }
  }

  const summary =
    `test:files: ${files.length} candidate test file(s) checked against 6 collectors ` +
    '(jest-unit, jest-db, vitest, node-test, playwright, shell-test)'

  if (problems.length) {
    process.stderr.write(`${summary}\n`)
    for (const p of problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }

  process.stdout.write(`${summary} -- each collected by exactly one runner\n`)
}

// GUARDED, so a test can import `collectorsFor` without running the scan. Every module in
// this layer used to call main() at load; that makes the pure, cheap, fixture-free unit
// test of a finding-producer impossible to write, and — worse — an ORPHAN in the tree would
// `process.exit(1)` out of the importing test process.
if (process.argv[1] && process.argv[1].endsWith('test-glob-parity.mjs')) main()
