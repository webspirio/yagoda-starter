import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'migration-invariants.mjs')
const BACKEND_SRC = path.join(ROOT, 'backend', 'src')
const MIGRATIONS_DIR = path.join(BACKEND_SRC, 'migrations')

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ status: number, out: string }}
 */
function run(opts = {}) {
  try {
    return {
      status: 0,
      out: execFileSync(process.execPath, [CHECK], { encoding: 'utf8', env: opts.env ?? process.env }),
    }
  } catch (err) {
    // Cast is needed for `npx tsc -p tsconfig.scripts.json` (strict + checkJs types catch
    // variables as `unknown`) — same idiom as secret-boundary.test.mjs's run() helper.
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * Writes a fixture file under backend/src and returns a cleanup function. The check reads
 * `git ls-files -c -o --exclude-standard` for rule 1, and plain `readdirSync` for rules 2/3
 * — either way an untracked-but-not-ignored file is seen without ever being `git add`ed, so
 * cleanup is a plain `rmSync`.
 *
 * @param {string} relFromBackendSrc
 * @param {string} content
 * @returns {() => void}
 */
function writeFixture(relFromBackendSrc, content) {
  const abs = path.join(BACKEND_SRC, relFromBackendSrc)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return () => rmSync(abs, { force: true })
}

/**
 * A `git` shim directory: everything except one exact `rev-parse --verify -q origin/main`
 * invocation is passed straight through to the real `git` on PATH, so rule 1's `git
 * ls-files` and rule 4's `git cat-file`/`git diff` calls (never reached once rule 4 skips,
 * but this keeps the shim honest about what it changes) behave exactly as normal. This
 * simulates "origin/main not fetched" WITHOUT touching this worktree's real
 * `refs/remotes/origin/main` — that ref is shared git state (worktrees share refs), and
 * mutating or deleting it here could affect this repository's other worktrees and any
 * concurrent session.
 *
 * @returns {{ dir: string, cleanup: () => void }}
 */
function makeOriginMainUnresolvableShim() {
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migrations-check-git-shim-'))
  const shimPath = path.join(dir, 'git')
  writeFileSync(
    shimPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ] && [ "$3" = "-q" ] && [ "$4" = "origin/main" ]; then',
      '  exit 1',
      'fi',
      `exec "${realGit}" "$@"`,
      '',
    ].join('\n'),
  )
  chmodSync(shimPath, 0o755)
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('the real tree is green', () => {
  const res = run()
  assert.equal(res.status, 0, res.out)
})

test('adding a migration whose timestamp duplicates an existing one is red, naming the timestamp', () => {
  // "Lower than an existing one" (the brief's phrasing) and "a duplicate" are the same
  // event here: the 8 real timestamps are consecutive integers with no gap, so any new
  // timestamp that is not a new maximum reuses one already on disk. 1788600000003 already
  // names BootstrapOwner.
  const rel = 'migrations/1788600000003-ZzFixtureDuplicate.ts'
  const cleanup = writeFixture(rel, ['export class ZzFixtureDuplicate1788600000003 {}', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /duplicate timestamp 1788600000003/)
    assert.match(res.out, /BootstrapOwner/)
    assert.match(res.out, /ZzFixtureDuplicate/)
  } finally {
    cleanup()
  }
})

test('adding a migration whose exported class name does not match its filename is red', () => {
  const rel = 'migrations/1788600099001-ZzFixtureBadClass.ts'
  const cleanup = writeFixture(rel, ['export class TotallyWrongName {}', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /1788600099001-ZzFixtureBadClass\.ts/)
    assert.match(res.out, /ZzFixtureBadClass1788600099001/)
    assert.match(res.out, /TotallyWrongName/)
  } finally {
    cleanup()
  }
})

test('setting synchronize: true in a copy of app.module.ts is red', () => {
  const rel = 'zz-migrations-fixture-synchronize.ts'
  const cleanup = writeFixture(
    rel,
    [
      "import { TypeOrmModule } from '@nestjs/typeorm';",
      '',
      'export const Fixture = TypeOrmModule.forRootAsync({',
      '  useFactory: () => ({',
      "    type: 'postgres',",
      '    synchronize: true,',
      '  }),',
      '});',
      '',
    ].join('\n'),
  )
  try {
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /zz-migrations-fixture-synchronize\.ts:6/)
    assert.match(res.out, /synchronize is 'true'/)
  } finally {
    cleanup()
  }
})

test('modifying a migration that is an ancestor of origin/main is red, naming the file', () => {
  const target = path.join(MIGRATIONS_DIR, '1788600000004-IndexUserIdentityUser.ts')
  const original = readFileSync(target, 'utf8')
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'origin/main'], { cwd: ROOT, stdio: 'ignore' })
  } catch {
    assert.fail(
      'this test requires origin/main to be a resolvable ref in this worktree — it was not; ' +
        'fetch origin/main and re-run (a separate test below covers the case where it is absent)',
    )
  }
  try {
    writeFileSync(target, `${original}\n// zz-migrations-fixture: frozen-migration mutation test\n`)
    const res = run()
    assert.equal(res.status, 1, res.out)
    assert.match(res.out, /1788600000004-IndexUserIdentityUser\.ts/)
    assert.match(res.out, /origin\/main/)
    assert.match(res.out, /Fix forward/)
  } finally {
    writeFileSync(target, original)
  }
})

test('adding a new migration with the highest timestamp stays green', () => {
  const rel = 'migrations/1788600099002-ZzFixtureNewest.ts'
  const cleanup = writeFixture(rel, ['export class ZzFixtureNewest1788600099002 {}', ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('a *.db-spec.ts file in the migrations directory is excluded from rules 2 and 3', () => {
  const rel = 'migrations/zz-migrations-fixture.db-spec.ts'
  // Not 13-digits-dash-name, and no exported class matching anything — if this were
  // treated as a migration candidate it would fail both rule 2 (bad filename) and rule 3
  // (no matching class). It must be invisible to both.
  const cleanup = writeFixture(rel, ["test('placeholder', () => {});", ''].join('\n'))
  try {
    const res = run()
    assert.equal(res.status, 0, res.out)
  } finally {
    cleanup()
  }
})

test('when origin/main is not resolvable, rule 4 SKIPS with a WARNING and the run stays green', () => {
  const shim = makeOriginMainUnresolvableShim()
  try {
    const res = run({ env: { ...process.env, PATH: `${shim.dir}:${process.env.PATH}` } })
    assert.equal(res.status, 0, res.out)
    assert.match(res.out, /WARNING: origin\/main is not a resolvable ref/)
    assert.match(res.out, /SKIPPED/)
  } finally {
    shim.cleanup()
  }
})
