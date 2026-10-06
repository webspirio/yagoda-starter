/**
 * Every rule of `checkLocales` gets a red case and a green twin. The green twins carry the
 * weight: plural suffixes normalised away, a uk `_one` without {{count}}, a key resolved
 * through its plural base. Each is a real shape of this repo's locales that a naive rule
 * would flag.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkLocales } from './locales.mjs'
import { fixtureGitEnv } from '../scan-root.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'locales.mjs')

/** @param {Record<string, unknown>} byLang @param {string[]} [keys] */
const check = (byLang, keys = []) =>
  checkLocales(new Map(Object.entries(byLang)), keys.map((key) => ({ file: 'a.tsx', line: 1, col: 1, key })))

test('parity: a one-sided key is reported in both directions', () => {
  const p = check({ en: { a: 'A', b: 'B' }, uk: { a: 'А', c: 'В' } })
  assert.ok(p.some((l) => /uk\.json is missing "b"/.test(l)), p.join('\n'))
  assert.ok(p.some((l) => /uk\.json has "c", which en\.json does not/.test(l)), p.join('\n'))
})

test('parity: plural suffixes are normalised, so en one/other vs uk one/few/many/other is green', () => {
  assert.deepEqual(
    check({
      en: { n_one: '{{count}} crate', n_other: '{{count}} crates' },
      uk: { n_one: '{{count}} ящик', n_few: '{{count}} ящики', n_many: '{{count}} ящиків', n_other: '{{count}} ящика' },
    }),
    [],
  )
})

test('plurals: a category Intl requires for the language is missing', () => {
  const p = check({
    en: { n_one: 'x', n_other: 'x' },
    uk: { n_one: 'x', n_few: 'x', n_other: 'x' },
  })
  assert.deepEqual(p, ['uk.json: plural family "n" is missing "n_many"'])
})

test('empty: blank, whitespace, non-string and empty object are each refused', () => {
  const p = check({ en: { a: '', b: '  ', c: 5, d: {}, e: 'ok' }, uk: { a: 'x', b: 'x', c: 'x', d: {}, e: 'ok' } })
  for (const k of ['a', 'b', 'c', 'd']) assert.ok(p.some((l) => l.startsWith('en.json') && l.includes(`"${k}"`)), `${k}: ${p.join('\n')}`)
  assert.ok(p.some((l) => l.startsWith('uk.json') && l.includes('"d"')))
  assert.ok(!p.some((l) => l.includes('"e"')))
})

test('placeholders: differing names are reported; {{count, number}} reads as count', () => {
  const p = check({ en: { a: 'Hi {{name}}', b: '{{count, number}} kg' }, uk: { a: 'Привіт {{user}}', b: '{{count}} кг' } })
  assert.deepEqual(p, ['uk.json: "a" uses placeholders {user}, en.json uses {name}'])
})

test('placeholders: a plural family compares the union of its forms', () => {
  const en = { n_one: '{{count}} crate', n_other: '{{count}} crates' }
  assert.deepEqual(check({ en, uk: { n_one: 'один ящик', n_few: '{{count}} ящики', n_many: '{{count}} ящиків', n_other: '{{count}} ящика' } }), [])
  assert.equal(check({ en, uk: { n_one: 'один', n_few: 'кілька', n_many: 'багато', n_other: 'інше' } }).length, 1)
})

test('code keys: a missing key is reported with its location; a plural base resolves', () => {
  const p = check({ en: { a: 'A', n_one: 'x', n_other: 'x' }, uk: { a: 'А', n_one: 'x', n_few: 'x', n_many: 'x', n_other: 'x' } }, ['a', 'n', 'typo.key'])
  assert.deepEqual(p, ['a.tsx:1:1  t(\'typo.key\') — en.json has no such key'])
})

test('a missing en.json is refused outright', () => {
  assert.deepEqual(check({ uk: { a: 'А' } }), ['en.json is missing — it is the reference every other locale is compared with'])
})

/** @param {Record<string, string>} files */
function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'locales-'))
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

const LOC = 'frontend/src/shared/lib/i18n/locales'

test('CLI: green, then red when the code calls a key nobody defined', () => {
  const root = fixture({
    [`${LOC}/en.json`]: '{"a":"A"}',
    [`${LOC}/uk.json`]: '{"a":"А"}',
    'frontend/src/x.tsx': "export const X = () => t('a');\n",
  })
  try {
    assert.equal(run(root).status, 0)
    writeFileSync(path.join(root, 'frontend/src/x.tsx'), "export const X = () => t('b');\n")
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /frontend\/src\/x\.tsx:1:\d+ {2}t\('b'\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: no locale files refuses a verdict', () => {
  const root = fixture({ 'frontend/src/x.tsx': "export const X = () => t('a');\n" })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /scanned ZERO locale files/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real repository is green, over an en.json leaf count derived independently here', () => {
  /** @param {unknown} n @returns {number} */
  const count = (n) => (n && typeof n === 'object' ? Object.values(n).reduce((s, v) => s + count(v), 0) : 1)
  const leaves = count(JSON.parse(readFileSync(path.join(REPO, LOC, 'en.json'), 'utf8')))
  const r = run()
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, new RegExp(`en\\.json's ${leaves} keys`))
})
