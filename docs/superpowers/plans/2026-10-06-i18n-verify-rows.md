# i18n verify rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two fast-tier verify rows. `plain-text` fails on untranslated UI text in
`frontend/src`. `locales` fails on locale key drift, missing plural forms, empty values,
placeholder drift, and `t()` keys that do not exist. Then fix the current findings so both
rows start green.

**Architecture:** One shared module (`scripts/verify/lib/frontend-i18n.mjs`) enumerates the
frontend source with `git ls-files` and parses each file once with
`ts.createSourceFile`. From that AST it returns plain-text candidates and static `t()`
keys. Two check scripts in `scripts/verify/checks/` consume it. Each follows the layer's
conventions: `--root`, `refuseEmptyScan`, `mkdtemp` fixtures, and a registry row with
`proves`/`blindSpot`. Exceptions live in `scripts/verify/baselines/plain-text.json`.

**Tech Stack:** Node 24 ESM (`.mjs`, JSDoc-typed, checked by `tsconfig.scripts.json`),
TypeScript 6 compiler API, `node:test`, React 19 + react-i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-i18n-verify-rows-design.md`

## Global Constraints

- **No new Claude Code hook.** The only wiring is registry rows and npm scripts.
- **Scan scope:** `frontend/src/**/*.{ts,tsx}`, excluding `*.test.ts(x)`, `test-setup.ts(x)`
  and anything under a `locales/` directory.
- **`plain-text` attribute list, fixed:** `placeholder`, `title`, `alt`, `label`,
  `description`, `aria-label`, `aria-description`. No name-suffix heuristics.
- **Letter test:** `\p{L}`. **Cyrillic test:** `[Ѐ-ӿ]`.
- **Exceptions:**
  - `reason` is at least 30 characters once trimmed; `date` matches `^\d{4}-\d{2}-\d{2}$`.
  - An entry that matches nothing fails the row. No inline ignore comments.
- **`locales` reference locale:** `en`. Plural categories come from
  `new Intl.PluralRules(lang).resolvedOptions().pluralCategories`, never a hardcoded list.
- **Registry prose:** `proves`/`blindSpot` are 40–80 words each, with no hand-written number
  other than `0`/`1` and no `YYYY-MM-DD` date (`registry.test.mjs` enforces both).
- **Fixtures:** no test writes the real working tree. Every fixture is a `mkdtempSync`
  directory with `git init`.
- **Frontend tests pin English** (`test-setup.ts` calls `changeLanguage('en')`). A replaced
  Ukrainian literal is asserted by its `en.json` value.

## Review Focus

1. **Multi-line JSX text** (`<p>\n  Some text\n</p>`): it must be reported once, at the line
   and column of the first letter, not of the leading newline. Pinned in Task 1.
2. **One node matching two rules** (`aria-label="Попередній день"` is both `jsx-attr` and
   `cyrillic`): it must be reported once, as `jsx-attr`. A duplicate would also make a
   single text exception look like it matched twice. Pinned in Task 1.
3. **Template literals with substitutions** (`` `${n} кг` ``): the Cyrillic lives in the
   template's head, middle or tail, not in a `StringLiteral`. It must still be caught.
   Pinned in Task 1.
4. **A plural family whose uk `_one` omits `{{count}}`**: a real Ukrainian pattern that must
   stay green, while a family whose union of placeholders differs must go red. Pinned in
   Task 3.
5. **A missing or malformed baseline file**: missing means no exceptions, not a crash. Bad
   JSON must give a readable RED line, not a stack trace. Pinned in Task 2.

---

## File Structure

| Path | Responsibility |
|---|---|
| Create `scripts/verify/lib/frontend-i18n.mjs` | Enumerate the frontend source. Turn one file's text into `{ candidates, keys }`. Flatten a locale object. |
| Create `scripts/verify/lib/frontend-i18n.test.mjs` | Unit tests for `scanSource` and `flattenLocale`. |
| Create `scripts/verify/checks/plain-text.mjs` | Load and validate exceptions, apply them, report, exit. |
| Create `scripts/verify/checks/plain-text.test.mjs` | Exception logic plus CLI fixtures plus one real-repo run. |
| Create `scripts/verify/baselines/plain-text.json` | The two initial exceptions. |
| Create `scripts/verify/checks/locales.mjs` | `checkLocales()` (pure) plus the CLI. |
| Create `scripts/verify/checks/locales.test.mjs` | Every rule red and green, CLI fixtures, one real-repo run. |
| Modify `frontend/src/shared/ui/{spinner,dialog,date-stepper}.tsx`, `templates/document-page.tsx`, `shared/lib/money/format.ts` | Route the literals through `t()` / `Intl`. |
| Modify `frontend/src/shared/lib/i18n/locales/{en,uk}.json` | Add `common.today`, `common.previousDay`, `common.nextDay`, `common.print`. |
| Modify the four frontend tests that pin those literals | Assert the English text. |
| Modify `package.json`, `scripts/verify/registry.mjs`, `scripts/verify/registry.test.mjs` | Wire the two rows. |
| Delete `frontend/src/shared/lib/i18n/locales.test.ts` | Superseded by `locales`. |
| Modify `frontend/src/shared/lib/i18n/index.ts:36`, `frontend/CLAUDE.md` § i18n | Point at the new row. |

---

### Task 1: Shared frontend i18n scanner

**Files:**
- Create: `scripts/verify/lib/frontend-i18n.mjs`
- Test: `scripts/verify/lib/frontend-i18n.test.mjs`

**Interfaces:**
- Produces:
  - `FRONTEND_SRC: 'frontend/src'`
  - `listUnder(root: string, pathspec: string): string[]`: repo-relative, sorted, tracked plus untracked-not-ignored files.
  - `frontendSourceFiles(root: string): string[]`: the scan scope.
  - `normalise(s: string): string`
  - `scanSource(rel: string, text: string): { candidates: Candidate[], keys: KeyUse[] }`
  - `scanFrontend(root: string): { files: string[], candidates: Candidate[], keys: KeyUse[] }`
  - `flattenLocale(node: unknown): { leaves: Map<string, unknown>, emptyObjects: string[] }`
  - `Candidate = { file, line, col, rule: 'jsx-text'|'jsx-attr'|'toast'|'cyrillic', text }`; `text` is normalised.
  - `KeyUse = { file, line, col, key }`

- [ ] **Step 1: Write the failing test**

`scripts/verify/lib/frontend-i18n.test.mjs`:

```js
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

import { flattenLocale, frontendSourceFiles, scanSource } from './frontend-i18n.mjs'
import { fixtureGitEnv } from '../scan-root.mjs'

/** @param {string} text */
const rules = (text) => scanSource('x.tsx', text).candidates.map((c) => `${c.rule}:${c.text}`)

test('jsx-text: a letter is flagged, a t() call and punctuation beside it are not', () => {
  assert.deepEqual(rules(`const A = () => <p>{t('a.b')} · 5 <b>Close</b></p>`), ['jsx-text:Close'])
})

test('jsx-text: multi-line text is reported once, at its first letter', () => {
  const [c] = scanSource('x.tsx', `const A = () => (\n  <p>\n    Some   text\n  </p>\n)`).candidates
  assert.deepEqual({ line: c.line, col: c.col, text: c.text }, { line: 3, col: 5, text: 'Some text' })
})

test('jsx-attr: only the fixed list, in every literal form', () => {
  const src = `const A = () => <>
    <i title="Hello" data-testid="Nope" className="text-lg" />
    <i placeholder={'Type'} alt={\`Pic\`} />
    <i aria-label="close it" todayLabel="Not listed" />
  </>`
  assert.deepEqual(rules(src), ['jsx-attr:Hello', 'jsx-attr:Type', 'jsx-attr:Pic', 'jsx-attr:close it'])
})

test('toast: first argument and options.description, through every callee shape', () => {
  const src = `
    toast('One'); toast.error('Two'); toastSuccess('Three')
    toast.success(t('k'), { description: 'Four', id: 'not-text' })
    notAToast('Five')`
  assert.deepEqual(rules(src), ['toast:One', 'toast:Two', 'toast:Three', 'toast:Four'])
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/verify/lib/frontend-i18n.test.mjs`
Expected: FAIL, `Cannot find module '.../frontend-i18n.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/verify/lib/frontend-i18n.mjs`:

```js
/**
 * What the two i18n rows read from frontend/src, parsed once.
 *
 * `plain-text` asks "does shipped UI code render a literal?" and `locales` asks "does every
 * literal t() key exist?". Both need the same AST over the same file set, and one
 * enumeration means the two rows cannot disagree about what "the frontend" is.
 *
 * Syntax only — `ts.createSourceFile`, never a Program — so neither row is ordered behind
 * `typecheck`: a file that does not type-check still parses.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { gitEnv } from '../scan-root.mjs'

export const FRONTEND_SRC = 'frontend/src'

/** Tests and test setup are not shipped; `locales/` is data, and the `locales` row's input. */
const NOT_SHIPPED_UI = /(\.test\.|(^|\/)test-setup\.tsx?$|\/locales\/)/

/** Attributes a user reads or a screen reader speaks. A fixed list on purpose (spec D9). */
const UI_ATTRIBUTES = new Set(['placeholder', 'title', 'alt', 'label', 'description', 'aria-label', 'aria-description'])

const LETTER = /\p{L}/u
const CYRILLIC = /[Ѐ-ӿ]/

/**
 * @typedef {'jsx-text' | 'jsx-attr' | 'toast' | 'cyrillic'} Rule
 * @typedef {{ file: string, line: number, col: number, rule: Rule, text: string }} Candidate
 * @typedef {{ file: string, line: number, col: number, key: string }} KeyUse
 */

/** @param {string} s */
export const normalise = (s) => s.replace(/\s+/g, ' ').trim()

/**
 * Tracked plus untracked-not-ignored files, so a new file is scanned before its first commit.
 *
 * @param {string} root
 * @param {string} pathspec
 * @returns {string[]} repo-relative, sorted
 */
export function listUnder(root, pathspec) {
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z', '--', pathspec], {
      cwd: root,
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(`git could not enumerate ${pathspec} under ${root}: ${errMessage(err)}`)
  }
  return [...new Set(raw.toString('utf8').split('\0').filter(Boolean))].sort()
}

/** @param {string} root @returns {string[]} */
export function frontendSourceFiles(root) {
  return listUnder(root, FRONTEND_SRC).filter((f) => /\.tsx?$/.test(f) && !NOT_SHIPPED_UI.test(f))
}

/** @param {ts.Node | undefined} node @returns {ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined} */
const literal = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node : undefined

/** `toast(…)`, `toast.x(…)`, `toastSuccess(…)` — the sonner API and its local wrappers. */
const isToastCallee = (/** @type {ts.Expression} */ e) =>
  (ts.isIdentifier(e) && e.text.startsWith('toast')) ||
  (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'toast')

/** `t(…)` or `i18n.t(…)`. */
const isTCallee = (/** @type {ts.Expression} */ e) =>
  (ts.isIdentifier(e) && e.text === 't') ||
  (ts.isPropertyAccessExpression(e) && e.name.text === 't' && ts.isIdentifier(e.expression) && e.expression.text === 'i18n')

/**
 * @param {string} rel repo-relative path, used in the report and to pick TS vs TSX
 * @param {string} text file contents
 * @returns {{ candidates: Candidate[], keys: KeyUse[] }}
 */
export function scanSource(rel, text) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
  /** @type {Candidate[]} */
  const candidates = []
  /** @type {KeyUse[]} */
  const keys = []
  // A node can satisfy two rules (an aria-label in Cyrillic); the walk meets the parent rule
  // first, and this set keeps the literal from being reported again as `cyrillic`.
  const seen = new Set()

  /** @param {number} pos */
  const at = (pos) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos)
    return { line: line + 1, col: character + 1 }
  }
  /** @param {ts.Node} node @param {Rule} rule @param {string} raw @param {number} [pos] */
  const flag = (node, rule, raw, pos = node.getStart(sf)) => {
    if (seen.has(node)) return
    seen.add(node)
    candidates.push({ file: rel, ...at(pos), rule, text: normalise(raw) })
  }
  /** @param {ts.Node | undefined} node @param {Rule} rule */
  const flagLiteral = (node, rule) => {
    const lit = literal(node)
    if (lit && LETTER.test(lit.text)) flag(lit, rule, lit.text)
  }

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isJsxText(node) && LETTER.test(node.text)) {
      // JsxText starts at the whitespace before it; point at the first real character.
      flag(node, 'jsx-text', node.text, node.pos + (node.text.length - node.text.trimStart().length))
    } else if (ts.isJsxAttribute(node) && UI_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer
      flagLiteral(init && ts.isJsxExpression(init) ? init.expression : init, 'jsx-attr')
    } else if (ts.isCallExpression(node)) {
      if (isToastCallee(node.expression)) {
        flagLiteral(node.arguments[0], 'toast')
        const options = node.arguments[1]
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const p of options.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'description') flagLiteral(p.initializer, 'toast')
          }
        }
      } else if (isTCallee(node.expression)) {
        const lit = literal(node.arguments[0])
        if (lit) keys.push({ file: rel, ...at(lit.getStart(sf)), key: lit.text })
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      CYRILLIC.test(node.text)
    ) {
      flag(node, 'cyrillic', node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { candidates, keys }
}

/**
 * @param {string} root
 * @returns {{ files: string[], candidates: Candidate[], keys: KeyUse[] }}
 */
export function scanFrontend(root) {
  const files = frontendSourceFiles(root)
  /** @type {Candidate[]} */
  const candidates = []
  /** @type {KeyUse[]} */
  const keys = []
  for (const rel of files) {
    const found = scanSource(rel, readFileSync(path.join(root, rel), 'utf8'))
    candidates.push(...found.candidates)
    keys.push(...found.keys)
  }
  return { files, candidates, keys }
}

/**
 * Flatten a locale object into dotted leaf paths. An empty object has no leaves, so it
 * would vanish silently; it is returned separately so the caller can refuse it.
 *
 * @param {unknown} node
 * @returns {{ leaves: Map<string, unknown>, emptyObjects: string[] }}
 */
export function flattenLocale(node) {
  /** @type {Map<string, unknown>} */
  const leaves = new Map()
  /** @type {string[]} */
  const emptyObjects = []
  /** @param {unknown} n @param {string} prefix */
  const walk = (n, prefix) => {
    if (n !== null && typeof n === 'object' && !Array.isArray(n)) {
      const entries = Object.entries(n)
      if (entries.length === 0 && prefix) emptyObjects.push(prefix)
      for (const [k, v] of entries) walk(v, prefix ? `${prefix}.${k}` : k)
    } else {
      leaves.set(prefix, n)
    }
  }
  walk(node, '')
  return { leaves, emptyObjects }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/verify/lib/frontend-i18n.test.mjs`
Expected: all tests PASS.

Run: `npx tsc -p tsconfig.scripts.json`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add scripts/verify/lib/frontend-i18n.mjs scripts/verify/lib/frontend-i18n.test.mjs
git commit -m "feat(verify): shared frontend i18n scanner for the plain-text and locales rows"
```

---

### Task 2: `plain-text` check and its baseline

**Files:**
- Create: `scripts/verify/checks/plain-text.mjs`
- Create: `scripts/verify/baselines/plain-text.json`
- Test: `scripts/verify/checks/plain-text.test.mjs`

**Interfaces:**
- Consumes: `scanFrontend`, `normalise`, `Candidate` from Task 1.
- Produces:
  - `BASELINE_REL = 'scripts/verify/baselines/plain-text.json'`
  - `validateExceptions(raw: unknown): { entries: Exception[], problems: string[] }`
  - `applyExceptions(candidates: Candidate[], entries: Exception[]): { findings: Candidate[], stale: Exception[] }`
  - `scan(root?: string): { files, findings, stale, problems }`
  - `Exception = { file: string, text?: string, date: string, reason: string }`
  - CLI: `node scripts/verify/checks/plain-text.mjs [--root <dir>]`

- [ ] **Step 1: Write the failing test**

`scripts/verify/checks/plain-text.test.mjs`:

```js
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
import { fixtureGitEnv } from '../scan-root.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'plain-text.mjs')
const REASON = 'a reason long enough to pass the thirty-character floor'

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
    [{ file: 'a.tsx', date: '2026-10-06', reason: REASON }],
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
      { file: 'gone.tsx', date: '2026-10-06', reason: REASON },
      { file: 'a.tsx', text: 'Fixed already', date: '2026-10-06', reason: REASON },
      { file: 'a.tsx', text: 'Kept', date: '2026-10-06', reason: REASON },
    ],
  )
  assert.deepEqual(stale.map((s) => s.text ?? s.file), ['gone.tsx', 'Fixed already'])
})

test('validateExceptions refuses a short reason, a bad date, a non-array', () => {
  assert.match(validateExceptions({}).problems.join('\n'), /must be a JSON array/)
  const { entries, problems } = validateExceptions([
    { file: 'a.tsx', date: '2026-10-06', reason: 'too short' },
    { file: 'b.tsx', date: '06.10.2026', reason: REASON },
    { file: 'c.tsx', date: '2026-10-06', reason: REASON },
  ])
  assert.equal(problems.length, 2)
  assert.match(problems[0], /a\.tsx.*reason/)
  assert.match(problems[1], /b\.tsx.*date/)
  assert.deepEqual(entries.map((e) => e.file), ['c.tsx'])
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
  const independent = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', 'frontend/src'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.') && !f.includes('/locales/') && !/test-setup\.tsx?$/.test(f))
  const r = run()
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, new RegExp(`across ${independent.length} frontend source file`))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/verify/checks/plain-text.test.mjs`
Expected: FAIL, `Cannot find module '.../plain-text.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/verify/checks/plain-text.mjs`:

```js
#!/usr/bin/env node
/**
 * No untranslated text in shipped UI code. A literal the user reads belongs in a locale file
 * and reaches the screen through t(); anything else renders in one language for everyone.
 *
 * What counts as "text" is lib/frontend-i18n.mjs's four rules. What is excused lives in ONE
 * reviewed file, scripts/verify/baselines/plain-text.json — never an inline comment, which
 * nobody reviews as an exception and an agent writes faster than a t() call. An entry must
 * still match something, so an exception disappears with the finding it excused.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { errMessage } from '../hash.mjs'
import { normalise, scanFrontend } from '../lib/frontend-i18n.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
export const BASELINE_REL = 'scripts/verify/baselines/plain-text.json'

/**
 * @typedef {import('../lib/frontend-i18n.mjs').Candidate} Candidate
 * @typedef {{ file: string, text?: string, date: string, reason: string }} Exception
 */

/**
 * @param {unknown} raw parsed baseline JSON
 * @returns {{ entries: Exception[], problems: string[] }}
 */
export function validateExceptions(raw) {
  if (!Array.isArray(raw)) return { entries: [], problems: [`${BASELINE_REL} must be a JSON array`] }
  /** @type {Exception[]} */
  const entries = []
  /** @type {string[]} */
  const problems = []
  for (const e of raw) {
    const label = `${BASELINE_REL}: ${e?.file ?? '<no file>'}${e?.text ? ` "${e.text}"` : ''}`
    if (typeof e?.file !== 'string' || (e.text !== undefined && typeof e.text !== 'string')) {
      problems.push(`${label}: "file" must be a string, "text" a string when present`)
    } else if (typeof e.reason !== 'string' || e.reason.trim().length < 30) {
      problems.push(`${label}: "reason" is missing or shorter than 30 characters`)
    } else if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      problems.push(`${label}: "date" must be YYYY-MM-DD`)
    } else {
      entries.push(e)
    }
  }
  return { entries, problems }
}

/** @param {Exception} e @param {Candidate} c */
const covers = (e, c) => e.file === c.file && (e.text === undefined || normalise(e.text) === c.text)

/**
 * @param {Candidate[]} candidates
 * @param {Exception[]} entries
 * @returns {{ findings: Candidate[], stale: Exception[] }}
 */
export function applyExceptions(candidates, entries) {
  return {
    findings: candidates.filter((c) => !entries.some((e) => covers(e, c))),
    stale: entries.filter((e) => !candidates.some((c) => covers(e, c))),
  }
}

/** @param {string} root @returns {unknown} */
function readBaseline(root) {
  const abs = path.join(root, BASELINE_REL)
  if (!existsSync(abs)) return []
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    throw new Error(`${BASELINE_REL} is not valid JSON: ${errMessage(err)}`)
  }
}

/** @param {string} [root] */
export function scan(root = ROOT) {
  const { files, candidates } = scanFrontend(root)
  const { entries, problems } = validateExceptions(readBaseline(root))
  return { files, problems, ...applyExceptions(candidates, entries) }
}

function main() {
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`plain-text: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }
  refuseEmptyScan('plain-text', result.files.length, 'frontend source files', ROOT)

  const { files, findings, stale, problems } = result
  if (findings.length || stale.length || problems.length) {
    process.stderr.write('plain-text: RED\n')
    for (const p of problems) process.stderr.write(`  ${p}\n`)
    for (const s of stale) {
      process.stderr.write(`  stale exception — matches nothing, delete it: ${s.file}${s.text ? ` "${s.text}"` : ''}\n`)
    }
    for (const f of findings) process.stderr.write(`  ${f.file}:${f.line}:${f.col}  ${f.rule}  "${f.text}"\n`)
    if (findings.length) {
      process.stderr.write(
        '  Move each text into frontend/src/shared/lib/i18n/locales/{en,uk}.json and render it with t(). ' +
          `Only text no production user reads as a phrase may go in ${BASELINE_REL}, dated and reasoned.\n`,
      )
    }
    process.exit(1)
  }
  process.stdout.write(`plain-text: no untranslated text across ${files.length} frontend source files\n`)
}

if (process.argv[1]?.endsWith('plain-text.mjs')) main()
```

`scripts/verify/baselines/plain-text.json`:

```json
[
  {
    "file": "frontend/src/pages/ui-kit/ui/UiKitPage.tsx",
    "date": "2026-10-06",
    "reason": "Design-system showcase at /ui-kit with deliberate Ukrainian mock data; a visual reference for developers, not a product screen."
  },
  {
    "file": "frontend/src/app/providers/ErrorFallback.tsx",
    "text": "Unhandled error",
    "date": "2026-10-06",
    "reason": "Rendered only inside the import.meta.env.DEV branch next to a raw stack trace; production renders errorFallback.* keys."
  }
]
```

- [ ] **Step 4: Run the tests and check the current findings**

Run: `node --test scripts/verify/checks/plain-text.test.mjs`
Expected: every test PASSES except `the real repository is green…`, which FAILS because
eight findings are not yet fixed (Task 4).

Run: `node scripts/verify/checks/plain-text.mjs`
Expected: `plain-text: RED` listing exactly these eight lines (columns may differ):

```
frontend/src/shared/lib/money/format.ts:46:…  cyrillic  "кг"
frontend/src/shared/ui/date-stepper.tsx:13:…  cyrillic  "Сьогодні"
frontend/src/shared/ui/date-stepper.tsx:26:…  jsx-attr  "Попередній день"
frontend/src/shared/ui/date-stepper.tsx:33:…  jsx-attr  "Наступний день"
frontend/src/shared/ui/dialog.tsx:73:…  jsx-text  "Close"
frontend/src/shared/ui/dialog.tsx:108:…  jsx-text  "Close"
frontend/src/shared/ui/spinner.tsx:13:…  jsx-attr  "loading"
frontend/src/shared/ui/templates/document-page.tsx:56:…  jsx-text  "Друк"
```

No `stale exception` line should appear, because both baseline entries match. If the list
differs, stop and reconcile it before Task 4.

Run: `npx tsc -p tsconfig.scripts.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify/checks/plain-text.mjs scripts/verify/checks/plain-text.test.mjs scripts/verify/baselines/plain-text.json
git commit -m "feat(verify): plain-text check — untranslated UI text in frontend/src"
```

---

### Task 3: `locales` check

**Files:**
- Create: `scripts/verify/checks/locales.mjs`
- Test: `scripts/verify/checks/locales.test.mjs`

**Interfaces:**
- Consumes: `listUnder`, `FRONTEND_SRC`, `scanFrontend`, `flattenLocale`, `KeyUse` from Task 1.
- Produces:
  - `checkLocales(locales: Map<string, unknown>, keyUses: KeyUse[]): string[]`. It is pure, takes `lang → parsed JSON`, and returns sorted problem lines.
  - `scan(root?: string): { files: string[], localeFiles: string[], keyCount: number, leafCount: number, problems: string[] }`
  - CLI: `node scripts/verify/checks/locales.mjs [--root <dir>]`

- [ ] **Step 1: Write the failing test**

`scripts/verify/checks/locales.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/verify/checks/locales.test.mjs`
Expected: FAIL, `Cannot find module '.../locales.mjs'`

- [ ] **Step 3: Write the implementation**

`scripts/verify/checks/locales.mjs`:

```js
#!/usr/bin/env node
/**
 * The locale files agree with each other and with the code that reads them.
 *
 * en.json is the reference. Every other locale beside it must carry the same keys (plural
 * suffixes normalised), every plural category its language needs, no empty value, and the
 * same {{placeholders}}. Every literal key the frontend passes to t() must exist in en.json.
 * A miss on any of these reaches the screen as a raw key, a wrong plural form, or a blank.
 *
 * The plural categories come from Intl.PluralRules, not a list kept here, so a locale added
 * later is checked against its own grammar for free.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { errMessage } from '../hash.mjs'
import { FRONTEND_SRC, flattenLocale, listUnder, scanFrontend } from '../lib/frontend-i18n.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const PLURAL = /_(zero|one|two|few|many|other)$/
const PLACEHOLDER = /\{\{\s*([^,}\s]+)[^}]*\}\}/g

/** @typedef {import('../lib/frontend-i18n.mjs').KeyUse} KeyUse */

/** @param {string} key */
const baseOf = (key) => key.replace(PLURAL, '')

/** @param {Set<string>} s */
const show = (s) => `{${[...s].sort().join(', ')}}`

/**
 * @param {Map<string, unknown>} leaves
 * @returns {Map<string, Set<string>>} base key -> union of placeholder names over its forms
 */
function placeholdersByBase(leaves) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map()
  for (const [key, value] of leaves) {
    const set = out.get(baseOf(key)) ?? new Set()
    if (typeof value === 'string') for (const m of value.matchAll(PLACEHOLDER)) set.add(m[1])
    out.set(baseOf(key), set)
  }
  return out
}

/**
 * @param {Map<string, unknown>} locales lang -> parsed JSON
 * @param {KeyUse[]} keyUses
 * @returns {string[]} sorted problem lines; empty means green
 */
export function checkLocales(locales, keyUses) {
  const enRaw = locales.get('en')
  if (enRaw === undefined) return ['en.json is missing — it is the reference every other locale is compared with']

  /** @type {string[]} */
  const problems = []
  const flat = new Map([...locales].map(([lang, raw]) => [lang, flattenLocale(raw)]))
  const en = /** @type {ReturnType<typeof flattenLocale>} */ (flat.get('en'))
  const enBases = new Set([...en.leaves.keys()].map(baseOf))
  const enPlaceholders = placeholdersByBase(en.leaves)
  const pluralFamilies = new Set(
    [...flat.values()].flatMap(({ leaves }) => [...leaves.keys()].filter((k) => PLURAL.test(k)).map(baseOf)),
  )

  for (const [lang, { leaves, emptyObjects }] of flat) {
    const file = `${lang}.json`
    for (const k of emptyObjects) problems.push(`${file}: "${k}" is an empty object`)
    for (const [k, v] of leaves) {
      if (typeof v !== 'string') problems.push(`${file}: "${k}" is not a string`)
      else if (v.trim() === '') problems.push(`${file}: "${k}" is empty`)
    }

    const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
    for (const family of pluralFamilies) {
      for (const cat of categories) {
        if (!leaves.has(`${family}_${cat}`)) problems.push(`${file}: plural family "${family}" is missing "${family}_${cat}"`)
      }
    }

    if (lang === 'en') continue
    const bases = new Set([...leaves.keys()].map(baseOf))
    for (const b of enBases) if (!bases.has(b)) problems.push(`${file} is missing "${b}"`)
    for (const b of bases) if (!enBases.has(b)) problems.push(`${file} has "${b}", which en.json does not`)

    for (const [b, names] of placeholdersByBase(leaves)) {
      const ref = enPlaceholders.get(b)
      if (ref && show(ref) !== show(names)) problems.push(`${file}: "${b}" uses placeholders ${show(names)}, en.json uses ${show(ref)}`)
    }
  }

  for (const u of keyUses) {
    if (!en.leaves.has(u.key) && !(pluralFamilies.has(u.key) && enBases.has(u.key))) {
      problems.push(`${u.file}:${u.line}:${u.col}  t('${u.key}') — en.json has no such key`)
    }
  }
  return problems.sort()
}

/** @param {string} [root] */
export function scan(root = ROOT) {
  const localeFiles = listUnder(root, FRONTEND_SRC).filter((f) => /\/locales\/[^/]+\.json$/.test(f))
  const dirs = new Set(localeFiles.map((f) => path.dirname(f)))
  if (dirs.size > 1) throw new Error(`locale files live in more than one directory: ${[...dirs].join(', ')}`)

  /** @type {Map<string, unknown>} */
  const locales = new Map()
  for (const f of localeFiles) {
    try {
      locales.set(path.basename(f, '.json'), JSON.parse(readFileSync(path.join(root, f), 'utf8')))
    } catch (err) {
      throw new Error(`${f} is not valid JSON: ${errMessage(err)}`)
    }
  }
  const { files, keys } = scanFrontend(root)
  const leafCount = locales.has('en') ? flattenLocale(locales.get('en')).leaves.size : 0
  return { files, localeFiles, keyCount: keys.length, leafCount, problems: localeFiles.length ? checkLocales(locales, keys) : [] }
}

function main() {
  let result
  try {
    result = scan()
  } catch (err) {
    process.stderr.write(`locales: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }
  refuseEmptyScan('locales', result.localeFiles.length, 'locale files', ROOT)
  refuseEmptyScan('locales', result.files.length, 'frontend source files', ROOT)

  if (result.problems.length) {
    process.stderr.write('locales: RED\n')
    for (const p of result.problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `locales: ${result.localeFiles.map((f) => path.basename(f)).join(', ')} agree on en.json's ${result.leafCount} keys, ` +
      `and all ${result.keyCount} literal t() keys in ${result.files.length} frontend source files exist\n`,
  )
}

if (process.argv[1]?.endsWith('locales.mjs')) main()
```

- [ ] **Step 4: Run tests, then the check against the real tree**

Run: `node --test scripts/verify/checks/locales.test.mjs`
Expected: all tests PASS. The real-repo test passes too, because the 2026-10-06 probe found
no missing keys and no placeholder drift.

Run: `node scripts/verify/checks/locales.mjs`
Expected: `locales: en.json, uk.json agree on en.json's … keys, and all … literal t() keys in … frontend source files exist`, exit 0.

Run: `npx tsc -p tsconfig.scripts.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify/checks/locales.mjs scripts/verify/checks/locales.test.mjs
git commit -m "feat(verify): locales check — parity, plurals, empty values, placeholders, code keys"
```

---

### Task 4: Fix the eight plain-text findings

**Files:**
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`, `uk.json` (the `common` block)
- Modify: `frontend/src/shared/ui/spinner.tsx`, `dialog.tsx`, `date-stepper.tsx`, `templates/document-page.tsx`
- Modify: `frontend/src/shared/lib/money/format.ts`
- Test: `frontend/src/shared/ui/date-stepper.test.tsx`, `templates/document-page.test.tsx`, `frontend/src/pages/day/ui/DayPage.test.tsx:909`, `frontend/src/pages/supplier-card/ui/SupplierCardPage.test.tsx:676`, `frontend/src/shared/lib/money/format.test.ts`

**Interfaces:**
- Consumes: `node scripts/verify/checks/plain-text.mjs` from Task 2, used as the acceptance check.
- Produces: the locale keys `common.today`, `common.previousDay`, `common.nextDay` and `common.print`. `DateStepper`'s `todayLabel` stays optional, and its default becomes `t('common.today')`.

- [ ] **Step 1: Point the tests at the English text (failing first)**

`date-stepper.test.tsx`: replace every `'Попередній день'` with `'Previous day'`, every
`'Наступний день'` with `'Next day'`, and every `'Сьогодні'` with `'Today'`.

`templates/document-page.test.tsx`, lines 19 and 27:

```tsx
it('малює кнопку «Print» і клік по ній кличе onPrint рівно раз', async () => {
```
```tsx
  const button = screen.getByRole('button', { name: /Print/ });
```

`DayPage.test.tsx:909`:

```tsx
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
```

`SupplierCardPage.test.tsx:676`:

```tsx
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeInTheDocument();
```

`format.test.ts`: add one line next to the existing `formatKg('40.60', 'uk')` assertion:

```ts
    expect(formatKg('40.60', 'en')).toBe('40.60 kg');
```

Run: `npm test -w frontend -- --run src/shared/ui/date-stepper.test.tsx src/shared/ui/templates/document-page.test.tsx src/pages/day/ui/DayPage.test.tsx src/pages/supplier-card/ui/SupplierCardPage.test.tsx src/shared/lib/money/format.test.ts`
Expected: FAIL in the first four files (no element with the English name). `format.test.ts`
PASSES, because the current `formatKg` already returns `kg` for `en`. That makes it the
regression guard for the `Intl` switch.

- [ ] **Step 2: Add the locale keys**

In `en.json`, add to the `common` object after `"hidePassword"`:

```json
    "today": "Today",
    "previousDay": "Previous day",
    "nextDay": "Next day",
    "print": "Print"
```

In `uk.json`, add to the `common` object after `"hidePassword"`:

```json
    "today": "Сьогодні",
    "previousDay": "Попередній день",
    "nextDay": "Наступний день",
    "print": "Друк"
```

- [ ] **Step 3: Route the literals through `t()`**

`spinner.tsx`:

```tsx
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 24, className }: SpinnerProps) {
  const { t } = useTranslation();
  return (
    <Loader2
      role="progressbar"
      aria-label={t('common.loading')}
      size={size}
      className={cn('animate-spin text-brand', className)}
    />
  );
}
```

`dialog.tsx`: add `import { useTranslation } from 'react-i18next';` to the imports. In
`DialogContent`, add `const { t } = useTranslation();` as the first line of the body and
replace `<span className="sr-only">Close</span>` with
`<span className="sr-only">{t('common.close')}</span>`. In `DialogFooter`, add
`const { t } = useTranslation();` as the first line of the body and replace
`<Button variant="outline">Close</Button>` with
`<Button variant="outline">{t('common.close')}</Button>`.

`date-stepper.tsx`:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from './button';

/** Domain-free ‹ date › cluster: takes a pre-formatted label + callbacks; the
 *  page owns all date math. */
export function DateStepper({
  label,
  onPrev,
  onNext,
  onToday,
  canNext = true,
  todayLabel,
  className,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday?: () => void;
  canNext?: boolean;
  todayLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button variant="ghost" size="icon" aria-label={t('common.previousDay')} onClick={onPrev}>
        <ChevronLeft />
      </Button>
      <span className="min-w-[7ch] text-center font-mono text-sm tabular-nums">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('common.nextDay')}
        onClick={onNext}
        disabled={!canNext}
      >
        <ChevronRight />
      </Button>
      {onToday ? (
        <Button variant="outline" size="sm" onClick={onToday}>
          {todayLabel ?? t('common.today')}
        </Button>
      ) : null}
    </div>
  );
}
```

`templates/document-page.tsx`: add `import { useTranslation } from 'react-i18next';` and
`const { t } = useTranslation();` as the first line of the `DocumentPage` body. Replace the
`Друк` text node with `{t('common.print')}`.

- [ ] **Step 4: `formatKg` takes its unit from `Intl`**

`format.ts`: replace the `formatKg` export with:

```ts
/** Same caching reason as `separatorCache`: the unit depends only on `locale`. */
const kgUnitCache = new Map<string, string>();

function kgUnitFor(locale: string): string {
  let unit = kgUnitCache.get(locale);
  if (unit === undefined) {
    unit =
      new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilogram' })
        .formatToParts(1)
        .find((p) => p.type === 'unit')?.value ?? 'kg';
    kgUnitCache.set(locale, unit);
  }
  return unit;
}

export const formatKg = (value: string, locale = 'uk'): string =>
  `${formatDecimal(value, locale)} ${kgUnitFor(locale)}`;
```

- [ ] **Step 5: Run the tests, the frontend type check, and the check**

Run: `npm test -w frontend -- --run src/shared/ui/date-stepper.test.tsx src/shared/ui/templates/document-page.test.tsx src/pages/day/ui/DayPage.test.tsx src/pages/supplier-card/ui/SupplierCardPage.test.tsx src/shared/lib/money/format.test.ts`
Expected: all PASS.

Run: `npm run typecheck -w frontend`
Expected: exit 0. Vitest does not type-check; this step does.

Run: `node scripts/verify/checks/plain-text.mjs`
Expected: `plain-text: no untranslated text across … frontend source files`, exit 0.

Run: `node --test scripts/verify/checks/plain-text.test.mjs scripts/verify/checks/locales.test.mjs`
Expected: all PASS, including both real-repo tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "fix(i18n): translate the last hardcoded UI strings (dialog, spinner, date stepper, print, kg)"
```

---

### Task 5: Wire both rows into verify and retire `locales.test.ts`

**Files:**
- Modify: `package.json` (`scripts`)
- Modify: `scripts/verify/registry.mjs` (two rows after `compose`)
- Modify: `scripts/verify/registry.test.mjs` (`COLD_MS`)
- Delete: `frontend/src/shared/lib/i18n/locales.test.ts`
- Modify: `frontend/src/shared/lib/i18n/index.ts:36`, `frontend/CLAUDE.md` § i18n

**Interfaces:**
- Consumes: both CLIs from Tasks 2 and 3.
- Produces: rows `plain-text` and `locales`, both in the fast tier, with no `after`.

- [ ] **Step 1: npm scripts**

In the root `package.json`, add after `"compose:check"`:

```json
    "i18n:plain-text": "node scripts/verify/checks/plain-text.mjs",
    "i18n:locales": "node scripts/verify/checks/locales.mjs",
```

- [ ] **Step 2: Registry rows**

In `scripts/verify/registry.mjs`, insert after the `compose` row's closing `},`:

```js
  {
    id: 'plain-text',
    tier: 'fast',
    // No `after`, for the reason on `migrations`: syntax-only parse, so a type error neither
    // hides nor fakes a finding here.
    cmd: 'npm run i18n:plain-text',
    proves:
      'Every tracked .ts and .tsx file under frontend/src, tests and locale data aside, is ' +
      'parsed with the TypeScript compiler API, and this command fails when one renders ' +
      'untranslated text: a JSX text node with a letter, a letter-bearing literal in a ' +
      'placeholder, title, alt, label, description or aria attribute, a literal passed to a ' +
      'toast call, or any literal containing Cyrillic. Every exception in its baseline is ' +
      'dated, reasoned and must still match.',
    blindSpot:
      'A Latin-only literal outside JSX text, those attributes and toast calls is invisible: ' +
      'a column header in an object literal, or a string a helper returns. Text assembled at ' +
      'runtime, text the backend sends, and a prop whose name is not on the fixed list go ' +
      'unseen. It proves text reaches the screen through a key, never that the translation ' +
      'behind the key is right.',
  },
  {
    id: 'locales',
    tier: 'fast',
    cmd: 'npm run i18n:locales',
    proves:
      'Every locales JSON file under frontend/src is compared with en.json beside it, and this ' +
      'command fails on a key present on one side only once plural suffixes are normalised, a ' +
      'plural family missing a category Intl.PluralRules requires for that language, an ' +
      'empty, blank or non-string value or an empty object, differing placeholder names, or a ' +
      'literal key passed to t() or i18n.t() in frontend source that en.json lacks.',
    blindSpot:
      'A key built from a template or a variable is never checked, so a typo inside a ' +
      'template key still reaches the screen raw. Unused keys are not reported. Nothing judges ' +
      'the text itself: a Ukrainian value copied verbatim from English, a misused plural form, ' +
      'or a placeholder in the wrong place all pass. Locale files outside frontend/src lie ' +
      'outside its scope.',
  },
```

- [ ] **Step 3: Run the registry tests, expecting the `COLD_MS` failure**

Run: `node --test scripts/verify/registry.test.mjs`
Expected: exactly one FAIL, `a row started or stopped inheriting the runner default — measure it cold on CI and record it here`.
If a word-count or measurement test fails instead, fix the prose (never the test) and re-run.

- [ ] **Step 4: Measure and record both rows**

Run each command ten times and take the slowest `real`. Use the same method as `compose`.

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do ( time npm run -s i18n:plain-text >/dev/null ) 2>&1 | grep real; done
for i in 1 2 3 4 5 6 7 8 9 10; do ( time npm run -s i18n:locales >/dev/null ) 2>&1 | grep real; done
```

In `registry.test.mjs`'s `COLD_MS`, after the `compose: …` entry, add the two readings in
milliseconds with a comment in the existing style:

```js
    // `plain-text` and `locales`: bash `time`, slowest of ten on the laptop, same method as
    // `compose`. Replace with cold CI readings after their first CI run.
    'plain-text': <slowest plain-text ms>,
    locales: <slowest locales ms>,
```

(The two values are measurements taken in this step. They cannot be known in advance, and
the test demands that they be measured, not guessed.)

Run: `node --test scripts/verify/registry.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Retire `locales.test.ts` and update the two pointers**

```bash
git rm frontend/src/shared/lib/i18n/locales.test.ts
```

`frontend/src/shared/lib/i18n/index.ts`, line 36: replace
`English is still the fallback, but locales.test.ts keeps the key sets` with
`English is still the fallback, but the \`locales\` verify row keeps the key sets`, and
re-wrap the comment if the line grows past the file's width.

`frontend/CLAUDE.md` § i18n, after the first paragraph (which ends with
`with the resolved language automatically.`), add:

```markdown
No user-visible literal outside the locale files: the `plain-text` verify row fails on JSX
text, UI attributes, toast messages and any Cyrillic literal in `src/`. The only exceptions
are the dated, reasoned entries in `scripts/verify/baselines/plain-text.json`, and an entry
that stops matching fails the row too. The `locales` row keeps `en.json` and `uk.json` in
step: keys, plural forms, empty values, `{{placeholders}}`, and every literal `t('…')` key.
```

- [ ] **Step 6: Run the fast tier**

Run: `npm run verify`
Expected: the verdict line shows every row PASSED, including `plain-text` and `locales`.
Rows that SKIPPED are named out loud in the report.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/verify/registry.mjs scripts/verify/registry.test.mjs frontend/src/shared/lib/i18n/index.ts frontend/CLAUDE.md
git commit -m "feat(verify): plain-text and locales rows in the fast tier; retire locales.test.ts"
```

- [ ] **Step 8: Full tier before the PR**

Run: `npm run verify:full`
Expected: green. `bundle` sees the new locale strings and `selfcheck` runs the new
`*.test.mjs` suites. Paste the verdict line and name every SKIPPED row.
