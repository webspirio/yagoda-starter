import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fixtureGitEnv } from '../scan-root.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'test-glob-parity.mjs')

// Safe: the check guards main() behind its own argv, so importing it runs no scan.
const { collectorsFor, isCandidate, jestDbRegex, jestUnitRegex, nodeTestGlobs, shellTestGlobs } =
  await import(CHECK)

/**
 * NOTHING BELOW WRITES THE REAL WORKING TREE.
 *
 * Five of these tests used to plant a fixture file under backend/src, frontend/src,
 * .claude/hooks/ or scripts/ci/, spawn the whole check, and delete the file in a `finally`.
 * The Stop hook runs the fast tier after every turn under a timeout that kills the process
 * group, and a killed process runs no `finally` — so those fixtures could survive as
 * untracked files in the tree they were asserting about. Every one of them asked a question
 * `collectorsFor` answers directly, in-process, from a string.
 *
 * @param {string[]} [args]
 * @param {Record<string, string>} [env]
 */
function run(args = [], env = {}) {
  try {
    return {
      status: 0,
      out: execFileSync(process.execPath, [CHECK, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
      }),
    }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as the other check suites' run() helpers.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** The real nets, read from the configs that own them — not copies. */
const UNIT = jestUnitRegex()
const DB = jestDbRegex()
const NODE_GLOBS = nodeTestGlobs()
const SHELL_GLOBS = shellTestGlobs()

/** @param {string} rel @returns {string[]} */
const collectors = (rel) => collectorsFor(rel, UNIT, DB, NODE_GLOBS, SHELL_GLOBS)

test('the real tree is green', () => {
  assert.equal(run().status, 0)
})

test('every shape the old fixture files tested, asked directly', () => {
  // One table, replacing five tests that each wrote a file into the real tree and spawned
  // the check. Left column is the path; right column is who runs it. An empty list is an
  // ORPHAN — a file nobody executes and nothing reports.
  /** @type {[string, string[]][]} */
  const cases = [
    // The cheapest way to get a dead suite: .test.ts matches neither backend regex.
    ['backend/src/zz-orphan.test.ts', []],
    ['backend/src/users/users.service.spec.ts', ['jest-unit']],
    ['backend/src/crates/crates.db-spec.ts', ['jest-db']],
    ['frontend/src/zz-ok.spec.tsx', ['vitest']],
    ['.claude/hooks/zz-ok.test.mjs', ['node-test']],
    ['scripts/verify/hash.test.mjs', ['node-test']],
    ['scripts/ci/zz-ok.test.sh', ['shell-test']],
    ['e2e/smoke.spec.ts', ['playwright']],
    // The candidate net is WIDER than the shell collector on purpose: a *.test.sh outside
    // scripts/ci/ is an orphan rather than invisible.
    ['scripts/zz-orphan.test.sh', []],
  ]
  for (const [rel, expected] of cases) {
    assert.deepEqual(collectors(rel), expected, rel)
  }
})

test('every orphan shape is a CANDIDATE, or it could never be reported as one', () => {
  // THE OTHER HALF, and the half a collectorsFor test cannot see. A file the candidate net
  // misses is never asked about, so it reads as green no matter what collectorsFor would
  // have said. That is exactly how every *.sh file in the repo stayed invisible.
  for (const rel of ['backend/src/zz-orphan.test.ts', 'scripts/zz-orphan.test.sh']) {
    assert.equal(isCandidate(rel), true, rel)
  }
  // And the net is not simply true for everything:
  for (const rel of ['backend/src/users/users.service.ts', 'scripts/verify/run.mjs', 'README.md']) {
    assert.equal(isCandidate(rel), false, rel)
  }
})

test('a root with no test files refuses a verdict instead of printing a green one', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'glob-parity-'))
  try {
    // The minimum a run needs before it can even ask the question: the two npm scripts the
    // runner globs are derived from, and the two jest configs the backend regexes are read
    // out of. Copied in shape only — no test file anywhere.
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'test:verify': "node --test 'scripts/verify/**/*.test.mjs' '.claude/hooks/**/*.test.mjs'",
          'test:ci-scripts': 'for f in scripts/ci/*.test.sh; do bash "$f"; done',
        },
      }),
    )
    mkdirSync(path.join(root, 'backend'), { recursive: true })
    writeFileSync(path.join(root, 'backend', 'jest.config.js'), "module.exports = { testRegex: '.*\\.spec\\.ts$' }\n")
    writeFileSync(path.join(root, 'backend', 'jest.db.config.js'), "module.exports = { testRegex: '.*\\.db-spec\\.ts$' }\n")
    execFileSync('git', ['init', '-q'], { cwd: root, env: fixtureGitEnv() })

    const res = run([], { VERIFY_SCAN_ROOT: root })
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /ZERO candidate test files/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * THE TWO TESTS THAT WOULD HAVE CAUGHT THE DEFECT.
 *
 * This check used to hand-write `startsWith('scripts/')` against a runner whose glob is
 * `scripts/verify/**`, and `startsWith('scripts/ci/')` — which recurses — against a POSIX
 * `*`, which does not. Both were WIDER than the command they modelled, so a test file in
 * the gap read as "collected by exactly one runner" and was never executed by anything.
 *
 * `collectorsFor` is now pure and exported, and these run in-process against string
 * literals: no subprocess, no git, and nothing written to the real working tree.
 */
const NOOP_RE = /$^/

test('a .test.mjs outside the runner glob is collected by NOBODY', () => {
  const nodeGlobs = ['scripts/verify/**/*.test.mjs', '.claude/hooks/**/*.test.mjs']
  const shellGlobs = ['scripts/ci/*.test.sh']

  // The discriminator: the same call must SEE the files that really are collected, or this
  // test passes against a matcher that matches nothing at all.
  assert.deepEqual(
    collectorsFor('scripts/verify/hash.test.mjs', NOOP_RE, NOOP_RE, nodeGlobs, shellGlobs),
    ['node-test'],
  )
  assert.deepEqual(
    collectorsFor('.claude/hooks/stop-gate.test.mjs', NOOP_RE, NOOP_RE, nodeGlobs, shellGlobs),
    ['node-test'],
  )
  assert.deepEqual(
    collectorsFor('scripts/ci/coolify-deploy.test.sh', NOOP_RE, NOOP_RE, nodeGlobs, shellGlobs),
    ['shell-test'],
  )

  // And the two shapes that used to read as collected:
  assert.deepEqual(
    collectorsFor('scripts/ci/x.test.mjs', NOOP_RE, NOOP_RE, nodeGlobs, shellGlobs),
    [],
    'scripts/ci/x.test.mjs is not matched by scripts/verify/**/*.test.mjs — nothing runs it',
  )
  assert.deepEqual(
    collectorsFor('scripts/vps/y.test.mjs', NOOP_RE, NOOP_RE, nodeGlobs, shellGlobs),
    [],
  )
  assert.deepEqual(
    collectorsFor('scripts/ci/nested/z.test.sh', NOOP_RE, NOOP_RE, nodeGlobs, shellGlobs),
    [],
    'a POSIX * never crosses a /, so `for f in scripts/ci/*.test.sh` never reaches nested/',
  )
})

test('the derived globs ARE the runner argv, character for character', () => {
  // This is the half that ties the model to the command. If package.json's test:verify or
  // test:ci-scripts is rewritten, this fails rather than the model quietly drifting.
  assert.deepEqual(nodeTestGlobs(), [
    'scripts/verify/**/*.test.mjs',
    '.claude/hooks/**/*.test.mjs',
  ])
  assert.deepEqual(shellTestGlobs(), ['scripts/ci/*.test.sh'])
})
