# i18n verify rows — design

**Date:** 2026-10-06 · **Status:** approved in chat (grilling + brainstorming, 2026-10-06) · **Issue:** #52

## Problem

Nothing stops untranslated text from reaching the UI. A hardcoded `<span>Close</span>` or
`aria-label="Попередній день"` passes every gate today. Locale health is checked only by
`frontend/src/shared/lib/i18n/locales.test.ts`: key parity and plural forms between `en.json`
and `uk.json`. Three gaps remain:

- an empty translation (`""`, or only whitespace) is never caught;
- a `{{placeholder}}` that is present in one locale and missing from the other is never caught;
- a key that the code calls but no locale defines, such as `t('reception.sumbit')`, renders as
  the raw key on screen, and nothing catches it.

## Outcome

Two new **fast-tier** verify rows, `plain-text` and `locales`. Because they are verify rows,
the existing `Stop` hook, `.githooks/pre-push` and CI run them with no new hook.
The current plain-text findings are fixed on this branch, and the few real exceptions are
recorded in a central baseline.

Out of scope:

- backend messages: they are English developer-facing text, and the client branches on
  `code` / `reason`;
- a «show the translation by `code` instead of the raw `message`» pass (#52's feature work);
- agent instructions about message tone (#52);
- an «unused locale keys» rule.

## Decisions (settled with the user)

| # | Decision |
|---|---|
| D1 | A deterministic scanner, not an agent/prompt hook. A deterministic check gives the same answer every run, costs no tokens and can run in CI. |
| D2 | No new Claude Code hook. The checks are verify rows, so the current `Stop` hook, `.githooks/pre-push` and CI pick them up. |
| D3 | The scan covers `frontend/src` only. The backend is out of scope (see Outcome). |
| D4 | Two rows, not one: they answer different questions and fail for different reasons. |
| D5 | `locales.test.ts` is deleted and its logic moves into the `locales` row. One copy of a check, not two copies that drift. |
| D6 | Exceptions live in one central file, `scripts/verify/baselines/plain-text.json`. There are **no inline ignore comments**: inline comments scatter across the code, and an agent reaches for one faster than it writes `t()`. |
| D7 | Exception criterion: text that a production user never sees as a phrase in their language. aria text counts as seen, because a screen reader speaks it. |
| D8 | The whole tree is scanned. There is no diff mode and no ratchet: current findings are fixed or excepted on this branch, so the row starts green with zero baseline debt. |
| D9 | `plain-text` checks only a fixed list of attributes. Name-suffix heuristics (`*Label`, `*Text`, …) were considered and dropped as overhead. |
| D10 | The `locales` row checks that keys used in code exist in the locales: the literal first argument of `t()` / `i18n.t()` must be a defined key. There is no «unused key» rule: about 20 template-literal keys (`` t(`status.${x}`) ``) would make it a false-positive generator. |

## Components

- **`scripts/verify/lib/frontend-i18n.mjs`** is shared by both rows. It:
  - lists `frontend/src/**/*.{ts,tsx}` using `git ls-files` under `scanRoot()`;
  - excludes `*.test.*`, `test-setup*` and anything under a `locales/` directory;
  - parses each file once with `ts.createSourceFile`, syntax only. No `after: ['typecheck']`,
    for the same reason given on `migrations` / `schema`.

  It returns plain-text candidates `{ file, line, col, rule, text }` and static `t()` keys
  `{ file, line, col, key }`.
- **`scripts/verify/checks/plain-text.mjs`** + `.test.mjs` provide row `plain-text`, run by
  npm script `i18n:plain-text`.
- **`scripts/verify/checks/locales.mjs`** + `.test.mjs` provide row `locales`, run by npm
  script `i18n:locales`.
- **`scripts/verify/baselines/plain-text.json`** holds the exceptions.
- **Deleted:** `frontend/src/shared/lib/i18n/locales.test.ts`.
- **Frontend fixes:** new keys in `en.json` / `uk.json`, and `t()` in place of each literal.

Both checks follow the layer's rules:

- each takes `--root` / `VERIFY_SCAN_ROOT`;
- fixtures live in `mkdtempSync` directories;
- an empty scan calls `refuseEmptyScan`;
- `proves` / `blindSpot` are 40–80 words, with no hand-written numbers.

## `plain-text` rules

A node is flagged when its text, trimmed and with whitespace collapsed, contains at least one
letter (`\p{L}`). Punctuation, `—`, `·`, `₴` and digits alone are never flagged. Comments are
not AST nodes, so they are never read. Regex literals are not string literals, so they are
never read either.

1. **JSX text**, for example `<span>Close</span>`.
2. **A JSX attribute** whose value is a string literal, or `{'…'}` / `` {`…`} `` with no
   substitutions. The attribute name must be one of `placeholder`, `title`, `alt`, `label`,
   `description`, `aria-label` or `aria-description`.
3. **A toast call.** The callee must be one of:
   - `toast`;
   - `toast.<anything>`;
   - an identifier starting with `toast` (`toastSuccess` / `toastError` from `shared/ui/toast.ts`).

   Flagged arguments are a literal first argument, and a literal `description` property in an
   object-literal second argument.
4. **Any string or template literal containing Cyrillic** (`[Ѐ-ӿ]`), anywhere in a
   scanned file.

A node that matches several rules is reported once, under the first rule it matched.

**Expressions** (added after the final review): rules 1–3 also follow a JSX expression:
- a JSX child expression (`{'Close'}`) counts as JSX text;
- through rules 1–3, the scanner follows parentheses, both branches of a ternary, and either
  side of `&&`, `||` or `??`;
- a template literal with substitutions (`` title={`Step ${n}`} ``) counts when its literal
  parts contain a letter.

Conditions, calls and comparisons are not followed: `x === 'warning'` is never text.

**Report line:** `path:line:col  rule  "text"`. The line number is for navigation only and is
never part of a key.

**Exceptions** (`baselines/plain-text.json`) are an array of entries, each of one of two shapes:

```json
{ "file": "frontend/src/pages/ui-kit/ui/UiKitPage.tsx", "date": "2026-10-06", "reason": "…" }
{ "file": "frontend/src/app/providers/ErrorFallback.tsx", "text": "Unhandled error", "date": "2026-10-06", "reason": "…" }
```

- A file entry excepts every finding in that file. A text entry excepts findings in that file
  whose normalised text equals `text`.
- `reason` is required, and is at least 30 characters once trimmed. `date` is `YYYY-MM-DD`.
- An entry that matches no finding is **FAILED** («stale exception — delete it»), so an
  exception cancels itself once the thing it excused is gone.
- A file entry whose file no longer exists is stale too.

**Initial exceptions** (D7):

| Exception | Why it is excepted |
|---|---|
| `UiKitPage.tsx`, whole file | design-system showcase with deliberate mock data, not a product screen |
| `ErrorFallback.tsx` · `"Unhandled error"` | inside the `import.meta.env.DEV` branch only |

Anything else the first full run finds is fixed, not excepted, unless it meets D7. A new
exception is raised with the user rather than added silently. Known fixes:

| File | Fix |
|---|---|
| `dialog.tsx` | the `Close` text, both the sr-only span and the button |
| `spinner.tsx` | `aria-label="loading"` |
| `date-stepper.tsx` | the `'Сьогодні'` default and both aria-labels |
| `document-page.tsx` | `Друк` |
| `money/format.ts` `formatKg` | currently `'кг' : 'kg'`; switch to `Intl.NumberFormat` with `style: 'unit', unit: 'kilogram'`, if its output matches the current receipts, otherwise a locale key |

## `locales` rules

The checked files are every `frontend/src/**/locales/<lang>.json`, found at runtime. `en`
is the reference. An empty discovery refuses a verdict. Each rule below applies to every
non-reference locale, with keys flattened to dotted leaf paths.

1. **Key parity, both directions.** Plural suffixes (`_zero _one _two _few _many _other`) are
   normalised to the base key first.
2. **Plural completeness.** Every plural family carries, in each locale, every category
   `new Intl.PluralRules(lang).resolvedOptions().pluralCategories` lists for that locale. That
   is `one/other` for en and `one/few/many/other` for uk. The categories are derived, not
   hardcoded.
3. **No empty value.** A leaf that is not a string, a string that is empty after `trim()`, or
   an empty object fails.
4. **Placeholder parity.** The set of `{{name}}` placeholders (for `{{count, number}}`, only
   `name` is taken) must be equal across locales for every key. For a plural family the sets
   compared are the union over all its forms, because a uk `_one` may legitimately omit
   `{{count}}`.
5. **Code keys exist.** Every literal first argument of `t(...)` or `i18n.t(...)` in the scanned
   frontend files must exist in `en`, either as a leaf or as a plural base. Keys are absolute:
   the code uses no `keyPrefix` and no namespaces (checked 2026-10-06).

Each rule reports every violation with its locale, key and, for rule 5, `path:line:col`.

## Blind spots (to be stated in each row's `blindSpot`)

**`plain-text`** does not see:

- a Latin-only literal outside JSX text, the listed attributes and toast calls, for example
  `header: 'Supplier'` in a column definition;
- text built at runtime;
- text the backend sends.

Whether a translation is good is outside it entirely.

**`locales`** does not check:

- template-literal or variable keys passed to `t()`;
- unused keys;
- whether a uk value is actually Ukrainian rather than a copy of en.

## Testing

Each check gets a `node --test` file whose fixtures are throwaway trees in `mkdtempSync`.
Every rule has a red fixture and a discriminating green one. For example, `t('x')` inside JSX
is not flagged, and the same file with `Close` is. The stale-exception path and the
empty-scan refusal are each tested. At most one test asserts the real repository is green,
per verify rule 2.

Proof for the turn: `npm run verify` (fast tier). The frontend fixes are application code, so
`npm test` in `frontend` is covered by the `test` row. The `bundle` row is not affected
beyond new locale strings; `verify:full` runs before the PR because a locale JSON change
feeds the bundle budget.
