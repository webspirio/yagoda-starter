/**
 * Unit tests for the parser both i18n rows share. Every positive case has a negative twin
 * in the same source, so a walker that sees nothing cannot pass: "not flagged" is only
 * evidence when something next to it IS flagged.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { flattenLocale, frontendSourceFiles, scanFrontend, scanSource } from './frontend-i18n.mjs'
import { fixtureGitEnv } from '../scan-root.mjs'

/** @param {string} text */
const rules = (text) => scanSource('x.tsx', text).candidates.map((c) => `${c.rule}:${c.text}`)

test('jsx-text: a letter is flagged, a t() call and punctuation beside it are not', () => {
  assert.deepEqual(rules(`const A = () => <p>{t('a.b')} · 5 <b>Close</b></p>`), ['jsx-text:Close'])
})

test('jsx-text: multi-line text is reported once, at its first letter', () => {
  const found = scanSource('x.tsx', `const A = () => (\n  <p>\n    Some   text\n  </p>\n)`).candidates
  assert.deepEqual(
    found.map((c) => ({ line: c.line, col: c.col, text: c.text })),
    [{ line: 3, col: 5, text: 'Some text' }],
  )
})

test('jsx-attr: only the fixed list, in every literal form', () => {
  const src = `const A = () => <>
    <i title="Hello" data-testid="Nope" className="text-lg" />
    <i placeholder={'Type'} alt={\`Pic\`} />
    <i aria-label="close it" todayLabel="Not listed" />
  </>`
  assert.deepEqual(rules(src), ['jsx-attr:Hello', 'jsx-attr:Type', 'jsx-attr:Pic', 'jsx-attr:close it'])
})

test('toast: first argument and options.description, through every callee the file imports', () => {
  const src = `import { toast } from 'sonner'; import { toastSuccess } from '@/shared/ui/toast'
    toast('One'); toast.error('Two'); toastSuccess('Three')
    toast.success(t('k'), { description: 'Four', id: 'not-text' })`
  assert.deepEqual(rules(src), ['toast:One', 'toast:Two', 'toast:Three', 'toast:Four'])
})

test('A7: an alias of sonner toast is a toast; a toast-prefixed helper is not', () => {
  const src = `import { toast as notify } from 'sonner'
    notify('Saved'); toastIdFor('Receipt'); toastQueueLength('Hello there')`
  assert.deepEqual(rules(src), ['toast:Saved'])
})

test('A5: HTML character references are not text; a word beside one still is', () => {
  const src = `const A = () => <><span>&times;</span><td>&nbsp;</td><i>&#8212;</i><b>Close&nbsp;it</b></>`
  assert.deepEqual(rules(src), ['jsx-text:Close&nbsp;it'])
})

test('A8: keys returned by validate and given as rule messages are key uses', () => {
  const src = `register('cash', { required: 'a.req', maxLength: { value: 5, message: 'a.max' },
      validate: (v) => v !== '' || 'a.val' })
    register('x', { validate: { one: (v) => v > 0 || 'a.one', two: (v) => { if (v) return 'a.two'; return true } } })
    setError('amount', { message: 'a.set' })
    register('mode', { required: true })
    other('y', { message: 'not.a.form' })`
  const keys = scanSource('x.tsx', src).keys.map((k) => k.key).sort()
  assert.deepEqual(keys, ['a.max', 'a.one', 'a.req', 'a.set', 'a.two', 'a.val'])
})

test('cyrillic: any string or template part; comments and regex literals are invisible', () => {
  const src = `
    // Сьогодні in a comment
    const re = /\\s*р\\.$/
    const a = 'кг'
    const b = \`\${n} ящиків\`
    const c = 'plain ascii'`
  assert.deepEqual(rules(src), ['cyrillic:кг', 'cyrillic:ящиків'])
})

test('a node matching two rules is reported once, under the first', () => {
  assert.deepEqual(rules(`const A = () => <i aria-label="Попередній день" />`), ['jsx-attr:Попередній день'])
})

test('keys: literal first argument of t() and i18n.t(); dynamic keys are not collected', () => {
  const src = `t('a.b'); i18n.t(\`c.d\`); t(\`e.\${x}\`); t(name); other.t('nope'); tt('nope')`
  assert.deepEqual(scanSource('x.ts', src).keys.map((k) => k.key), ['a.b', 'c.d'])
})

test('literals inside JSX expressions: child, ternary, &&, template — but not conditions or calls', () => {
  const src = `const A = () => <>
    <p>{'Close'}</p>
    <p>{x ? 'Yes' : 'No'}</p>
    <p>{busy && 'Saving'}</p>
    <p>{x === 'warning' ? null : t('k')}</p>
    <i aria-label={x ? 'Open' : 'Shut'} title={\`Step \${n}\`} className={x ? 'a' : 'b'} />
  </>`
  assert.deepEqual(rules(src), [
    'jsx-text:Close', 'jsx-text:Yes', 'jsx-text:No', 'jsx-text:Saving',
    'jsx-attr:Open', 'jsx-attr:Shut', 'jsx-attr:Step ${n}',
  ])
})

test('a Cyrillic template in a UI attribute is reported once', () => {
  assert.deepEqual(rules('const A = () => <i title={`Крок ${n}`} />'), ['jsx-attr:Крок ${n}'])
})

test('scanFrontend: a tracked file deleted but not yet staged is skipped, not a crash', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i18n-lib-'))
  try {
    mkdirSync(path.join(root, 'frontend/src'), { recursive: true })
    writeFileSync(path.join(root, 'frontend/src/a.tsx'), 'export const A = () => <p>Kept</p>;\n')
    writeFileSync(path.join(root, 'frontend/src/b.ts'), 'export const b = 1;\n')
    const env = fixtureGitEnv()
    execFileSync('git', ['init', '-q'], { cwd: root, env })
    execFileSync('git', ['add', '-A'], { cwd: root, env })
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root, env })
    rmSync(path.join(root, 'frontend/src/b.ts'))
    const { files, candidates } = scanFrontend(root)
    assert.deepEqual(files, ['frontend/src/a.tsx'])
    assert.deepEqual(candidates.map((c) => c.text), ['Kept'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('flattenLocale: dotted leaves, and empty objects reported separately', () => {
  const { leaves, emptyObjects } = flattenLocale({ a: { b: 'x', c: {} }, d: '' })
  assert.deepEqual([...leaves.entries()], [['a.b', 'x'], ['d', '']])
  assert.deepEqual(emptyObjects, ['a.c'])
})

test('frontendSourceFiles: ts/tsx under frontend/src, minus tests, test-setup and locales', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'i18n-lib-'))
  try {
    for (const rel of [
      'frontend/src/a.tsx', 'frontend/src/b.ts', 'frontend/src/a.test.tsx', 'frontend/src/test-setup.ts',
      'frontend/src/shared/lib/i18n/locales/en.json', 'frontend/src/shared/lib/i18n/locales/x.ts',
      'frontend/src/c.css', 'backend/src/d.ts',
    ]) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), '')
    }
    execFileSync('git', ['init', '-q'], { cwd: root, env: fixtureGitEnv() })
    assert.deepEqual(frontendSourceFiles(root), ['frontend/src/a.tsx', 'frontend/src/b.ts'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
