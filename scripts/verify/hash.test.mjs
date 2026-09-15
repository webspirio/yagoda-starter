import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sourceHash, errMessage } from './hash.mjs'

/**
 * Every GIT_* variable stripped from the environment handed to a child `git`.
 *
 * NOT paranoia — this destroyed a real commit on 2026-09-15. `cwd` DOES NOT WIN over
 * `GIT_DIR`: with GIT_DIR set, git ignores the working directory entirely and operates on
 * the repository that variable names. Git EXPORTS GIT_DIR (and GIT_INDEX_FILE) to every
 * hook it runs, so the moment this suite ran from inside a pre-push hook — through
 * `selfcheck`, which is what a pre-push gate is for — this fixture's `git add -A` and
 * `git commit` stopped touching its own throwaway repo and wrote to the REAL one instead,
 * committing the three fixture files as the whole tree and deleting 894 real ones. The
 * working tree survived; HEAD did not.
 *
 * The hook scrubs these too (.githooks/pre-push), so this is the second of two locks. One
 * is not enough: a hook is not the only thing that can export GIT_DIR, and this fixture
 * must be safe wherever it runs.
 */
const NO_GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
)

/** A throwaway git repo shaped like this one, so `git ls-files` has something to list. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-hash-'))
  execFileSync('git', ['init', '-q'], { cwd: root, env: NO_GIT_ENV })
  mkdirSync(path.join(root, 'backend', 'src'), { recursive: true })
  writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n')
  writeFileSync(path.join(root, '.gitignore'), 'ignored/\n')
  mkdirSync(path.join(root, 'ignored'), { recursive: true })
  writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 1\n')
  execFileSync('git', ['add', '-A'], { cwd: root, env: NO_GIT_ENV })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: root,
    env: NO_GIT_ENV,
  })
  return root
}

test('the same tree hashes the same twice', () => {
  const root = fixture()
  try {
    assert.equal(sourceHash(root).hash, sourceHash(root).hash)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('editing a hashed file changes the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 2\n')
    assert.notEqual(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an UNCOMMITTED new file changes the hash — a stale green must not outlive a new test', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'backend', 'src', 'b.spec.ts'), 'it("x", () => {})\n')
    assert.notEqual(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a gitignored file does NOT change the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 2\n')
    assert.equal(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a file outside the hashed surface does NOT change the hash', () => {
  const root = fixture()
  try {
    const before = sourceHash(root).hash
    mkdirSync(path.join(root, 'docs'), { recursive: true })
    writeFileSync(path.join(root, 'docs', 'notes.md'), 'hello\n')
    assert.equal(sourceHash(root).hash, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('deleting a tracked file changes the hash rather than shortening the list invisibly', () => {
  const root = fixture()
  try {
    const before = sourceHash(root)
    rmSync(path.join(root, 'backend', 'src', 'a.ts'))
    const after = sourceHash(root)
    assert.notEqual(after.hash, before.hash)
    assert.equal(after.fileCount, before.fileCount, 'the file is ABSENT, not absent from the list')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('errMessage survives a non-Error throw', () => {
  assert.equal(errMessage(new Error('boom')), 'boom')
  assert.equal(errMessage('boom'), 'boom')
})

test('sourceHash honours its root argument even when GIT_DIR points somewhere else', () => {
  // THE REGRESSION THIS PINS COST A REPOSITORY. `cwd` does not win over `GIT_DIR`: with
  // that variable set, git ignores the working directory and acts on the repository it
  // names. Git exports it into every hook, and .githooks/pre-push runs this layer through
  // `selfcheck` — so on 2026-09-15 this suite's own fixture committed into the REAL repo,
  // replacing its tree with three fixture files and dropping 894 real ones from the index.
  //
  // THE DISCRIMINATOR HAD TO BE BUILT DELIBERATELY, and the first attempt at this test was
  // worthless: it pointed GIT_DIR at a second fixture built by the same helper, so both
  // repositories tracked the SAME paths and the union was indistinguishable from the right
  // answer — it passed with the fix removed. Measured directly: under `cwd=B, GIT_DIR=A`,
  // `git ls-files -c -o` returns B's files (found in the working directory) PLUS A's
  // tracked paths (read from A's index). So the leak is only visible when A tracks a path
  // B does not have. That is what `zz-leak.ts` below is for.
  const a = fixture()
  const b = fixture()
  try {
    writeFileSync(path.join(a, 'backend', 'src', 'zz-leak.ts'), 'export const leak = 1\n')
    execFileSync('git', ['add', '-A'], { cwd: a, env: NO_GIT_ENV })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'leak'], {
      cwd: a,
      env: NO_GIT_ENV,
    })

    const gitDirOfA = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: a,
      env: NO_GIT_ENV,
      encoding: 'utf8',
    }).trim()

    const clean = sourceHash(b)

    const saved = process.env.GIT_DIR
    process.env.GIT_DIR = gitDirOfA
    try {
      const underForeignGitDir = sourceHash(b)
      assert.equal(
        underForeignGitDir.fileCount,
        clean.fileCount,
        "sourceHash(b) counted a different number of files with GIT_DIR pointing at another " +
          'repository — it read GIT_DIR instead of its own argument, and that repo\'s tracked ' +
          'paths leaked into the digest',
      )
      assert.equal(
        underForeignGitDir.hash,
        clean.hash,
        'sourceHash(b) returned a different digest purely because GIT_DIR was set',
      )
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = saved
    }
  } finally {
    rmSync(a, { recursive: true, force: true })
    rmSync(b, { recursive: true, force: true })
  }
})
