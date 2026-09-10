#!/usr/bin/env node
/**
 * Every file that looks like a test in this repository must be collected by exactly one
 * of the five test runners -- never zero, never two.
 *
 * There are FIVE collectors here, and their globs do not overlap by design:
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
 *
 * playwright is the fifth collector this check's own registry entry (`testfiles`,
 * scripts/verify/registry.mjs) already admitted would show up eventually ("a fifth
 * collector added later is unseen by this row until this row is taught about it") --
 * Task 17 (`smoke`) is that later, and this file is the teaching. The same admission
 * applies one directory at a time, not just one runner at a time: node-test's OWN reach
 * grew from scripts/ to scripts/ PLUS .claude/hooks/ in Task 19, for the identical reason.
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

// Candidate test files: anything that looks like a test, spec, or db-spec, in any of the
// extensions jest/vitest recognise ([cm]?[jt]sx?). Broader than any single collector's
// pattern on purpose -- a file this misses could never be reported as an orphan.
const CANDIDATE_FILE = /\.(test|spec|db-spec)\.[cm]?[jt]sx?$/

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
  return [...new Set(raw.split(NUL).filter((f) => f && CANDIDATE_FILE.test(f)))].sort()
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
 * @param {string} file repo-root-relative, posix-separated (as `git ls-files` prints it)
 * @param {RegExp} unitRe
 * @param {RegExp} dbRe
 * @returns {string[]} the collectors that would pick this file up
 */
function collectorsFor(file, unitRe, dbRe) {
  /** @type {string[]} */
  const collectors = []
  if (file.startsWith('backend/src/') && unitRe.test(file)) collectors.push('jest-unit')
  if (file.startsWith('backend/src/') && dbRe.test(file)) collectors.push('jest-db')
  if (file.startsWith('frontend/') && VITEST_DEFAULT_INCLUDE.test(file)) collectors.push('vitest')
  // Both globs feed the SAME `node --test` invocation (package.json's test:verify) -- see
  // this file's header comment for why .claude/hooks/ joined scripts/ here in Task 19.
  if (file.startsWith('scripts/') && file.endsWith('.test.mjs')) collectors.push('node-test')
  if (file.startsWith('.claude/hooks/') && file.endsWith('.test.mjs')) collectors.push('node-test')
  if (file.startsWith('e2e/') && PLAYWRIGHT_DEFAULT_INCLUDE.test(file)) collectors.push('playwright')
  return collectors
}

function main() {
  const unitRe = jestUnitRegex()
  const dbRe = jestDbRegex()
  const files = candidates()

  /** @type {string[]} */
  const problems = []
  for (const file of files) {
    const collectors = collectorsFor(file, unitRe, dbRe)
    if (collectors.length === 0) {
      problems.push(`ORPHAN: ${file} -- no runner collects it (zero collectors matched).`)
    } else if (collectors.length > 1) {
      problems.push(`DOUBLE-COLLECTED: ${file} -- claimed by both ${collectors.join(' + ')}.`)
    }
  }

  const summary =
    `test:files: ${files.length} candidate test file(s) checked against 5 collectors ` +
    '(jest-unit, jest-db, vitest, node-test, playwright)'

  if (problems.length) {
    process.stderr.write(`${summary}\n`)
    for (const p of problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }

  process.stdout.write(`${summary} -- each collected by exactly one runner\n`)
}

main()
