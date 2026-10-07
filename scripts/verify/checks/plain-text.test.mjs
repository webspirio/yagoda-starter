/**
 * Exception logic is tested as pure functions; the CLI against throwaway git repos. Exactly
 * one test runs against the real repository, and its discriminator is the file count,
 * derived here independently of the check's own enumeration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { applyExceptions, validateExceptions } from './plain-text.mjs'
import { fixtureGitEnv, gitEnv } from '../scan-root.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'plain-text.mjs')
const REASON = 'design showcase, not a product screen'

/** @param {string} file @param {string} text */
const cand = (file, text) => ({ file, line: 1, col: 1, rule: /** @type {const} */ ('jsx-text'), text })

/** @param {Record<string, string>} files @returns {string} */
function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plain-text-'))
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), body)
  }
  execFileSync('git', ['init', '-q'], { cwd: root, env: fixtureGitEnv() })
  return root
}

/** @param {string} [root] */
function run(root) {
  const args = root ? [CHECK, '--root', root] : [CHECK]
  try {
    return { status: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8' }) }
  } catch (err) {
    const e = /** @type {any} */ (err)
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('a file exception excuses every finding in that file and nothing elsewhere', () => {
  const { findings, stale } = applyExceptions(
    [cand('a.tsx', 'One'), cand('a.tsx', 'Two'), cand('b.tsx', 'Three')],
    [{ file: 'a.tsx', count: 2, date: '2026-10-06', reason: REASON }],
  )
  assert.deepEqual(findings.map((f) => f.text), ['Three'])
  assert.deepEqual(stale, [])
})

test('a text exception excuses only that text in that file, compared normalised', () => {
  const { findings } = applyExceptions(
    [cand('a.tsx', 'Unhandled error'), cand('a.tsx', 'Other'), cand('b.tsx', 'Unhandled error')],
    [{ file: 'a.tsx', text: '  Unhandled\n error ', date: '2026-10-06', reason: REASON }],
  )
  assert.deepEqual(findings.map((f) => `${f.file}:${f.text}`), ['a.tsx:Other', 'b.tsx:Unhandled error'])
})

test('an exception that matches nothing is stale, for both shapes', () => {
  const { stale } = applyExceptions(
    [cand('a.tsx', 'Kept')],
    [
      { file: 'gone.tsx', count: 1, date: '2026-10-06', reason: REASON },
      { file: 'a.tsx', text: 'Fixed already', date: '2026-10-06', reason: REASON },
      { file: 'a.tsx', text: 'Kept', date: '2026-10-06', reason: REASON },
    ],
  )
  assert.deepEqual(stale.map((s) => s.text ?? s.file), ['gone.tsx', 'Fixed already'])
})

test('validateExceptions: an empty reason, a bad date, a missing or stray count, a non-array', () => {
  assert.match(validateExceptions({}).problems.join('\n'), /must be a JSON array/)
  const { entries, problems } = validateExceptions([
    { file: 'a.tsx', count: 1, date: '2026-10-06', reason: '   ' },
    { file: 'b.tsx', count: 1, date: '06.10.2026', reason: REASON },
    { file: 'c.tsx', date: '2026-10-06', reason: REASON },
    { file: 'd.tsx', text: 'X', count: 3, date: '2026-10-06', reason: REASON },
    { file: 'e.tsx', count: 2, date: '2026-10-06', reason: 'short' },
  ])
  assert.equal(problems.length, 4, problems.join('\n'))
  assert.match(problems[0], /a\.tsx.*reason/)
  assert.match(problems[1], /b\.tsx.*date/)
  assert.match(problems[2], /c\.tsx.*count/)
  assert.match(problems[3], /d\.tsx.*count/)
  assert.deepEqual(entries.map((e) => e.file), ['e.tsx'])
})

test('A4: a file-wide exception goes RED when the file gains text, and asks to lower count when it loses some', () => {
  const entry = { file: 'a.tsx', count: 2, date: '2026-10-06', reason: REASON }
  assert.deepEqual(applyExceptions([cand('a.tsx', 'One'), cand('a.tsx', 'Two')], [entry]).drift, [])
  const grew = applyExceptions([cand('a.tsx', 'One'), cand('a.tsx', 'Two'), cand('a.tsx', 'New')], [entry])
  assert.match(grew.drift.join('\n'), /a\.tsx: 3 candidates, the exception accepts 2/)
  assert.deepEqual(grew.findings, [])
  const shrank = applyExceptions([cand('a.tsx', 'One')], [entry])
  assert.match(shrank.drift.join('\n'), /lower count to 1/)
})

test('CLI A4: one more string in an excused file turns the row RED', () => {
  const entry = { file: 'frontend/src/a.tsx', count: 1, date: '2026-10-06', reason: REASON }
  const root = fixture({
    'frontend/src/a.tsx': 'export const B = () => <p>Close</p>;\n',
    'scripts/verify/baselines/plain-text.json': JSON.stringify([entry]),
  })
  try {
    assert.equal(run(root).status, 0)
    writeFileSync(path.join(root, 'frontend/src/a.tsx'), 'export const B = () => <p>Close</p>;\nexport const C = () => <p>Open</p>;\n')
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /2 candidates, the exception accepts 1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: RED names file, line, rule and text', () => {
  const root = fixture({ 'frontend/src/a.tsx': `export const A = () => <p>{t('k')}</p>;\nexport const B = () => <p>Close</p>;\n` })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /frontend\/src\/a\.tsx:2:\d+ {2}jsx-text {2}"Close"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: an exception turns it green; a stale one turns it red again', () => {
  const entry = { file: 'frontend/src/a.tsx', text: 'Close', date: '2026-10-06', reason: REASON }
  const root = fixture({
    'frontend/src/a.tsx': 'export const B = () => <p>Close</p>;\n',
    'scripts/verify/baselines/plain-text.json': JSON.stringify([entry]),
  })
  try {
    assert.equal(run(root).status, 0)
    writeFileSync(path.join(root, 'frontend/src/a.tsx'), 'export const B = () => <p>{t("k")}</p>;\n')
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /stale exception/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: a malformed baseline is a readable RED, not a stack trace', () => {
  const root = fixture({
    'frontend/src/a.tsx': 'export const A = 1;\n',
    'scripts/verify/baselines/plain-text.json': '{ not json',
  })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /plain-text: RED/)
    assert.doesNotMatch(r.out, /at .*\.mjs:\d+/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: an empty frontend refuses a verdict', () => {
  const root = fixture({ 'README.md': '' })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /scanned ZERO/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real repository is green, over the file count derived independently here', () => {
  const independent = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', 'frontend/src'], { cwd: REPO, env: gitEnv(), encoding: 'utf8' })
    .split('\n')
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.') && !f.includes('/locales/') && !/test-setup\.tsx?$/.test(f))
  const r = run()
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, new RegExp(`across ${independent.length} frontend source file`))
})
