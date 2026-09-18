/**
 * EVERY FIXTURE HERE IS A THROWAWAY GIT REPOSITORY, not the real working tree.
 *
 * It used to plant migrations under the real backend/src and — worse — write an in-place
 * edit to `1788600000004-IndexUserIdentityUser.ts`, an ALREADY-MERGED migration, restored
 * only in a `finally`. The Stop hook ran this suite after every turn under a 150s timeout
 * that kills the process group, and a killed process runs no `finally`. So the test for
 * rule 4 could produce exactly the divergence rule 4 exists to catch.
 *
 * The check takes `--root <dir>`, so a fixture is a `mkdtempSync` repo with its own
 * `refs/remotes/origin/main`. Building one costs ~250ms once per file; running the check
 * against three files instead of 318 saves an order of magnitude more than that.
 *
 * NO_GIT_ENV is not optional. `cwd` does not win over `GIT_DIR`, git exports it into every
 * hook, and without the scrub a fixture's `git commit` retargets whatever repository that
 * variable names — which is how this repo once lost its HEAD.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'migration-invariants.mjs')

const NO_GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync('git', args, { cwd, env: NO_GIT_ENV, stdio: 'pipe' })

/**
 * @param {string} [root] when omitted, the check runs against the real repository
 * @returns {{ status: number, out: string }}
 */
function run(root) {
  const args = root ? [CHECK, '--root', root] : [CHECK]
  try {
    return { status: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8' }) }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as secret-boundary.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * A throwaway repository shaped like this one, with a fake `origin/main`.
 *
 * @param {{ originMain?: boolean }} [opts]
 * @returns {{ root: string, cleanup: () => void }}
 */
function fixtureRepo(opts = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-migrations-'))
  git(root, ['init', '-q'])
  mkdirSync(path.join(root, 'backend', 'src', 'migrations'), { recursive: true })
  writeFileSync(
    path.join(root, 'backend', 'src', 'app.module.ts'),
    'export const opts = { synchronize: false };\n',
  )
  writeFileSync(
    path.join(root, 'backend', 'src', 'migrations', '1700000000000-Base.ts'),
    'export class Base1700000000000 {}\n',
  )
  writeFileSync(
    path.join(root, 'backend', 'src', 'migrations', '1700000000001-Second.ts'),
    'export class Second1700000000001 {}\n',
  )
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  if (opts.originMain !== false) git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** @param {string} root @param {string} rel @param {string} content */
function write(root, rel, content) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

/**
 * @param {(root: string) => void} fn
 * @param {{ originMain?: boolean }} [opts]
 */
function withFixture(fn, opts) {
  const { root, cleanup } = fixtureRepo(opts)
  try {
    fn(root)
  } finally {
    cleanup()
  }
}

test('the real tree is green', () => {
  // THE ONE permitted whole-repository assertion in this file (invariant #2). Its
  // discriminator is the summary line: a scanner that saw nothing cannot produce it,
  // because a zero-file scan now exits 1 by construction.
  const res = run()
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, /synchronize is false everywhere in backend\/src/)
})

test('a clean fixture is green', () => {
  withFixture((root) => {
    const res = run(root)
    assert.equal(res.status, 0, res.out)
  })
})

test('an empty root REFUSES a verdict rather than reporting one', () => {
  // The failure mode a --root argument makes more likely, not less: point a check at the
  // wrong directory and it agrees with you. Reproduced against the old code, which printed
  // "migrations: intact" over an empty backend/src and exited 0.
  const root = mkdtempSync(path.join(os.tmpdir(), 'verify-migrations-empty-'))
  try {
    git(root, ['init', '-q'])
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /scanned ZERO/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rule 1: synchronize not literally false is red', () => {
  withFixture((root) => {
    write(root, 'backend/src/zz-sync.ts', 'export const o = { synchronize: true };\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-sync\.ts/)
    assert.match(res.out, /synchronize/)
  })
})

test('rule 2: two migrations sharing a timestamp are red', () => {
  withFixture((root) => {
    write(root, 'backend/src/migrations/1700000000000-Duplicate.ts', 'export class Duplicate1700000000000 {}\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /1700000000000/)
  })
})

test('rule 2: a file that is neither a migration nor a db-spec is red', () => {
  withFixture((root) => {
    write(root, 'backend/src/migrations/notes.txt', 'hello\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /notes\.txt/)
  })
})

test('rule 2: a GITIGNORED stray file is NOT red', () => {
  // `.DS_Store` in this directory used to turn the fast tier red — i.e. the check went red
  // when someone opened a folder in Finder. Rule 1 enumerated with `git ls-files
  // --exclude-standard` and rules 2/3 with `readdirSync`, so the two halves disagreed about
  // what "a file in this repo" means.
  withFixture((root) => {
    write(root, '.gitignore', '.DS_Store\n')
    write(root, 'backend/src/migrations/.DS_Store', '\0\0\n')
    const res = run(root)
    assert.equal(res.status, 0, res.out)
  })
})

test('rule 3: a class name that is not name+timestamp is red', () => {
  withFixture((root) => {
    write(root, 'backend/src/migrations/1700000000009-Fresh.ts', 'export class WrongName1700000000009 {}\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /1700000000009-Fresh\.ts/)
  })
})

test('rule 3: a correctly named NEW migration stays green', () => {
  withFixture((root) => {
    write(root, 'backend/src/migrations/1700000000009-Fresh.ts', 'export class Fresh1700000000009 {}\n')
    const res = run(root)
    // The discriminator: not merely "green", but green while the scanner demonstrably SAW
    // the file — the previous test uses the same path and is red.
    assert.equal(res.status, 0, res.out)
  })
})

test('rule 4a: editing an already-merged migration is red', () => {
  withFixture((root) => {
    write(root, 'backend/src/migrations/1700000000000-Base.ts', 'export class Base1700000000000 {}\n// edited\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /differs from its origin\/main copy/)
  })
})

test('rule 4b: DELETING an already-merged migration is red, naming the file', () => {
  // THE HOLE THIS COMMIT CLOSES. `candidates` is built from the on-disk directory, so a
  // path that is gone is never enumerated and therefore never compared: `rm` a merged
  // migration and the check reported "intact".
  withFixture((root) => {
    rmSync(path.join(root, 'backend/src/migrations/1700000000000-Base.ts'))
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /1700000000000-Base\.ts/)
    assert.match(res.out, /GONE from the working tree/)
  })
})

test('rule 4b: RENAMING an already-merged migration is red, naming the new file', () => {
  // Worse than a deletion: the old path vanishes (invisible to 4a) and the new one has no
  // origin/main counterpart (skipped by 4a), so the run used to be FULLY green.
  withFixture((root) => {
    const dir = path.join(root, 'backend/src/migrations')
    rmSync(path.join(dir, '1700000000000-Base.ts'))
    writeFileSync(path.join(dir, '1700000000000-Renamed.ts'), 'export class Renamed1700000000000 {}\n')
    const res = run(root)
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /RENAMED to 1700000000000-Renamed\.ts/)
  })
})

test('rule 4b: a tree BEHIND origin/main stays green', () => {
  // THE REGRESSION A CARELESS IMPLEMENTATION FAILS. Keying 4b on origin/main rather than
  // the merge-base reports "a merged migration was deleted" for every branch that is one
  // pull behind — which this repository's own main was on the day this was written.
  withFixture((root) => {
    write(root, 'backend/src/migrations/1700000000002-Ahead.ts', 'export class Ahead1700000000002 {}\n')
    git(root, ['add', '-A'])
    git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'ahead'])
    git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    git(root, ['reset', '-q', '--hard', 'HEAD~1'])
    const res = run(root)
    assert.equal(res.status, 0, res.out)
  })
})

test('rule 4 SKIPS with a WARNING when origin/main does not resolve, and the run stays green', () => {
  withFixture(
    (root) => {
      const res = run(root)
      assert.equal(res.status, 0, res.out)
      assert.match(res.out, /WARNING/)
      assert.match(res.out, /SKIPPED/)
    },
    { originMain: false },
  )
})

test('a *.db-spec.ts file beside the migrations is not mistaken for one', () => {
  withFixture((root) => {
    write(root, 'backend/src/migrations/schema.db-spec.ts', "it('x', () => {});\n")
    const res = run(root)
    assert.equal(res.status, 0, res.out)
  })
})
