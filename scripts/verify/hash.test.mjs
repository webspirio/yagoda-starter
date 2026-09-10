import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sourceHash, errMessage } from './hash.mjs'

/** A throwaway git repo shaped like this one, so `git ls-files` has something to list. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-hash-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(path.join(root, 'backend', 'src'), { recursive: true })
  writeFileSync(path.join(root, 'backend', 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n')
  writeFileSync(path.join(root, '.gitignore'), 'ignored/\n')
  mkdirSync(path.join(root, 'ignored'), { recursive: true })
  writeFileSync(path.join(root, 'ignored', 'junk.ts'), 'export const junk = 1\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: root,
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
