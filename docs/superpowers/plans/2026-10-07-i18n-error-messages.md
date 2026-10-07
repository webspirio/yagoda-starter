# i18n error messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #52 inside PR #217:
- `plain-text` and `locales` refuse any verdict they did not earn;
- no server-provided string reaches the screen;
- every reachable backend `code` has its own message;
- error copy states what happened and what to do;
- a new `error-codes` verify row keeps the backend and frontend codes in step.

**Architecture:** Most of the verify-layer work is in the shared AST scanner
`scripts/verify/lib/frontend-i18n.mjs` and its two rows. A third row, `error-codes`, uses the
same frontend enumeration and adds a syntax-only scan of `backend/src`. In the frontend, one
new function in `shared/lib/api-error`, `statusKey`, gives every banner and mapper a
translated sentence for network, 429, 403 and 5xx failures. The suffix-matching mappers move
to exact code tables.

**Tech Stack:** Node `node:test` + TypeScript compiler API (verify layer), React 19 +
react-i18next + react-hook-form + Vitest (frontend), NestJS (backend: docs only).

**Spec:** `docs/superpowers/specs/2026-10-07-i18n-error-messages-design.md`

## Global Constraints

- **Branch.** Work on `feat/52-i18n-for-all-error-and-message-strings`, in place, with no
  worktree.
- **Before every commit, run `npm run verify`** and paste its verdict line in the task
  report. Verification rule 2 applies: name every skipped row.
- **Verify-layer rules** (`.claude/skills/verify/SKILL.md`, «Rules for adding or editing a
  row»):
  - No test writes the real tree; fixtures use `mkdtempSync` + `fixtureGitEnv()`.
  - At most one real-repo test per check, and it carries a discriminator.
  - `refuseEmptyScan` on every enumeration.
  - Each `proves` / `blindSpot` is 40–80 words, with no digits except identifiers.
  - A reason is checked for non-emptiness, never for length.
- **Locales.** Every key is added to BOTH `frontend/src/shared/lib/i18n/locales/uk.json` and
  `en.json`. `uk` is the default language. Frontend tests pin English (`test-setup` forces
  `en`), so assertions on rendered copy use the `en` value.
- **Tone rule** (spec Part C), for every new or rewritten error value:
  - at most two short sentences;
  - the first says what happened, in the user's terms; the second says what to do;
  - no codes, no English terms in `uk`, no bare «Помилка».
- **No `error.message`, `ApiError.details` or `String(err)` is ever rendered.**
- **`git checkout --` is forbidden on uncommitted work.**
- **Typecheck after frontend edits.** Vitest does not typecheck, so run
  `npm run typecheck -w frontend` after any frontend edit.

## Review Focus

1. **A language switch while a server error is on screen.** The message must re-render in
   the new language. A `setError` given a pre-translated string freezes it. Pinned in
   Task 8.
2. **A 403 that carries a known code, such as `OWNER_ONLY` or `SELF_LOCKOUT`.** It must keep
   its specific sentence and not fall to `errors.accessChanged`. Pinned in Task 5 (precedence
   test) and Task 7 (`SELF_LOCKOUT`).
3. **A login attempt with the backend down or throttled.** The user must see Ukrainian
   advice, never `Request failed with status 0` or `ThrottlerException`. Pinned in Task 6.
4. **A file-wide plain-text exception after a developer adds one more string to
   `UiKitPage.tsx`.** The row must go RED. Pinned in Task 2.
5. **The `locales` row run on a host whose default locale is not English, against a locale
   file named `ua.json`.** The row must refuse rather than borrow the host's grammar. Pinned
   in Task 1 (the `xx` and `ua` cases).

---

### Task 1: `locales` refuses unearned verdicts (A1, A2, A3, A6)

**Files:**
- Modify: `scripts/verify/checks/locales.mjs`
- Modify: `scripts/verify/checks/locales.test.mjs`
- Modify: `scripts/verify/registry.mjs` (row `locales`: `proves` / `blindSpot`)

**Interfaces:**
- Produces: `checkLocales(locales: Map<string, unknown>, keyUses: KeyUse[], supported: string[]): string[]`.
  The third parameter is new and required.
- Produces: `export function pluralFamilies(locales: Map<string, unknown>): Set<string>`.
- Produces: `export function supportedLanguages(root: string): string[]`. It reads
  `SUPPORTED_LANGUAGES` from `frontend/src/shared/lib/i18n/language-preference.ts` by AST and
  throws if the declaration is missing or empty.

- [ ] **Step 1: Update the test helper and write the failing tests**

In `locales.test.mjs`, change the helper so that every existing test passes the real
language set:

```js
/** @param {Record<string, unknown>} byLang @param {string[]} [keys] @param {string[]} [supported] */
const check = (byLang, keys = [], supported = ['uk', 'en']) =>
  checkLocales(new Map(Object.entries(byLang)), keys.map((key) => ({ file: 'a.tsx', line: 1, col: 1, key })), supported)
```

Add these tests (import `pluralFamilies` and `supportedLanguages` as well):

```js
test('A1: a supported language with no file is RED — a lone en.json cannot be green', () => {
  assert.deepEqual(check({ en: { a: 'A' } }), ['uk.json is missing — SUPPORTED_LANGUAGES lists "uk"'])
})

test('A1: a locale file the app never loads is RED', () => {
  const p = check({ en: { a: 'A' }, uk: { a: 'А' }, de: { a: 'A' } })
  assert.ok(p.includes('de.json is not in SUPPORTED_LANGUAGES — the app never loads it'), p.join('\n'))
})

test('A3: a language Intl does not know is refused, never checked against the host grammar', () => {
  const pl = { n_one: 'a', n_other: 'b' }
  for (const lang of ['xx', 'ua']) {
    const p = check({ en: pl, [lang]: pl }, [], ['en', lang])
    assert.ok(p.some((l) => l.startsWith(`${lang}.json: Intl has no plural rules for "${lang}"`)), `${lang}: ${p.join('\n')}`)
  }
  // twin: a real language with the same data is judged on its own grammar
  assert.equal(check({ en: pl, uk: pl }).length, 2)
})

test('A6: the unescaped {{- name}} form is compared like {{name}}', () => {
  const p = check({ en: { a: 'Hi {{- name}}' }, uk: { a: 'Привіт {{- user}}' } })
  assert.deepEqual(p, ['uk.json: "a" uses placeholders {user}, en.json uses {name}'])
  assert.deepEqual(check({ en: { a: 'Hi {{- name}}' }, uk: { a: 'Привіт {{- name}}' } }), [])
})

test('A2: pluralFamilies sees a family in any locale, and none when there is none', () => {
  assert.deepEqual([...pluralFamilies(new Map([['en', { n_one: 'a', n_other: 'b' }], ['uk', {}]]))], ['n'])
  assert.equal(pluralFamilies(new Map([['en', { a: 'x' }], ['uk', { a: 'х' }]])).size, 0)
})

test('supportedLanguages reads the array the app ships, and refuses a missing one', () => {
  const root = fixture({ 'frontend/src/shared/lib/i18n/language-preference.ts': "export const SUPPORTED_LANGUAGES = ['uk', 'en'] as const;\n" })
  try {
    assert.deepEqual(supportedLanguages(root), ['uk', 'en'])
    writeFileSync(path.join(root, 'frontend/src/shared/lib/i18n/language-preference.ts'), 'export const X = 1;\n')
    assert.throws(() => supportedLanguages(root), /SUPPORTED_LANGUAGES/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI A2: locales with no plural family refuse a verdict', () => {
  const root = fixture({
    [`${LOC}/en.json`]: '{"a":"A"}',
    [`${LOC}/uk.json`]: '{"a":"А"}',
    'frontend/src/shared/lib/i18n/language-preference.ts': "export const SUPPORTED_LANGUAGES = ['uk', 'en'] as const;\n",
    'frontend/src/x.tsx': "export const X = () => t('a');\n",
  })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /scanned ZERO plural families/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

The test file declares `fixture` below these tests. Move these tests below `fixture` and
`run`, or hoist both helpers to the top. Function declarations hoist, so the first option
already works.

The existing CLI test «green, then red when the code calls a key nobody defined» now needs a
plural family and a `language-preference.ts`. Change its fixture to:

```js
    [`${LOC}/en.json`]: '{"a":"A","n_one":"x","n_other":"x"}',
    [`${LOC}/uk.json`]: '{"a":"А","n_one":"x","n_few":"x","n_many":"x","n_other":"x"}',
    'frontend/src/shared/lib/i18n/language-preference.ts': "export const SUPPORTED_LANGUAGES = ['uk', 'en'] as const;\n",
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test scripts/verify/checks/locales.test.mjs`
Expected: FAIL. `pluralFamilies` / `supportedLanguages` are not exported, and the A1/A3/A6
assertions fail.

- [ ] **Step 3: Implement**

In `locales.mjs`:

```js
import ts from 'typescript'
// …
const PLACEHOLDER = /\{\{-?\s*([^,}\s]+)[^}]*\}\}/g
const LANGUAGE_PREFERENCE = 'frontend/src/shared/lib/i18n/language-preference.ts'

/** The languages the app loads — read from the app, never kept here as a second copy. @param {string} root */
export function supportedLanguages(root) {
  const rel = LANGUAGE_PREFERENCE
  let text
  try {
    text = readFileSync(path.join(root, rel), 'utf8')
  } catch (err) {
    throw new Error(`cannot read ${rel}: ${errMessage(err)}`)
  }
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  /** @type {string[]} */
  let langs = []
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'SUPPORTED_LANGUAGES' && n.initializer) {
      let init = n.initializer
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
      if (ts.isArrayLiteralExpression(init)) {
        langs = init.elements.filter(ts.isStringLiteral).map((e) => e.text)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!langs.length) throw new Error(`${rel} declares no SUPPORTED_LANGUAGES string array`)
  return langs
}

/** Base keys carrying a plural suffix in any locale. @param {Map<string, unknown>} locales */
export function pluralFamilies(locales) {
  return new Set(
    [...locales.values()].flatMap((raw) => [...flattenLocale(raw).leaves.keys()].filter((k) => PLURAL.test(k)).map(baseOf)),
  )
}
```

Changes in `checkLocales(locales, keyUses, supported)`:
- after the `en` guard, push the A1 problems:

  ```js
  for (const lang of supported) if (!locales.has(lang)) problems.push(`${lang}.json is missing — SUPPORTED_LANGUAGES lists "${lang}"`)
  for (const lang of locales.keys()) if (!supported.includes(lang)) problems.push(`${lang}.json is not in SUPPORTED_LANGUAGES — the app never loads it`)
  ```

  (move `const problems = []` above them);
- replace the inline `pluralFamilies` computation with `const families = pluralFamilies(locales)`,
  and use `families` in the two places that read it;
- replace the categories line with the A3 guard:

  ```js
  const rules = new Intl.PluralRules(lang)
  const resolved = rules.resolvedOptions().locale
  const known = Intl.PluralRules.supportedLocalesOf([lang]).length > 0 && resolved.split('-')[0] === lang.split('-')[0]
  if (!known) {
    problems.push(`${file}: Intl has no plural rules for "${lang}" — it would borrow the host's (${resolved})`)
  } else {
    for (const family of families) {
      for (const cat of rules.resolvedOptions().pluralCategories) {
        if (!leaves.has(`${family}_${cat}`)) problems.push(`${file}: plural family "${family}" is missing "${family}_${cat}"`)
      }
    }
  }
  ```

Changes in `scan(root)`:
- read the language set only when locale files exist, so a tree with none still reaches
  the existing «scanned ZERO locale files» refusal:
  `problems: localeFiles.length ? checkLocales(locales, keys, supportedLanguages(root)) : []`.
  `supportedLanguages` throws, and `main` already turns a throw into a readable RED;
- return `pluralFamilyCount: pluralFamilies(locales).size`.

In `main()`, after the two existing `refuseEmptyScan` calls:

```js
  refuseEmptyScan('locales', result.pluralFamilyCount, 'plural families', ROOT)
```

Update the file's header comment. Add one sentence: the language set comes from
`SUPPORTED_LANGUAGES`, and a locale name `Intl` does not know is refused rather than checked
against the host's default grammar.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test scripts/verify/checks/locales.test.mjs && npm run i18n:locales`
Expected: PASS. The CLI prints `locales: en.json, uk.json agree on en.json's … keys …`.

- [ ] **Step 5: Update the `locales` row text in `scripts/verify/registry.mjs`**

Each field must be 40–80 words with no digits.

```js
    proves:
      'Every locales JSON file under frontend/src is compared with en.json, and this command ' +
      'fails when a language in SUPPORTED_LANGUAGES has no file or a file is not listed there, ' +
      'Intl knows no plural rules for a locale, a key is one-sided, a plural category is ' +
      'missing, a value is empty, blank or non-string, placeholder names differ, or a literal ' +
      'key passed to t() or i18n.t() in frontend source is absent from en.json.',
```

Keep the existing `blindSpot`. Task 3 extends both fields once form-rule keys are
collected. Do not claim that coverage here, before it exists.

- [ ] **Step 6: Run the registry tests and the fast tier**

Run: `node --test scripts/verify/registry.test.mjs && npm run verify`
Expected: PASS. Quote the verify verdict line.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify/checks/locales.mjs scripts/verify/checks/locales.test.mjs scripts/verify/registry.mjs
git commit -m "fix(verify): locales refuses a missing or unknown locale and an empty plural check"
```

---

### Task 2: `plain-text` file-wide exceptions carry a count (A4, reason floor)

**Files:**
- Modify: `scripts/verify/checks/plain-text.mjs`
- Modify: `scripts/verify/checks/plain-text.test.mjs`
- Modify: `scripts/verify/baselines/plain-text.json`
- Modify: `scripts/verify/registry.mjs` (row `plain-text`: `proves`)

**Interfaces:**
- Produces: `applyExceptions(candidates, entries): { findings: Candidate[], stale: Exception[], drift: string[] }`.
- Produces: `Exception = { file: string, text?: string, count?: number, date: string, reason: string }`.

- [ ] **Step 1: Write the failing tests**

In `plain-text.test.mjs`:
- set `const REASON = 'design showcase, not a product screen'`;
- give the existing file-wide entries `count`: 2 in «a file exception excuses…», 1 for
  `gone.tsx` in the stale test;
- replace the `validateExceptions` test and add the drift tests:

```js
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test scripts/verify/checks/plain-text.test.mjs`
Expected: FAIL. `drift` is undefined, and the validation problems differ.

- [ ] **Step 3: Implement in `plain-text.mjs`**

```js
 * @typedef {{ file: string, text?: string, count?: number, date: string, reason: string }} Exception
```

The `validateExceptions` loop body:

```js
    const label = `${BASELINE_REL}: ${e?.file ?? '<no file>'}${e?.text ? ` "${e.text}"` : ''}`
    const fileWide = e?.text === undefined
    if (typeof e?.file !== 'string' || (!fileWide && typeof e.text !== 'string')) {
      problems.push(`${label}: "file" must be a string, "text" a string when present`)
    } else if (fileWide ? !(Number.isInteger(e.count) && e.count > 0) : e.count !== undefined) {
      problems.push(`${label}: "count" must be a positive integer on a file-wide entry, and absent on a text entry`)
    } else if (typeof e.reason !== 'string' || e.reason.trim() === '') {
      problems.push(`${label}: "reason" is missing or empty`)
    } else if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      problems.push(`${label}: "date" must be YYYY-MM-DD`)
    } else {
      entries.push(e)
    }
```

`applyExceptions`:

```js
export function applyExceptions(candidates, entries) {
  /** @type {string[]} */
  const drift = []
  for (const e of entries) {
    if (e.text !== undefined) continue
    const n = candidates.filter((c) => c.file === e.file).length
    if (n === 0 || n === e.count) continue
    drift.push(
      n > /** @type {number} */ (e.count)
        ? `${e.file}: ${n} candidates, the exception accepts ${e.count} — translate the new text, or raise count in a reviewed change`
        : `${e.file}: ${n} candidates, the exception accepts ${e.count} — lower count to ${n}`,
    )
  }
  return {
    findings: candidates.filter((c) => !entries.some((e) => covers(e, c))),
    stale: entries.filter((e) => !candidates.some((c) => covers(e, c))),
    drift,
  }
}
```

In `main()`:
- destructure `drift`;
- add `|| drift.length` to the RED condition;
- write `for (const d of drift) process.stderr.write(`  ${d}\n`)` after the stale lines.

Update the header comment: a file-wide entry states how many candidates it accepts, so new
text in an excused file is still RED.

- [ ] **Step 4: Set the real count in the baseline**

Run: `npm run i18n:plain-text 2>&1 | head -5`. It is RED now, because the `UiKitPage` entry
has no `count`. Get the number of candidates in that file from a scan that ignores the
baseline:

```bash
node -e "import('./scripts/verify/lib/frontend-i18n.mjs').then(m=>{const r=m.scanFrontend(process.cwd());console.log(r.candidates.filter(c=>c.file==='frontend/src/pages/ui-kit/ui/UiKitPage.tsx').length)})"
```

Add `"count": <that number>` to the `UiKitPage.tsx` entry in
`scripts/verify/baselines/plain-text.json`.

- [ ] **Step 5: Run the tests and the row; confirm they pass**

Run: `node --test scripts/verify/checks/plain-text.test.mjs && npm run i18n:plain-text`
Expected: PASS, and `plain-text: no untranslated text across … frontend source files`.

- [ ] **Step 6: Update the `plain-text` row's `proves`**

Replace its last sentence, «Every baseline exception is dated, reasoned and must still
match.», with «Every exception is dated and reasoned, must still match, and a file-wide one
fails once the file holds more or fewer candidates than it accepts.» Then run
`node --test scripts/verify/registry.test.mjs`; it is PASS only if the text is 40–80 words.
If it runs over, trim the attribute list to «a listed UI attribute» (the list stays
documented in `lib/frontend-i18n.mjs`).

- [ ] **Step 7: Run `npm run verify`, then commit**

```bash
git add scripts/verify/checks/plain-text.mjs scripts/verify/checks/plain-text.test.mjs scripts/verify/baselines/plain-text.json scripts/verify/registry.mjs
git commit -m "fix(verify): a file-wide plain-text exception states its count; drop the reason-length floor"
```

---

### Task 3: scanner precision (A5, A7, A8) and the header

**Files:**
- Modify: `scripts/verify/lib/frontend-i18n.mjs`
- Modify: `scripts/verify/lib/frontend-i18n.test.mjs`
- Modify: `scripts/verify/registry.mjs` (rows `plain-text` and `locales`: `blindSpot`)

**Interfaces:**
- Consumes: none.
- Produces: `scanSource(rel, text)` gives the same `{ candidates, keys }` as before. `keys`
  now also includes the form-rule keys described in A8.

- [ ] **Step 1: Write the failing tests** in `frontend-i18n.test.mjs`

The existing toast test calls `toast(…)` with no import. Rewrite it so the import is what
makes a callee a toast:

```js
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test scripts/verify/lib/frontend-i18n.test.mjs`
Expected: FAIL on A5, A7 and A8.

- [ ] **Step 3: Implement in `frontend-i18n.mjs`**

Header: replace line 2 with `What the two i18n rows read from frontend/src, enumerated once.`
Then replace «Both need the same AST over the same file set, and one enumeration means…»
with «Both read the same file set through one enumeration, so the two rows cannot disagree
about what "the frontend" is; each row is its own process and parses it again.»

Add the following near `LETTER`:

```js
/** `&nbsp;`, `&times;`, `&#8212;`, `&#x2014;` — markup for a character, not text. */
const CHAR_REF = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/gi

/** Modules whose named imports are toast callees: sonner's `toast`, and every wrapper the
 *  app exports from its toast module. Bound by IMPORT, so `toastIdFor(…)` is never one. */
const SONNER = 'sonner'
const TOAST_MODULE = '@/shared/ui/toast'

/** Form-library calls whose options object carries message KEYS, resolved later by `Field`. */
const FORM_CALLS = new Set(['register', 'setError'])
```

Delete the module-level `isToastCallee`. Inside `scanSource`, after `sf` is created:

```js
  /** @type {Set<string>} */
  const toastNames = new Set()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const from = st.moduleSpecifier.text
    const named = st.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named) || st.importClause?.isTypeOnly) continue
    for (const el of named.elements) {
      if (el.isTypeOnly) continue
      const imported = (el.propertyName ?? el.name).text
      if ((from === SONNER && imported === 'toast') || from === TOAST_MODULE) toastNames.add(el.name.text)
    }
  }
  const isToastCallee = (/** @type {ts.Expression} */ e) =>
    (ts.isIdentifier(e) && toastNames.has(e.text)) ||
    (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && toastNames.has(e.expression.text))

  /** @param {ts.Expression} e */
  const isFormCall = (e) =>
    (ts.isIdentifier(e) && FORM_CALLS.has(e.text)) || (ts.isPropertyAccessExpression(e) && FORM_CALLS.has(e.name.text))

  /** @param {ts.Expression | undefined} expr */
  const pushKeys = (expr) => {
    for (const lit of textLiterals(expr)) {
      if (!ts.isTemplateExpression(lit)) keys.push({ file: rel, ...at(lit.getStart(sf)), key: lit.text })
    }
  }
  /** A validate function's returned literals; nested functions are not followed. @param {ts.Node} fn */
  const returnedKeys = (fn) => {
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return
    if (!ts.isBlock(fn.body)) return pushKeys(fn.body)
    /** @param {ts.Node} n */
    const walk = (n) => {
      if (ts.isReturnStatement(n)) pushKeys(n.expression)
      else if (!ts.isFunctionLike(n)) ts.forEachChild(n, walk)
    }
    walk(fn.body)
  }
  /** @param {ts.Expression | undefined} options */
  const formRuleKeys = (options) => {
    if (!options || !ts.isObjectLiteralExpression(options)) return
    for (const p of options.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      const name = p.name.getText(sf)
      const v = p.initializer
      if (name === 'validate') {
        if (ts.isObjectLiteralExpression(v)) for (const q of v.properties) if (ts.isPropertyAssignment(q)) returnedKeys(q.initializer)
        else returnedKeys(v)
      } else if (name === 'message' || name === 'required') {
        if (literal(v)) pushKeys(v)
      } else if (ts.isObjectLiteralExpression(v)) {
        formRuleKeys(v)
      }
    }
  }
```

The `if (ts.isObjectLiteralExpression(v)) for … else returnedKeys(v)` line is ambiguous to a
reader. Write it with braces:

```js
      if (name === 'validate') {
        if (ts.isObjectLiteralExpression(v)) {
          for (const q of v.properties) if (ts.isPropertyAssignment(q)) returnedKeys(q.initializer)
        } else {
          returnedKeys(v)
        }
      }
```

In `visit`:
- the JsxText branch tests `LETTER.test(node.text.replace(CHAR_REF, ' '))`;
- the CallExpression branch gains a third arm:

  ```js
      } else if (isFormCall(node.expression)) {
        formRuleKeys(node.arguments[1])
      }
  ```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test scripts/verify/lib/frontend-i18n.test.mjs && npm run i18n:plain-text && npm run i18n:locales`
Expected: PASS.

Two cases need a fix rather than a workaround:
- `locales` is now RED on a form-rule key en.json lacks: fix the key in the component. That
  is the A8 bug class being caught.
- `plain-text` is now RED on a toast the import rule newly sees: translate it.

- [ ] **Step 5: Update the `blindSpot` of both rows in `registry.mjs`**

`plain-text` gains: «A toast callee is recognised only through an import from sonner or the
app's toast module.»
`locales` `proves`: replace «a literal key passed to t() or i18n.t() in frontend source» with
«a literal key passed to t(), returned by a validate rule, or given as a register or setError
message».
`locales` replaces its first sentence with: «A key built from a template or a variable, or
passed through a helper such as amountRules, is never checked, so a typo there still reaches
the screen raw.»

Run `node --test scripts/verify/registry.test.mjs`. Trim words until each field is 40–80.

- [ ] **Step 6: Run `npm run verify`, then commit**

```bash
git add scripts/verify/lib/frontend-i18n.mjs scripts/verify/lib/frontend-i18n.test.mjs scripts/verify/registry.mjs
git commit -m "fix(verify): i18n scanner skips char refs, binds toast by import, reads form-rule keys"
```

(If Step 4 forced component or locale fixes, add those files to the commit.)

---

### Task 4: `DateStepper` loses `todayLabel`

**Files:**
- Modify: `frontend/src/shared/ui/date-stepper.tsx`
- Modify: `frontend/src/pages/day/ui/DayPage.tsx:252`
- Modify: `frontend/src/pages/point-cash/ui/PointCashPage.tsx:449`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json` (delete `day.today` and
  `pointCash.today`)

- [ ] **Step 1: Confirm the two keys have no other reader**

Run: `grep -rn "day\.today\|pointCash\.today" frontend/src | grep -v /locales/`
Expected: only `DayPage.tsx:252` and `PointCashPage.tsx:449`.

- [ ] **Step 2: Remove the prop and the keys**

In `date-stepper.tsx`:
- delete `todayLabel,` from the destructuring;
- delete `todayLabel?: string;` from the type;
- render `{t('common.today')}`.

In the two pages, delete the `todayLabel={…}` line. In both locale files, delete the
`"today"` entries under `day` and under `pointCash`. Do not touch `common.today`,
`prices.changes.presets.today`, or any other `today`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w frontend && npx vitest run --root frontend src/pages/day src/pages/point-cash src/shared/ui && npm run i18n:locales`
Expected: PASS. Any test asserting the «Today» button still finds it, since the `en` value
of `common.today` is the same.

- [ ] **Step 4: Run `npm run verify`, then commit**

```bash
git add frontend/src/shared/ui/date-stepper.tsx frontend/src/pages/day/ui/DayPage.tsx frontend/src/pages/point-cash/ui/PointCashPage.tsx frontend/src/shared/lib/i18n/locales/uk.json frontend/src/shared/lib/i18n/locales/en.json
git commit -m "refactor(frontend): DateStepper always says common.today"
```

---

### Task 5: `statusKey` and the shared `errors.*` messages

**Files:**
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts`
- Modify: `frontend/src/shared/lib/api-error/index.ts`
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.test.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`

**Interfaces:**
- Produces: `export function statusKey(error: unknown): string | undefined`, re-exported from
  `@/shared/lib/api-error`.
- Produces: the locale keys `errors.network`, `errors.tooManyRequests`,
  `errors.accessChanged`, `errors.server`, `errors.pointRequired`.
- Produces: new `CODE` entries for `INSUFFICIENT_ROLE`, `WRONG_COLLECTION_POINT`,
  `COLLECTION_POINT_REQUIRED`, `POINT_REQUIRED`, `TRANSFER_EMPTY`,
  `TOP_UP_AMOUNT_NOT_POSITIVE`, `EXPENSE_AMOUNT_NOT_POSITIVE`, `LABEL_EMPTY`,
  `INVALID_DATE`, `CHANGES_PERIOD_REVERSED`, `CHANGES_PERIOD_TOO_LONG`.

- [ ] **Step 1: Write the failing tests** in `apiErrorToBanner.test.ts`

Follow the file's existing way of building an `ApiError`:
`new ApiError(status, message, details, code, payload)`.

```ts
describe('statusKey', () => {
  it.each([
    [0, 'errors.network'],
    [429, 'errors.tooManyRequests'],
    [403, 'errors.accessChanged'],
    [500, 'errors.server'],
    [503, 'errors.server'],
  ])('status %i → %s', (status, key) => {
    expect(statusKey(new ApiError(status, 'raw'))).toBe(key);
  });

  it('has nothing to say about a 404, a 400 or a non-ApiError', () => {
    expect(statusKey(new ApiError(404, 'Supplier not found'))).toBeUndefined();
    expect(statusKey(new ApiError(400, 'x'))).toBeUndefined();
    expect(statusKey(new Error('boom'))).toBeUndefined();
  });
});

describe('apiErrorToBanner precedence', () => {
  it('a known code beats the status: OWNER_ONLY on a 403 keeps its own sentence', () => {
    expect(apiErrorToBanner(new ApiError(403, 'x', undefined, 'OWNER_ONLY'), 'f')).toBe('day.errors.ownerOnly');
  });
  it('an unknown code on a 5xx gets the status sentence, not the fallback', () => {
    expect(apiErrorToBanner(new ApiError(500, 'x', undefined, 'SOMETHING_NEW'), 'f')).toBe('errors.server');
  });
  it('no code: status first, then the fallback', () => {
    expect(apiErrorToBanner(new ApiError(0, 'Request failed with status 0'), 'f')).toBe('errors.network');
    expect(apiErrorToBanner(new ApiError(404, 'Supplier not found'), 'f')).toBe('f');
  });
  it('the two coded 403s map to the access sentence by name', () => {
    expect(apiErrorToBanner(new ApiError(403, 'x', undefined, 'INSUFFICIENT_ROLE'), 'f')).toBe('errors.accessChanged');
    expect(apiErrorToBanner(new ApiError(403, 'x', undefined, 'WRONG_COLLECTION_POINT'), 'f')).toBe('errors.accessChanged');
  });
});
```

Check `day.errors.ownerOnly` against the actual `OWNER_ONLY` entry in `CODE` and use
whatever key is there.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --root frontend src/shared/lib/api-error`
Expected: FAIL (`statusKey` is not exported).

- [ ] **Step 3: Implement**

In `apiErrorToBanner.ts`, above `apiErrorToBanner`:

```ts
/**
 * The shared sentence for a failure no code explains: no connection, the rate
 * limit, a permission that changed under an open page, or the server itself.
 * It sits between the code map and the caller's fallback, so a known code —
 * `OWNER_ONLY` is a 403 too — always keeps its own sentence.
 */
export function statusKey(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 0) return 'errors.network';
  if (error.status === 429) return 'errors.tooManyRequests';
  if (error.status === 403) return 'errors.accessChanged';
  if (error.status >= 500) return 'errors.server';
  return undefined;
}
```

`apiErrorToBanner` body:

```ts
  const code = apiErrorCode(error);
  if (code === 'CRATES_ON_HAND_INSUFFICIENT') return onHandKey(error);
  return (code && (overrides?.[code] ?? CODE[code])) || statusKey(error) || fallback;
```

Append to `CODE`, before the closing brace:

```ts
  // Cross-cutting (#52): the two 403s that carry a code — a role or a point
  // changed while the page was open — and an owner write that named no point.
  INSUFFICIENT_ROLE: 'errors.accessChanged',
  WRONG_COLLECTION_POINT: 'errors.accessChanged',
  COLLECTION_POINT_REQUIRED: 'errors.pointRequired',
  POINT_REQUIRED: 'errors.pointRequired',
  // Codes whose form already guards the input, reachable through a stale tab or
  // a second click; each still gets its own sentence.
  TRANSFER_EMPTY: 'transfer.errors.notEmpty',
  TOP_UP_AMOUNT_NOT_POSITIVE: 'topUp.errors.amountPositive',
  EXPENSE_AMOUNT_NOT_POSITIVE: 'costOfDay.expenses.errors.amountPositive',
  LABEL_EMPTY: 'costOfDay.expenses.errors.labelRequired',
  // Price-changes period filter (GET /grade-prices/changes).
  INVALID_DATE: 'prices.changes.errors.invalidDate',
  CHANGES_PERIOD_REVERSED: 'prices.changes.errors.periodReversed',
  CHANGES_PERIOD_TOO_LONG: 'prices.changes.errors.periodTooLong',
```

`index.ts`: add `statusKey` to the re-exports.

In both locale files, add a top-level `"errors"` object directly after `"common"`, and add
the keys `CODE` now references, skipping any that already exist (`transfer.errors.notEmpty`
and `topUp.errors.amountPositive` already do):

| key | uk | en |
|---|---|---|
| `errors.network` | Немає зв'язку із сервером. Перевірте інтернет і спробуйте ще раз. | Can't reach the server. Check your connection and try again. |
| `errors.tooManyRequests` | Забагато спроб. Зачекайте хвилину й спробуйте знову. | Too many attempts. Wait a minute and try again. |
| `errors.accessChanged` | Ваші права змінилися. Оновіть сторінку. | Your access has changed. Reload the page. |
| `errors.server` | Збій на сервері. Спробуйте ще раз за хвилину. | The server failed. Try again in a minute. |
| `errors.pointRequired` | Не вибрано точку. Оберіть її й спробуйте ще раз. | No point is selected. Choose one and try again. |
| `costOfDay.expenses.errors.amountPositive` | Сума має бути більшою за нуль. Виправте її. | The amount must be above zero. Correct it. |
| `costOfDay.expenses.errors.labelRequired` | Назва витрати порожня. Напишіть, на що пішли гроші. | The expense has no name. Say what the money went on. |
| `prices.changes.errors.invalidDate` | Такої дати немає. Оберіть дату в календарі. | That date doesn't exist. Pick one from the calendar. |
| `prices.changes.errors.periodReversed` | Кінець періоду раніше за початок. Поміняйте дати місцями. | The period ends before it starts. Swap the dates. |
| `prices.changes.errors.periodTooLong` | Період задовгий. Оберіть коротший. | The period is too long. Choose a shorter one. |

Nest each key under its existing parent object. Create `costOfDay.expenses.errors` and
`prices.changes.errors` if they do not exist.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --root frontend src/shared/lib/api-error && npm run typecheck -w frontend && npm run i18n:locales`
Expected: PASS.

- [ ] **Step 5: Run every banner consumer's tests**

Run: `npx vitest run --root frontend`
Expected: PASS. A test that asserted the caller's fallback for a 500 or a network error now
gets `errors.server` / `errors.network`. Update its expectation; that is the intended change.
List each updated test in the task report.

- [ ] **Step 6: Wire `PriceChanges`' query error through the banner**

In `frontend/src/pages/prices/ui/PriceChanges.tsx`, in the `query.isError` branch:

```tsx
          {t(apiErrorToBanner(query.error, 'common.somethingWentWrong'))}
```

Import `apiErrorToBanner` from `@/shared/lib/api-error`. Then add a test in the page's test
file, or create `PriceChanges.test.tsx` if none exists, that mocks
`GET /grade-prices/changes` → `400 { code: 'CHANGES_PERIOD_TOO_LONG' }` and asserts the `en`
sentence «The period is too long. Choose a shorter one.»

- [ ] **Step 7: Run `npm run verify`, then commit**

```bash
git add frontend/src/shared/lib/api-error frontend/src/pages/prices/ui/PriceChanges.tsx frontend/src/pages/prices/ui/*.test.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(frontend): statusKey — a translated sentence for network, 429, 403 and 5xx failures"
```

---

### Task 6: `LoginForm` never renders server text

**Files:**
- Modify: `frontend/src/features/auth/ui/LoginForm.tsx`
- Modify: `frontend/src/features/auth/ui/LoginForm.test.tsx`
- Modify: locales (`auth.loginFailed`)

**Interfaces:**
- Consumes: `apiErrorToBanner` and `statusKey` (Task 5).

- [ ] **Step 1: Write the failing tests** (`en` copy, because tests pin English)

```tsx
  it.each([
    [429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, 'Too many attempts. Wait a minute and try again.'],
    [500, { statusCode: 500, message: 'Internal server error' }, 'The server failed. Try again in a minute.'],
    [400, { statusCode: 400, message: ['username must be a string'] }, "Couldn't sign in. Check your login and password and try again."],
  ])('a %i shows a translated sentence and never the server text', async (status, body, expected) => {
    mock.onPost('/auth/login').reply(status, body);
    renderForm();
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByText(/ThrottlerException|Internal server error|must be a string/)).toBeNull();
  });

  it('a network failure shows the connection sentence', async () => {
    mock.onPost('/auth/login').networkError();
    renderForm();
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.");
    expect(screen.queryByText(/Request failed/)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --root frontend src/features/auth`
Expected: FAIL. The raw server text is rendered.

- [ ] **Step 3: Implement**

Replace lines 30–38 of `LoginForm.tsx` with:

```tsx
  // A 401 here means bad credentials whether or not the body carried the code;
  // every other failure goes through the shared map. The server's `message` is
  // English prose for a log and is never rendered.
  const error = mutation.error;
  const messageKey = !error
    ? null
    : error instanceof ApiError && (error.code === 'INVALID_CREDENTIALS' || (!error.code && error.status === 401))
      ? 'auth.invalidCredentials'
      : apiErrorToBanner(error, 'auth.loginFailed');
```

Render `{messageKey && (<p role="alert" …>{t(messageKey)}</p>)}`. Import `apiErrorToBanner`
from `@/shared/lib/api-error`; an FSD feature may import shared.

Add the locale key `auth.loginFailed`:
- uk: «Не вдалося увійти. Перевірте логін і пароль та спробуйте ще раз.»
- en: «Couldn't sign in. Check your login and password and try again.»

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --root frontend src/features/auth && npm run typecheck -w frontend`
Expected: PASS, including the existing 401 test.

- [ ] **Step 5: Run `npm run verify`, then commit**

```bash
git add frontend/src/features/auth/ui frontend/src/shared/lib/i18n/locales
git commit -m "fix(auth): the login form never renders the server's message"
```

---

### Task 7: exact codes in the users, catalog, points and supplier mappers

**Files:**
- Modify: `frontend/src/pages/users/lib/apiErrorToFields.ts` + its `.test.ts`
- Modify: `frontend/src/pages/catalog/lib/apiErrorToFields.ts` + `.test.ts`
- Modify: `frontend/src/pages/points/lib/apiErrorToFields.ts` + `.test.ts`
- Modify: `frontend/src/features/edit-supplier/lib/apiErrorToFields.ts` + `.test.ts`
- Modify: locales (`users.errors.*` additions)

**Interfaces:**
- Consumes: `statusKey` (Task 5).
- Produces: each mapper keeps its signature
  `apiErrorToFields(error, fields): { fieldErrors, formErrorKey }`.

- [ ] **Step 1: Write the failing tests**

`pages/users/lib/apiErrorToFields.test.ts`:
- replace every `USER_LOGIN_TAKEN` with `LOGIN_TAKEN`, the code the backend actually throws;
- add these tests:

```ts
const FIELDS = ['first_name', 'last_name', 'login', 'password', 'role', 'collection_point_id', 'is_active'];

it('LOGIN_TAKEN — the code the backend throws — lands on the login field', () => {
  expect(apiErrorToFields(new ApiError(409, 'x', undefined, 'LOGIN_TAKEN'), FIELDS)).toEqual({
    fieldErrors: [{ field: 'login', messageKey: 'users.errors.loginTaken' }],
    formErrorKey: null,
  });
});

it.each([
  ['LAST_OWNER', 409, 'users.errors.lastOwner'],
  ['SELF_LOCKOUT', 403, 'users.errors.selfLockout'],
  ['OWNER_HAS_NO_POINT', 400, 'users.errors.ownerHasNoPoint'],
  ['POINT_UNUSABLE', 400, 'users.errors.pointUnusable'],
  ['USER_NAME_EMPTY', 400, 'users.errors.nameRequired'],
])('%s banners its own sentence, even on a 403', (code, status, key) => {
  expect(apiErrorToFields(new ApiError(status, 'x', undefined, code), FIELDS)).toEqual({ fieldErrors: [], formErrorKey: key });
});

it('OPERATOR_NEEDS_POINT lands on the point field', () => {
  expect(apiErrorToFields(new ApiError(400, 'x', undefined, 'OPERATOR_NEEDS_POINT'), FIELDS).fieldErrors).toEqual([
    { field: 'collection_point_id', messageKey: 'users.errors.pointRequired' },
  ]);
});

it('a network failure and a 500 get the status sentence, not saveFailed', () => {
  expect(apiErrorToFields(new ApiError(0, 'x'), FIELDS).formErrorKey).toBe('errors.network');
  expect(apiErrorToFields(new ApiError(500, 'x'), FIELDS).formErrorKey).toBe('errors.server');
});
```

`catalog`:
- rewrite the suffix tests to the six real codes: `GRADE_NAME_TAKEN`, `GRADE_NAME_EMPTY`,
  `PRODUCT_NAME_TAKEN`, `PRODUCT_NAME_EMPTY`, `TARE_TYPE_NAME_TAKEN`, `TARE_TYPE_NAME_EMPTY`;
- add a twin proving that a made-up `FOO_NAME_TAKEN` no longer matches and falls to
  `catalog.errors.saveFailed`.

`points`: the same treatment for `POINT_NAME_TAKEN`, `POINT_NAME_EMPTY`, `POINT_CODE_TAKEN`,
`POINT_HAS_ACTIVE_USERS`.

`edit-supplier`: the same for `SUPPLIER_PHONE_TAKEN`, `SUPPLIER_PHONE_INVALID`,
`SUPPLIER_NAME_EMPTY`, `COLLECTION_POINT_REQUIRED`.

Each of the three also gets a status test: 0 gives `errors.network`, 500 gives
`errors.server`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --root frontend src/pages/users src/pages/catalog src/pages/points src/features/edit-supplier`
Expected: FAIL.

- [ ] **Step 3: Implement**

In all four mappers, every `formErrorKey: FORM_LEVEL` returned for an unexplained failure
(the non-`ApiError` early return and the final return) becomes
`formErrorKey: statusKey(error) ?? FORM_LEVEL`. Import `statusKey` from
`@/shared/lib/api-error`. Keep `unattributed ? FORM_LEVEL : null` as it is: there, the
server did explain part of the failure.

`users`: replace the `if (error.code) { … }` block with the following:

```ts
const CODE_FIELD: Readonly<Record<string, { field: string; messageKey: string }>> = {
  LOGIN_TAKEN: { field: 'login', messageKey: 'users.errors.loginTaken' },
  OPERATOR_NEEDS_POINT: { field: 'collection_point_id', messageKey: 'users.errors.pointRequired' },
};

const CODE_BANNER: Readonly<Record<string, string>> = {
  LAST_OWNER: 'users.errors.lastOwner',
  SELF_LOCKOUT: 'users.errors.selfLockout',
  OWNER_HAS_NO_POINT: 'users.errors.ownerHasNoPoint',
  POINT_UNUSABLE: 'users.errors.pointUnusable',
  USER_NAME_EMPTY: 'users.errors.nameRequired',
};
// …
  if (error.code) {
    const field = CODE_FIELD[error.code];
    if (field && fields.includes(field.field)) return { fieldErrors: [field], formErrorKey: null };
    const banner = CODE_BANNER[error.code] ?? field?.messageKey;
    if (banner) return { fieldErrors: [], formErrorKey: banner };
  }
```

The old `_HAS_ACTIVE` branch matched no code the users endpoints throw; `POINT_HAS_ACTIVE_USERS`
is a points code. Delete it, and fix its doc comment.

New users keys:

| key | uk | en |
|---|---|---|
| `users.errors.lastOwner` | Це останній активний керівник. Спершу зробіть керівником когось іншого. | This is the last active owner. Make someone else an owner first. |
| `users.errors.selfLockout` | Не можна вимкнути чи понизити себе. Попросіть іншого керівника. | You can't deactivate or demote yourself. Ask another owner. |
| `users.errors.ownerHasNoPoint` | Керівник не належить до точки. Приберіть точку з форми. | An owner doesn't belong to a point. Clear the point field. |
| `users.errors.pointUnusable` | Цю точку деактивовано. Оберіть іншу. | That point is deactivated. Choose another. |

`catalog`, `points`, `edit-supplier`: replace each `CODE_SUFFIX` / `CODE_FIELD` array of
`[suffix, …]` with a `Record<string, …>` keyed by the exact codes from Step 1, and replace
`find(([suffix]) => code.endsWith(suffix))` with a direct lookup. Example for catalog:

```ts
const CODE_KEY: Readonly<Record<string, string>> = {
  GRADE_NAME_TAKEN: 'catalog.errors.nameTaken',
  PRODUCT_NAME_TAKEN: 'catalog.errors.nameTaken',
  TARE_TYPE_NAME_TAKEN: 'catalog.errors.nameTaken',
  GRADE_NAME_EMPTY: 'catalog.errors.nameEmpty',
  PRODUCT_NAME_EMPTY: 'catalog.errors.nameEmpty',
  TARE_TYPE_NAME_EMPTY: 'catalog.errors.nameEmpty',
};
// …
  const key = error.code ? CODE_KEY[error.code] : undefined;
  if (key && fields.includes('name')) return { fieldErrors: [{ field: 'name', messageKey: key }], formErrorKey: null };
```

Update each mapper's doc comment where it describes suffix matching.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --root frontend src/pages/users src/pages/catalog src/pages/points src/features/edit-supplier && npm run typecheck -w frontend && npm run i18n:locales`
Expected: PASS.

- [ ] **Step 5: Run `npm run verify`, then commit**

```bash
git add frontend/src/pages/users/lib frontend/src/pages/catalog/lib frontend/src/pages/points/lib frontend/src/features/edit-supplier/lib frontend/src/shared/lib/i18n/locales
git commit -m "fix(frontend): mappers match exact backend codes — LOGIN_TAKEN reaches its field again"
```

---

### Task 8: prices, reception and payout mappers; `PayoutDialog` re-translates

**Files:**
- Modify: `frontend/src/pages/prices/lib/apiErrorToFields.ts` + `.test.ts`
- Modify: `frontend/src/pages/reception/lib/apiErrorToFields.ts` + `.test.ts`
- Modify: `frontend/src/features/settle-payout/lib/apiErrorToFields.ts` + `.test.ts`
- Modify: `frontend/src/features/settle-payout/ui/PayoutDialog.tsx:100-110, 139-154` + its test
- Modify: locales

**Interfaces:**
- Consumes: `statusKey` (Task 5).

- [ ] **Step 1: Write the failing tests**

`prices`:

```ts
it.each([
  ['PRODUCT_GRADE_INACTIVE', 'prices.errors.gradeInactive'],
  ['DUPLICATE_COLLECTION_POINT', 'prices.errors.duplicatePoint'],
])('%s banners its own sentence', (code, key) => {
  expect(apiErrorToFields(new ApiError(400, 'x', undefined, code), FIELDS)).toEqual({ fieldErrors: [], formErrorKey: key });
});
```

`reception`: change «INTAKE_CODE_TAKEN has no field left to land on, so it banners» to
expect `formErrorKey: 'errors.documentRace'`.
`settle-payout`: the same for `PAYOUT_CODE_TAKEN`.
All three mappers also get the status test: 0 gives `errors.network`.

`PayoutDialog` test: render with a debt of `100.00`, submit `150`, and assert the `en` text
«… balance 100.00 …»; follow the en value of `payout.errors.exceedsDebt`. Then call
`await act(() => i18n.changeLanguage('uk'))` and assert the uk text now shows. Restore `en`
in `finally`, as the memory note on frontend tests requires.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run --root frontend src/pages/prices src/pages/reception src/features/settle-payout`
Expected: FAIL.

- [ ] **Step 3: Implement**

`prices`:
- add a `CODE_BANNER` with the two codes, checked before the details loop:
  `if (error.code && CODE_BANNER[error.code]) return { fieldErrors: [], formErrorKey: CODE_BANNER[error.code] };`
- apply `statusKey(error) ?? FORM_LEVEL` to the two unexplained returns.

`reception`:
- add `INTAKE_CODE_TAKEN: 'errors.documentRace'` to `BANNER`;
- delete the «deliberately unmapped» paragraph from the doc comment and replace it with one
  line: the code is generated server-side, so a collision is a race and the advice is to
  press again;
- `statusKey(error) ?? FORM_LEVEL` on the three unexplained returns, including the
  code-but-unmapped one.

`settle-payout`:
- add `PAYOUT_CODE_TAKEN: 'errors.documentRace'` to `CODE_BANNER`, with the same doc-comment
  change;
- `statusKey(error) ?? FORM_LEVEL` on both unexplained returns.

`PayoutDialog.tsx`:
- `setError('amount', { message: 'payout.errors.exceedsDebt' });`
- delete the four-line comment above it;
- on the amount `Field`, add
  `errorParams={errors.amount?.message === 'payout.errors.exceedsDebt' ? { debt: formatUah(debt, locale) } : undefined}`;
- `debt` and `locale` are already in render scope (they are read in the submit handler). If
  `debt` is computed inside the handler only, lift that expression to render scope first.

New keys:

| key | uk | en |
|---|---|---|
| `prices.errors.gradeInactive` | Цей сорт вимкнено. Увімкніть його в довіднику або оберіть інший. | This grade is switched off. Turn it on in the catalog or pick another. |
| `prices.errors.duplicatePoint` | Одну точку вибрано двічі. Залиште її один раз. | The same point is selected twice. Keep it once. |
| `errors.documentRace` | Хтось зберіг документ у ту саму мить. Натисніть ще раз. | Someone saved a document at the same moment. Press again. |

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run --root frontend src/pages/prices src/pages/reception src/features/settle-payout && npm run typecheck -w frontend && npm run i18n:locales`
Expected: PASS.

- [ ] **Step 5: Run `npm run verify`, then commit**

```bash
git add frontend/src/pages/prices/lib frontend/src/pages/reception/lib frontend/src/features/settle-payout frontend/src/shared/lib/i18n/locales
git commit -m "fix(frontend): prices/reception/payout map their last codes; payout error follows the language"
```

---

### Task 9: the `error-codes` verify row

**Files:**
- Modify: `scripts/verify/lib/frontend-i18n.mjs` (collect UPPER_SNAKE names)
- Modify: `scripts/verify/lib/frontend-i18n.test.mjs`
- Create: `scripts/verify/checks/error-codes.mjs`
- Create: `scripts/verify/checks/error-codes.test.mjs`
- Create: `scripts/verify/baselines/error-codes.json`
- Modify: `scripts/verify/registry.mjs` (new row)
- Modify: `scripts/verify/registry.test.mjs` (`COLD_MS` entry)
- Modify: `package.json` (`"i18n:error-codes": "node scripts/verify/checks/error-codes.mjs"`)

**Interfaces:**
- Produces: `scanSource(rel, text)` returns `{ candidates, keys, names }`, where
  `names: string[]` is every UPPER_SNAKE string literal and object-literal property name.
  `scanFrontend(root)` returns `{ files, candidates, keys, names }`, with names deduplicated.
- Produces: `export const CODE_NAME = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/` in `frontend-i18n.mjs`.
- Produces: `checkErrorCodes(backend: Set<string>, frontend: Set<string>, baseline: {code,date,reason}[]): { problems: string[], excused: number }`.
- Produces: `backendCodes(root): { files: string[], codes: Set<string> }`.

- [ ] **Step 1: Write the failing scanner test** in `frontend-i18n.test.mjs`

```js
test('names: UPPER_SNAKE literals and property names, never identifiers, comments or prose', () => {
  const src = `// NOT_IN_A_COMMENT
    const CODE = { NOT_YOUR_DOCUMENT: 'k', 'SHIFT_CLOSED': 'k', lower_case: 'k' }
    if (e.code === 'CRATES_ON_HAND_INSUFFICIENT') {}
    const FORM_LEVEL = 'x'; const s = 'Hello WORLD_X'; const one = 'SINGLE'`
  assert.deepEqual(scanSource('x.ts', src).names.sort(), ['CRATES_ON_HAND_INSUFFICIENT', 'NOT_YOUR_DOCUMENT', 'SHIFT_CLOSED'])
})
```

- [ ] **Step 2: Implement the names collection**

In `frontend-i18n.mjs`:

```js
/** A backend error code's shape — and, by the `error-codes` row, a frontend reference to one. */
export const CODE_NAME = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/
```

In `scanSource`:
- declare `/** @type {Set<string>} */ const names = new Set()`, and in the snippet below
  use `names.add(…)` in place of `names.push(…)`;
- in `visit`, before the existing chain, add a separate `if`, so that it does not stop the
  other rules:

  ```js
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CODE_NAME.test(node.text)) names.push(node.text)
    else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && CODE_NAME.test(node.name.text)) names.push(node.name.text)
  ```

  (a string-literal property NAME is also a StringLiteral node, so `'SHIFT_CLOSED'` is met
  by both arms; the Set keeps it once);
- return `{ candidates, keys, names: [...names] }`.

`scanFrontend` accumulates the names into a `Set` and returns `names: [...set].sort()`.

Run: `node --test scripts/verify/lib/frontend-i18n.test.mjs`
Expected: PASS.

- [ ] **Step 3: Write the failing row tests** in `error-codes.test.mjs`

```js
/**
 * The decision logic is tested as a pure function; the CLI against throwaway git repos.
 * Exactly one test runs against the real repository, with an independently derived lower
 * bound on the backend code count as its discriminator.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkErrorCodes } from './error-codes.mjs'
import { fixtureGitEnv, gitEnv } from '../scan-root.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const CHECK = path.join(REPO, 'scripts', 'verify', 'checks', 'error-codes.mjs')

/** @param {Record<string, string>} files @returns {string} */
function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'error-codes-'))
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

const B = (...c) => new Set(c)
const ENTRY = (code) => ({ code, date: '2026-10-07', reason: 'a DI token, not an error code' })

test('a backend code nobody on the frontend names is RED; naming it turns it green', () => {
  assert.match(checkErrorCodes(B('LAST_OWNER'), B(), []).problems.join('\n'), /LAST_OWNER.*no frontend reference/)
  assert.deepEqual(checkErrorCodes(B('LAST_OWNER'), B('LAST_OWNER'), []).problems, [])
})

test('a frontend name the backend never produces is RED — the LOGIN_TAKEN drift, from the other side', () => {
  const p = checkErrorCodes(B('LOGIN_TAKEN'), B('LOGIN_TAKEN', 'USER_LOGIN_TAKEN'), []).problems
  assert.deepEqual(p, ['USER_LOGIN_TAKEN: named in frontend source, never produced by backend/src'])
})

test('a baseline entry excuses a name on either side, and goes stale once both sides agree', () => {
  assert.deepEqual(checkErrorCodes(B('REDIS_CLIENT'), B(), [ENTRY('REDIS_CLIENT')]), { problems: [], excused: 1 })
  assert.deepEqual(checkErrorCodes(B(), B('VITE_API_URL'), [ENTRY('VITE_API_URL')]).problems, [])
  assert.match(checkErrorCodes(B('X_Y'), B('X_Y'), [ENTRY('X_Y')]).problems.join(), /stale exception.*X_Y/)
})

test('a baseline entry with an empty reason or a bad date is RED', () => {
  const p = checkErrorCodes(B('A_B'), B(), [{ code: 'A_B', date: '07.10.2026', reason: ' ' }]).problems
  assert.ok(p.some((l) => /A_B.*reason|A_B.*date/.test(l)), p.join('\n'))
})

test('CLI: every way a code is written in the backend is seen; comments and specs are not', () => {
  const root = fixture({
    'backend/src/a.service.ts': `throw new X({ code: 'ONE_CODE' }); assertTrimmedName(n, 'name', 'TWO_CODE'); bad('m', 'THREE_CODE')\n// 'COMMENT_CODE'\n`,
    'backend/src/a.service.spec.ts': `expect(code).toBe('SPEC_ONLY')\n`,
    'backend/src/migrations/1-x.ts': `const s = 'MIGRATION_ONLY'\n`,
    'frontend/src/m.ts': `export const M = { ONE_CODE: 'k', TWO_CODE: 'k' }\n`,
  })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /THREE_CODE/)
    assert.doesNotMatch(r.out, /COMMENT_CODE|SPEC_ONLY|MIGRATION_ONLY/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: no backend codes refuses a verdict', () => {
  const root = fixture({ 'backend/src/a.ts': 'export const a = 1\n', 'frontend/src/m.ts': 'export const m = 1\n' })
  try {
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.out, /scanned ZERO backend error codes/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real repository is green, over a backend code count derived independently here', () => {
  // Independent of the AST: every `code: 'X'` literal outside tests, by git grep. The AST
  // scan also sees helper arguments, so it can only be GREATER — equality would be wrong.
  const out = execFileSync('git', ['grep', '-h', '-o', '-E', "code: '[A-Z][A-Z0-9_]+'", '--', 'backend/src', ':!*spec.ts', ':!backend/src/testing', ':!backend/src/migrations', ':!backend/src/seed'], { cwd: REPO, env: gitEnv(), encoding: 'utf8' })
  const lowerBound = new Set(out.split('\n').filter(Boolean)).size
  const r = run()
  assert.equal(r.status, 0, r.out)
  const m = r.out.match(/all (\d+) backend error codes/)
  assert.ok(m && Number(m[1]) >= lowerBound && lowerBound > 0, `${r.out} vs lower bound ${lowerBound}`)
})
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `node --test scripts/verify/checks/error-codes.test.mjs`
Expected: FAIL (the module does not exist).

- [ ] **Step 5: Implement `scripts/verify/checks/error-codes.mjs`**

```js
#!/usr/bin/env node
/**
 * Every error code the backend can send is one the frontend knows, and every code the
 * frontend names is one the backend still sends.
 *
 * A code is any UPPER_SNAKE string literal in shipped backend source — `code: 'X'`,
 * `assertTrimmedName(…, 'X')`, `bad(msg, 'X')` alike — and a frontend reference is the same
 * shape as a string literal or an object key in shipped frontend source. A code with no
 * reference reaches the user as a generic «не вдалося»; a reference with no code is a
 * mapping that silently stopped matching. What is neither lives in ONE reviewed file,
 * scripts/verify/baselines/error-codes.json, dated and reasoned, and must still match.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { errMessage } from '../hash.mjs'
import { CODE_NAME, listUnder, scanFrontend } from '../lib/frontend-i18n.mjs'
import { refuseEmptyScan, scanRoot } from '../scan-root.mjs'

const ROOT = scanRoot()
const BASELINE_REL = 'scripts/verify/baselines/error-codes.json'
const NOT_SHIPPED = /(spec\.ts$|^backend\/src\/(testing|migrations|seed)\/)/

/** @param {string} root */
export function backendCodes(root) {
  const files = listUnder(root, 'backend/src').filter((f) => f.endsWith('.ts') && !NOT_SHIPPED.test(f))
  /** @type {Set<string>} */
  const codes = new Set()
  /** @type {string[]} */
  const scanned = []
  for (const rel of files) {
    let text
    try {
      text = readFileSync(path.join(root, rel), 'utf8')
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue
      throw err
    }
    scanned.push(rel)
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    /** @param {ts.Node} n */
    const visit = (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CODE_NAME.test(n.text)) codes.add(n.text)
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { files: scanned, codes }
}

/**
 * @param {Set<string>} backend
 * @param {Set<string>} frontend
 * @param {unknown} baseline parsed JSON
 */
export function checkErrorCodes(backend, frontend, baseline) {
  /** @type {string[]} */
  const problems = []
  if (!Array.isArray(baseline)) return { problems: [`${BASELINE_REL} must be a JSON array`], excused: 0 }
  /** @type {Set<string>} */
  const excused = new Set()
  for (const e of baseline) {
    const label = `${BASELINE_REL}: ${e?.code ?? '<no code>'}`
    if (typeof e?.code !== 'string') problems.push(`${label}: "code" must be a string`)
    else if (typeof e.reason !== 'string' || e.reason.trim() === '') problems.push(`${label}: "reason" is missing or empty`)
    else if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) problems.push(`${label}: "date" must be YYYY-MM-DD`)
    else excused.add(e.code)
  }
  const unmapped = [...backend].filter((c) => !frontend.has(c))
  const orphaned = [...frontend].filter((c) => !backend.has(c))
  for (const c of unmapped) if (!excused.has(c)) problems.push(`${c}: thrown in backend/src, no frontend reference — map it where it surfaces, or excuse it in ${BASELINE_REL}`)
  for (const c of orphaned) if (!excused.has(c)) problems.push(`${c}: named in frontend source, never produced by backend/src`)
  const live = new Set([...unmapped, ...orphaned])
  for (const c of excused) if (!live.has(c)) problems.push(`stale exception — ${c} needs no excuse any more, delete it from ${BASELINE_REL}`)
  return { problems: problems.sort(), excused: excused.size }
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

function main() {
  let backend, frontend, result
  try {
    backend = backendCodes(ROOT)
    frontend = scanFrontend(ROOT)
    result = checkErrorCodes(backend.codes, new Set(frontend.names), readBaseline(ROOT))
  } catch (err) {
    process.stderr.write(`error-codes: RED\n  ${errMessage(err)}\n`)
    process.exit(1)
    return
  }
  refuseEmptyScan('error-codes', backend.files.length, 'backend source files', ROOT)
  refuseEmptyScan('error-codes', frontend.files.length, 'frontend source files', ROOT)
  refuseEmptyScan('error-codes', backend.codes.size, 'backend error codes', ROOT)

  if (result.problems.length) {
    process.stderr.write('error-codes: RED\n')
    for (const p of result.problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `error-codes: all ${backend.codes.size} backend error codes are named in ${frontend.files.length} frontend source files ` +
      `or excused (${result.excused} in the baseline), and every frontend code name is one the backend produces\n`,
  )
}

if (process.argv[1]?.endsWith('error-codes.mjs')) main()
```

Add `"i18n:error-codes": "node scripts/verify/checks/error-codes.mjs"` to `package.json`
next to the other `i18n:` scripts.

- [ ] **Step 6: Run the unit tests, then the row on the real repo**

Run: `node --test scripts/verify/checks/error-codes.test.mjs` (every test passes except the
real-repo one), then `npm run i18n:error-codes`.

Every RED line the row prints needs a decision, made in this order:
1. **It is a real code reachable from a UI path.** Map it where it surfaces: add it to `CODE`
   or the right mapper, write its locale keys per the tone rule, and add a mapper test. Do
   not baseline a reachable code.
2. **It is not an error code.** For example `REDIS_CLIENT` (a DI token), or a frontend
   env-schema key such as `VITE_API_URL`. Add an entry: `{ code, date: today, reason }`.
3. **It is unreachable from any UI path.** Add an entry whose reason names the evidence:
   - `PAYOUT_NOT_VOIDED`, `RETURN_ALREADY_SETTLED`: «no frontend caller of
     POST /payouts/:id/settle-return»;
   - `DOCUMENT_CODE_INVALID`, `BUSINESS_DATE_MALFORMED`: «document codes are server-generated
     since the typed-code field was removed; no user input reaches normalizeTypedCode»;
   - check any other with `grep -rn` against `frontend/src/**/api/` first.

Record each decision in the task report as a table: code → mapped / excused → reason.

Run again: `npm run i18n:error-codes`
Expected: `error-codes: all N backend error codes are named in M frontend source files or excused (K in the baseline), …`.
Then: `node --test scripts/verify/checks/error-codes.test.mjs`. All PASS.

- [ ] **Step 7: Register the row**

In `scripts/verify/registry.mjs`, directly after the `locales` row:

```js
  {
    id: 'error-codes',
    tier: 'fast',
    // No `after`, for the reason on `migrations`: syntax-only parse on both sides.
    cmd: 'npm run i18n:error-codes',
    proves:
      'Every UPPER_SNAKE string literal in shipped backend source, tests, migrations and seed ' +
      'aside, is named by a string literal or object key in shipped frontend source, and every ' +
      'such name in the frontend is one the backend produces; this command fails on a gap ' +
      'either way unless the name is excused individually, dated and reasoned, in its ' +
      'baseline, and on an excuse that matches nothing.',
    blindSpot:
      'A reference is not a correct mapping: a code named only in a comparison, or mapped to ' +
      'the wrong sentence, passes. A code assembled at runtime is invisible. Failures that ' +
      'carry no code, such as a not-found or a validation rejection, are covered only by the ' +
      'status fallback in the frontend, never by this row, and the wording of any message is ' +
      'not judged.',
  },
```

In `registry.test.mjs`, measure first:

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do /usr/bin/time -p npm run -s i18n:error-codes >/dev/null 2>>/tmp/ec-time; done; grep real /tmp/ec-time | sort -k2 -n | tail -1
```

If `/usr/bin/time` is missing, use bash `time`, as the `compose` comment describes. Then add
`'error-codes': <slowest ms>` to `COLD_MS` under the `plain-text` / `locales` comment, with
«`error-codes`» added to that comment's list.

- [ ] **Step 8: Run the registry tests and the fast tier**

Run: `node --test scripts/verify/registry.test.mjs && npm run verify`
Expected: PASS. `error-codes` appears in the fast tier's table as passed. Quote the verdict
line.

- [ ] **Step 9: Commit**

```bash
git add scripts/verify/lib/frontend-i18n.mjs scripts/verify/lib/frontend-i18n.test.mjs scripts/verify/checks/error-codes.mjs scripts/verify/checks/error-codes.test.mjs scripts/verify/baselines/error-codes.json scripts/verify/registry.mjs scripts/verify/registry.test.mjs package.json
git commit -m "feat(verify): error-codes row — backend codes and frontend mappings cannot drift apart"
```

(Add any mapper or locale files that Step 6 changed.)

---

### Task 10: error copy follows the tone rule (Part C copy)

**Files:**
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`
- Modify: any test asserting a changed `en` value

- [ ] **Step 1: Rewrite the fallback sentences**

Every «it failed» key now appears only after `statusKey` has ruled out network, 429, 403 and
5xx. What is left is a stale page (a 404) or an input the server refused without a code. The
honest advice for both is to reload and retry. Set these values:

| key | uk | en |
|---|---|---|
| `common.somethingWentWrong` | Щось пішло не так. Оновіть сторінку й спробуйте ще раз. | Something went wrong. Reload the page and try again. |
| `points.errors.saveFailed` | Не вдалося зберегти точку. Оновіть сторінку й спробуйте ще раз. | Couldn't save the point. Reload the page and try again. |
| `users.errors.saveFailed` | Не вдалося зберегти користувача. Оновіть сторінку й спробуйте ще раз. | Couldn't save the user. Reload the page and try again. |
| `users.password.failed` | Не вдалося прочитати пароль. Оновіть сторінку й спробуйте ще раз. | Couldn't read the password. Reload the page and try again. |
| `suppliers.errors.saveFailed` | Не вдалося зберегти постачальника. Оновіть сторінку й спробуйте ще раз. | Couldn't save the supplier. Reload the page and try again. |
| `catalog.errors.saveFailed` | Не вдалося зберегти. Оновіть сторінку й спробуйте ще раз. | Couldn't save. Reload the page and try again. |
| `prices.errors.saveFailed` | Не вдалося зберегти ціну. Оновіть сторінку й спробуйте ще раз. | Couldn't save the price. Reload the page and try again. |
| `day.errors.failed` | Не вдалося змінити зміну. Оновіть сторінку й спробуйте ще раз. | Couldn't change the shift. Reload the page and try again. |
| `void.errors.failed` | Не вдалося анулювати. Оновіть сторінку й спробуйте ще раз. | Couldn't void it. Reload the page and try again. |
| `cash.errors.failed` | Не вдалося зберегти пояснення. Оновіть сторінку й спробуйте ще раз. | Couldn't save the explanation. Reload the page and try again. |
| `recount.errors.failed` | Не вдалося записати перерахунок. Оновіть сторінку й спробуйте ще раз. | Couldn't record the recount. Reload the page and try again. |
| `pointTarget.errors.failed` | Не вдалося оновити наділ. Оновіть сторінку й спробуйте ще раз. | Couldn't update the allotment. Reload the page and try again. |
| `payout.errors.failed` | Не вдалося провести виплату. Оновіть сторінку й спробуйте ще раз. | Couldn't record the payout. Reload the page and try again. |
| `reception.errors.failed` | Не вдалося провести квитанцію. Оновіть сторінку й спробуйте ще раз. | Couldn't record the receipt. Reload the page and try again. |
| `transfer.errors.failed` | Не вдалося обробити переказ. Оновіть сторінку й спробуйте ще раз. | Couldn't process the transfer. Reload the page and try again. |
| `topUp.errors.failed` | Не вдалося додати залишок. Оновіть сторінку й спробуйте ще раз. | Couldn't add the balance. Reload the page and try again. |
| `crates.errors.issueFailed` | Не вдалося видати ящики. Оновіть сторінку й спробуйте ще раз. | Couldn't issue the crates. Reload the page and try again. |
| `crates.errors.returnFailed` | Не вдалося прийняти ящики. Оновіть сторінку й спробуйте ще раз. | Couldn't take the crates back. Reload the page and try again. |
| `reweigh.errors.postFailed` | Позицію не проведено. Оновіть сторінку й спробуйте ще раз. | The line wasn't posted. Reload the page and try again. |
| `reweigh.day.errors.failed` | Позицію не анульовано. Оновіть сторінку й спробуйте ще раз. | The line wasn't voided. Reload the page and try again. |
| `costOfDay.expenses.addFailed` | Рядок не додано. Оновіть сторінку й спробуйте ще раз. | The line wasn't added. Reload the page and try again. |
| `costOfDay.expenses.updateFailed` | Рядок не змінено. Оновіть сторінку й спробуйте ще раз. | The line wasn't changed. Reload the page and try again. |
| `costOfDay.expenses.removeFailed` | Рядок не прибрано. Оновіть сторінку й спробуйте ще раз. | The line wasn't removed. Reload the page and try again. |
| `profile.avatarUploadFailed` | Не вдалося завантажити зображення. Оберіть JPEG, PNG або WebP до 10 МБ. | Couldn't upload the image. Use a JPEG, PNG or WebP under 10 MB. |
| `reweigh.postFailed` | Позицію «{{grade}}» не проведено. Оновіть сторінку й спробуйте ще раз. | The line «{{grade}}» wasn't posted. Reload the page and try again. |

Load failures, where the action is a reload. Append « Оновіть сторінку.» / « Reload the
page.» to each of these, unless the value already ends with «оновіть сторінку»:
`dashboard.staleShifts.loadFailed`, `void.reopensFailed`,
`pointCash.incoming.loadFailed`, `reception.refundConfirm.failed`,
`crates.return.splitFailed`, `crates.docs.failed`. Replace the em-dash join with a full stop
so that each message is two sentences.

Specific messages that name a cause but no action:

| key | uk | en |
|---|---|---|
| `payout.errors.exceedsDebtServer` | Сума більша за залишок боргу. Зменшіть її. | The amount is more than the balance owed. Lower it. |
| `payout.errors.supplierInactive` | Постачальника деактивовано. Виплату зараз провести не можна — зверніться до керівника. | The supplier is deactivated. Ask an owner before paying out. |
| `payout.errors.shiftClosed` | Зміну вже закрито. Зверніться до керівника. | The shift is already closed. Ask an owner. |
| `reception.errors.shiftClosed` | Зміну вже закрито. Зверніться до керівника. | The shift is already closed. Ask an owner. |
| `reception.errors.supplierInactive` | Постачальника деактивовано. Оберіть іншого або зверніться до керівника. | The supplier is deactivated. Pick another or ask an owner. |
| `reception.errors.tareTypeUnknown` | Такого виду тари немає. Оновіть сторінку й оберіть зі списку. | That tare type doesn't exist. Reload the page and pick from the list. |
| `reweigh.errors.tareUnknown` | Такого типу тари немає або його вимкнено. Оновіть сторінку й оберіть зі списку. | That tare type is unknown or switched off. Reload the page and pick from the list. |
| `day.errors.notOpen` | Зміну не відкрито. Відкрийте її в «Касі за день». | The shift isn't open. Open it in «Cash for the day». |
| `transfer.errors.pointInactive` | Цю точку деактивовано. Оберіть іншу. | That point is deactivated. Choose another. |
| `transfer.errors.voided` | Цей переказ анульовано. Оновіть сторінку. | This transfer was voided. Reload the page. |
| `transfer.errors.alreadyAnswered` | На цей переказ уже відповіли. Оновіть сторінку. | This transfer was already answered. Reload the page. |
| `transfer.errors.alreadyResolved` | Цей спір уже врегульовано. Оновіть сторінку. | This dispute is already resolved. Reload the page. |
| `void.errors.alreadyVoided` | Документ уже анульовано. Оновіть сторінку. | The document is already voided. Reload the page. |

For `day.errors.notOpen` en, keep the existing en name of «Каса за день». Read it from
`en.json` `nav.*` and do not invent one. More generally, wherever an `en` value in these
tables names a domain thing (allotment, receipt, balance, tare), the noun the current `en`
value already uses for it wins over this table's.

- [ ] **Step 2: Sweep the remaining error values**

Run:

```bash
node -e "const u=require('./frontend/src/shared/lib/i18n/locales/uk.json');const w=(n,p)=>{for(const[k,v]of Object.entries(n)){const q=p?p+'.'+k:k;if(typeof v==='object')w(v,q);else if(/(^|\.)errors\.|[Ff]ailed|somethingWentWrong/.test(q))console.log(q+' = '+v)}};w(u,'')"
```

Read every line. A value passes when it either:
- states what happened and the next step; or
- is an inline field hint whose next step is in the hint itself, such as «Введіть суму,
  напр. 4000 або 4000.50».

Fix any other value in both locales. List each one fixed in the task report.

- [ ] **Step 3: Run the tests, update `en` expectations, check locales**

Run: `npx vitest run --root frontend`
Some tests assert old `en` copy. Update each expectation to the new value, and change
nothing else in those tests.
Run: `npm run typecheck -w frontend && npm run i18n:locales && npm run i18n:plain-text`
Expected: PASS.

- [ ] **Step 4: Run `npm run verify`, then commit**

```bash
git add frontend/src/shared/lib/i18n/locales frontend/src
git commit -m "fix(i18n): every error message says what happened and what to do"
```

---

### Task 11: guidance, docs, and the full gate

**Files:**
- Modify: `frontend/CLAUDE.md` (section `## i18n`, the `api-error/` tree line, and the
  stale `LoginForm` / react-hook-form line)
- Modify: `backend/CLAUDE.md` (the Errors bullet)

- [ ] **Step 1: `frontend/CLAUDE.md`, section «i18n»**

Append after the paragraph on `register(name, { validate })`:

```markdown
**Error and status messages — the tone rule (#52).** At most two short sentences: what
happened, in the user's words, then what to do. No codes, no English terms in `uk`, never a
bare «Помилка». Good: «Цю точку деактивовано. Оберіть іншу.» Bad: «POINT_UNUSABLE»,
«Request failed», «Не вдалося» on its own.

**A failed request reaches the screen only through `shared/lib/api-error`.** Use
`apiErrorToBanner` for a banner or toast, or a slice's `apiErrorToFields` mapper for a form.
Both put `statusKey` (network / 429 / 403 / 5xx) ahead of the caller's fallback. Never
render `error.message`, `ApiError.details` or `String(err)`: that is English text from the
server, meant for a log. Map codes exactly, never by suffix. A new backend code is mapped
where it surfaces or excused in `scripts/verify/baselines/error-codes.json`; the
`error-codes` verify row fails otherwise.
```

Fix the `api-error/` line in the tree. Replace «imported directly by nine call sites today …»
with «plus `statusKey`, the shared network/429/403/5xx sentence; grep
`from '@/shared/lib/api-error'` for its callers». Leave no count in the text.

Fix the stale line (around `frontend/CLAUDE.md:198`) that says `LoginForm` uses plain
`useState` and react-hook-form lives only in `useFormDraft`. State what is true today:
`LoginForm` uses `useState`; the dialogs use react-hook-form; `ApiError.details` feeds each
slice's `apiErrorToFields`. Read the paragraph before editing and change only those claims.

- [ ] **Step 2: `backend/CLAUDE.md`, the Errors bullet**

Add a sentence to the bullet:

```markdown
Every 4xx a user can trigger carries a machine `code` (`throw new XException({ message, code })`
— the filter passes `code` and other extras through); the frontend maps `code` to Ukrainian
copy and never shows `message`, which stays English and log-facing. A new code needs a
frontend mapping or an `error-codes` baseline entry, or `npm run verify` fails.
```

- [ ] **Step 3: Run the full gate**

Run: `npm run verify:full`
Expected: green. Quote the verdict line, and name every row that was SKIPPED and why. If
there is no Docker daemon, `smoke` and the DB rows skip; say so.

- [ ] **Step 4: Manual check on the local stack**

Start the stack with `docker compose up -d`, then `npm run db:seed`, and open the frontend.
Record each outcome in the report:
1. At `/login`, eleven wrong passwords in under a minute. The eleventh shows «Забагато
   спроб. Зачекайте хвилину й спробуйте знову.»
2. Run `docker compose stop backend`, then submit the login form. It shows «Немає зв'язку із
   сервером…». Restart with `docker compose start backend`.
3. As the only owner, open your own user and untick «active». You get «Не можна вимкнути чи
   понизити себе…».

If Docker is unavailable, say so and skip this step. Do not claim it ran.

- [ ] **Step 5: Commit**

```bash
git add frontend/CLAUDE.md backend/CLAUDE.md docs/superpowers/specs/2026-10-07-i18n-error-messages-design.md docs/superpowers/plans/2026-10-07-i18n-error-messages.md
git commit -m "docs: the tone rule for messages and the no-server-text rule (#52)"
```

- [ ] **Step 6: Update the PR**

Change the PR body's «Part of #52» to «Closes #52». Add a section «Review response» that
answers each of dz-vadim's items 1–8 and the minor items with the commit that addresses it,
and that names the copy table in Task 10 as the content to review. Ask the user before
running `gh pr edit` or pushing.
