import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const MEMO = path.join(ROOT, 'CLAUDE.md')
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
