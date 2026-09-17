import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
// The memo moved out of the root CLAUDE.md on 2026-09-16 (see memo-drift.mjs's header).
// This is a SECOND copy of that path — memo-drift.mjs calls main() unconditionally, so it
// cannot be imported for its constant without running the check — and the test below
// asserts the two copies still name the same file rather than trusting them to.
const MEMO = path.join(ROOT, '.claude', 'skills', 'verify', 'SKILL.md')
const CHECK = path.join(ROOT, 'scripts', 'verify', 'checks', 'memo-drift.mjs')

/** @param {string[]} [args] @returns {{ status: number, out: string }} */
function run(args = []) {
  try {
    return { status: 0, out: execFileSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' }) }
  } catch (err) {
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('the committed table matches the registry', () => {
  assert.equal(run().status, 0)
})

test('a hand-edited table is caught', () => {
  const original = readFileSync(MEMO, 'utf8')
  try {
    writeFileSync(MEMO, original.replace('| `lint` |', '| `lint-TAMPERED` |'))
    const res = run()
    assert.equal(res.status, 1)
    assert.match(res.out, /drifted|does not match/i)
  } finally {
    writeFileSync(MEMO, original)
  }
})

test('a missing marker is caught rather than silently generating nothing', () => {
  const original = readFileSync(MEMO, 'utf8')
  try {
    writeFileSync(MEMO, original.replace('<!-- BEGIN:verify-table -->', ''))
    assert.equal(run().status, 1)
  } finally {
    writeFileSync(MEMO, original)
  }
})

test('--write regenerates and then the check is green', () => {
  const original = readFileSync(MEMO, 'utf8')
  try {
    writeFileSync(MEMO, original.replace('| `lint` |', '| `lint-TAMPERED` |'))
    assert.equal(run(['--write']).status, 0)
    assert.equal(run().status, 0)
    assert.equal(readFileSync(MEMO, 'utf8'), original, '--write is idempotent back to the committed form')
  } finally {
    writeFileSync(MEMO, original)
  }
})

test('this suite and memo-drift.mjs still point at the same memo file', () => {
  // Every fixture above edits MEMO in place and restores it. Pointed at the wrong file,
  // they would tamper with a file the check never reads, and then assert it caught
  // something — passing for a reason that has nothing to do with the check. That is not
  // hypothetical: moving the memo out of CLAUDE.md turned two of them red immediately,
  // which is the only reason this drift was visible at all.
  const source = readFileSync(CHECK, 'utf8')
  const wanted = "path.join(ROOT, '.claude', 'skills', 'verify', 'SKILL.md')"
  assert.ok(
    source.includes(wanted),
    `memo-drift.mjs no longer defines MEMO as ${wanted} — update this suite's own copy to match`,
  )
})
