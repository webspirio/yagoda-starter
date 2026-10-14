# i18n error messages — design

**Date:** 2026-10-07 · **Status:** approved in chat (brainstorming, 2026-10-07) · **Issue:** #52 ·
**PR:** #217 (this work lands there and the PR becomes «Closes #52»)

## Problem

#52 asks that every error and message the client shows be Ukrainian, short, and say what to
do next, and that the AI agent be told to write them that way. PR #217 gated **literal** UI
text (`plain-text`, `locales`, spec `2026-10-06-i18n-verify-rows-design.md`). Three gaps
remain.

1. **The two new rows can go green without checking anything.** This is the review of #217
   by dz-vadim and the automated reviewer, and every point below was reproduced against
   `5357340`:
   - `locales` prints a positive verdict when `uk.json` is missing, or when no plural family
     exists;
   - a locale file whose name `Intl` does not know is checked against the host machine's
     grammar (`new Intl.PluralRules('xx')` resolves to the system locale);
   - a file-wide `plain-text` exception also excuses every string added to that file later;
   - plus false positives and misses: HTML entities, `{{- name}}`, `toast*` prefix
     matching, and keys returned from `validate`.
2. **Server text reaches the screen.**
   - `LoginForm.tsx:32-38` renders `ApiError.message` for every code except
     `INVALID_CREDENTIALS`. The user can therefore see `ThrottlerException: Too Many Requests`
     (429 after ten attempts), `Request failed with status 0` (no network), English
     class-validator text, or `Internal server error`.
   - Elsewhere the text is translated but empty of help. About twenty backend codes are never
     mapped, so the user reads a bare «Не вдалося зберегти» even when the cause is known
     (`LAST_OWNER`, `SELF_LOCKOUT`, `POINT_UNUSABLE`, `TRANSFER_EMPTY`, …).
   - The users mapper matches `endsWith('_LOGIN_TAKEN')`, but the backend throws
     `LOGIN_TAKEN`. A taken login therefore shows the generic banner, not the field error.
3. **Nothing tells the writer how to word a message.** No `CLAUDE.md` or skill says so, and
   most `*.errors.*` values say what failed but not what to do.

## Outcome

- **Part A.** `plain-text` and `locales` refuse a verdict they did not earn, and lose their
  false positives.
- **Part B.** No server-provided string is rendered anywhere in the frontend. Every reachable
  backend `code` maps to its own message. A failure with no usable code (network, 429, 403,
  5xx) maps to a shared message by status.
- **Part C.** Every error value in `uk.json` and `en.json` follows the tone rule. The rule is
  written down for the agent.
- **Part D.** A new fast-tier row, `error-codes`, keeps the backend's codes and the
  frontend's mapping from drifting apart.

Out of scope:

- 404 bodies. They stay code-less: the existing banner doc explains why some 404s
  deliberately say nothing, such as an operator probing another point's document. They reach
  the screen as the caller's translated fallback.
- Translating the backend's `message` field. It stays English and log-facing.
- The «unused locale key» rule, already dropped in the 2026-10-06 spec (D10).

## Decisions (settled with the user)

| # | Decision |
|---|---|
| D1 | All four parts land in #217; the PR closes #52. One review cycle. |
| D2 | A new verify row, not just guidance: «переконатись» must be re-checkable, not a one-off audit. |
| D3 | Cross-cutting messages get a new top-level `errors.*` namespace. Existing `void.errors.*`, `day.errors.*`, … keep their names (the banner module's «namespaces are historical» rule). |
| D4 | A status layer sits **between** the code map and the caller's fallback. A known code still wins, so `OWNER_ONLY` keeps its own sentence on a 403. |
| D5 | Suffix matching on codes (`endsWith('_NAME_TAKEN')`) is replaced by exact codes. Suffix matching caused the `LOGIN_TAKEN` bug, and it makes a reference invisible to D2's row. |
| D6 | `PAYOUT_NOT_VOIDED` and `RETURN_ALREADY_SETTLED` are not mapped: nothing in the frontend calls `settle-return` (YAGNI). They go in the row's baseline, dated and reasoned. |

## Part A — review fixes to `plain-text` / `locales`

Numbering follows dz-vadim's review.

| # | Change | Where |
|---|---|---|
| A1 | `locales` requires a locale file for every entry of `SUPPORTED_LANGUAGES`, read by AST from `frontend/src/shared/lib/i18n/language-preference.ts`. Duplicating the list in the check would drift. A language listed there with no file is RED. A locale file not listed there is RED too, because the app would never load it. If the list cannot be read, the row refuses its verdict. | `checks/locales.mjs` |
| A2 | `refuseEmptyScan` on the number of plural families. The repo has one today (`transfer.dispute.sent_*`); losing it must not silently switch off the plural sub-check. | `checks/locales.mjs` |
| A3 | A locale whose name `Intl` does not support is RED: `Intl.PluralRules.supportedLocalesOf([lang])` is empty, or the language subtag of `resolvedOptions().locale` is not `lang`. This makes the verdict independent of the host's default locale. | `checks/locales.mjs` |
| A4 | An exception with no `text` must carry `count`: the number of candidates it accepts in that file. More candidates than `count` is RED («new text in an excused file»). Fewer is also RED, with «lower count to N»: the ratchet turns one way, and the entry can never keep excusing text that is gone. `UiKitPage.tsx` gets its current count. | `checks/plain-text.mjs`, `baselines/plain-text.json` |
| A5 | JSX text is stripped of HTML character references (`&nbsp;`, `&times;`, `&#…;`) before the letter test, so `<td>&nbsp;</td>` is not text. | `lib/frontend-i18n.mjs` |
| A6 | `PLACEHOLDER` accepts i18next's unescaped form: `/\{\{-?\s*([^,}\s]+)[^}]*\}\}/g`. | `checks/locales.mjs` |
| A7 | The toast callee is exactly `toast`, `toast.<method>`, or a name bound by `import { toast as X } from 'sonner'`. The local wrappers `toastSuccess` / `toastError` are matched by name, from a fixed set beside the rule. `toastIdFor(…)` no longer matches. | `lib/frontend-i18n.mjs` |
| A8 | Key uses also include string literals returned by a `validate` function, and `message` values, inside the options object of `register(…)` and `setError(…)`. These are the bare keys that `Field` resolves with `t()` (`frontend/CLAUDE.md`, i18n). A typo there becomes RED instead of reaching the screen raw. | `lib/frontend-i18n.mjs` |

Minor items:

- The reason-length floor of 30 characters is dropped; a non-empty `reason` is required.
  Verify-skill rule 7 names the length rule as the anti-pattern.
- `DateStepper`'s `todayLabel` prop is removed. Its two callers stop passing `day.today` /
  `pointCash.today`, and those two keys are deleted, so `common.today` is the only key left.
- The header of `frontend-i18n.mjs` drops «parsed once». The guarantee it actually gives is
  one enumeration; each row is its own process and parses again.

Each A-item's `proves` / `blindSpot` text in `registry.mjs` is updated to match exactly what
the command now establishes.

## Part B — no server text on screen

### Shared status layer

`shared/lib/api-error` gains one exported function:

```ts
/** The shared message for a failure whose cause no code explains, or undefined. */
export function statusKey(error: unknown): string | undefined
//   ApiError status 0   → 'errors.network'
//   status 429          → 'errors.tooManyRequests'
//   status 403          → 'errors.accessChanged'
//   status >= 500       → 'errors.server'
//   anything else       → undefined
```

`apiErrorToBanner` resolves in this order:

1. `overrides[code]`
2. `CODE[code]`
3. `statusKey(error)`
4. `fallback`

Each of the seven `apiErrorToFields` mappers uses `statusKey(error) ?? <its fallback>`
wherever it returns its form-level fallback today. Query error states that show
`common.somethingWentWrong` are left as they are: a failed GET has no action-specific
sentence to lose.

`INSUFFICIENT_ROLE` and `WRONG_COLLECTION_POINT`, the two 403s that do carry a code, are
added to `CODE` → `errors.accessChanged`. They are referenced by name rather than reached
only through the status, so the D-row sees them.

### Login

`LoginForm` stops reading `error.message`. It renders `auth.invalidCredentials` when the
code is `INVALID_CREDENTIALS`, or when the status is 401 with no code; on this form both
mean bad credentials, which is what it does today. In every other case it renders
`t(apiErrorToBanner(error, 'auth.loginFailed'))`.

There is no login-specific 429 sentence. `overrides` is keyed by code, and the throttler's
429 carries none. `errors.tooManyRequests` is therefore worded so that it also fits the login
form: too many attempts, wait a minute, then try again.

### Exact codes and newly mapped codes

The suffix matchers in `edit-supplier`, `catalog`, `users` and `points` become exact code
lists. Codes mapped for the first time:

| Code | Surface | Where |
|---|---|---|
| `LOGIN_TAKEN` (was mismatched) | field `login` | `pages/users/lib/apiErrorToFields.ts` |
| `LAST_OWNER`, `SELF_LOCKOUT`, `OPERATOR_NEEDS_POINT`, `OWNER_HAS_NO_POINT`, `POINT_UNUSABLE` | banner (field where the form has one) | users mapper |
| `USER_NAME_EMPTY` | field | users mapper |
| `PRODUCT_GRADE_INACTIVE`, `DUPLICATE_COLLECTION_POINT` | banner | `pages/prices/lib/apiErrorToFields.ts` |
| `CHANGES_PERIOD_REVERSED`, `CHANGES_PERIOD_TOO_LONG`, `INVALID_DATE` | query error state | `PriceChanges` via `apiErrorToBanner` |
| `TRANSFER_EMPTY` | banner | `CODE` |
| `TOP_UP_AMOUNT_NOT_POSITIVE` | banner | `CODE` |
| `EXPENSE_AMOUNT_NOT_POSITIVE`, `LABEL_EMPTY` | toast | `CODE`, via `ExpensesPanel` |
| `INTAKE_CODE_TAKEN`, `PAYOUT_CODE_TAKEN` | banner («someone saved at the same moment — try again») | reception / settle-payout mappers, replacing «deliberately unmapped» |
| `DOCUMENT_CODE_INVALID`, `POINT_REQUIRED`, `COLLECTION_POINT_REQUIRED` | wherever the implementation finds the call that can raise it; otherwise baseline with a reason | — |

The implementation plan pins each one to a file. A code that turns out to be unreachable from
any UI path goes in the D-row baseline, stating why, rather than getting a message nobody
can see.

### `PayoutDialog`

`PayoutDialog.tsx:106` stores the key and params (`{ key, params }`) instead of an
already-translated sentence, so a language switch re-renders the message.

## Part C — tone and agent guidance

**The rule.** Two short sentences at most. The first says what happened, in the user's
terms. The second says what to do. No codes, no English terms, no «помилка» as the whole
message. A message whose only honest advice is «try again» says that.

**What gets rewritten.** Every value under an `errors` object, every `*failed` /
`*Failed` / `saveFailed` key, and `common.somethingWentWrong`. That is 144 keys in
`uk.json`, with the matching `en.json` values. The new `errors.*` keys are written to the
rule from the start. The `locales` row guarantees parity and placeholders survive the
rewrite. The tone itself is judged in review: no gate claims to measure it, and the row's
`blindSpot` already says so.

**Where the rule is written down.**

- `frontend/CLAUDE.md`, section i18n:
  - the tone rule, with one good and one bad example;
  - «a failed request reaches the screen only through `apiErrorToBanner` / a mapper; never
    render `error.message`»;
  - a new backend code is mapped where it surfaces, or listed in the `error-codes` baseline.
- `backend/CLAUDE.md`, section on Errors: every 4xx a user can trigger carries a `code`;
  `message` is English and for logs only. This line also corrects the paragraph's silence
  on the `code` passthrough.
- The stale `frontend/CLAUDE.md` lines about `LoginForm` using plain `useState` and the
  «nine call sites» count are corrected while that section is open. Only the lines this work
  touches are changed.

## Part D — the `error-codes` row

- **Row:** `error-codes`, fast tier, `npm run i18n:error-codes`. Syntax-only parse, no
  `after`, same as its siblings.
- **Backend side.** Every string literal matching `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$` in
  `backend/src/**/*.ts`. Files come from `git ls-files`; spec files, `testing/`,
  `migrations/` and `seed/` are excluded; comments are not literals. This catches every way a
  code is written today: `code: 'X'`, `assertTrimmedName(…, 'X')` and `bad(msg, 'X')`. Today
  that is 81 literals, of which one is not a code (`REDIS_CLIENT`).
- **Frontend side.** String literals and object-literal property names that match the same
  pattern, in the same file set `plain-text` scans. The enumeration is shared through
  `lib/frontend-i18n.mjs`.
- **RED when:**
  - a backend code has no frontend reference and no baseline entry;
  - the frontend references an UPPER_SNAKE name the backend never produces (the
    `LOGIN_TAKEN` class of drift, from the other side);
  - a baseline entry matches nothing.
- **Baseline.** `scripts/verify/baselines/error-codes.json`, entries
  `{ code, date, reason }`; the reason must be non-empty. One entry excuses that exact name on
  whichever side it appears, so a frontend UPPER_SNAKE constant that is not a code can be
  excused the same way. Expected entries:
  - `REDIS_CLIENT` (a DI token);
  - `PAYOUT_NOT_VOIDED` and `RETURN_ALREADY_SETTLED` (D6);
  - `BUSINESS_DATE_MALFORMED` (built from server-side data, not input);
  - anything Part B's table proves unreachable.
- **Empty scan.** `refuseEmptyScan` on backend files, frontend files and the backend code
  count.
- **proves.** Every UPPER_SNAKE literal in backend source is named somewhere in shipped
  frontend source or excused individually in the baseline. Every UPPER_SNAKE name in
  frontend source is one the backend produces.
- **blindSpot.**
  - A reference is not a correct mapping: the code may be named in a mapper that sends it to
    the wrong sentence, or merely compared against.
  - A code assembled at runtime is invisible.
  - Failures with no code (404, class-validator 400, pipe 400s) are covered only by Part B's
    status layer and the caller's fallback, never by this row.
  - The message's wording is not judged.

## Testing

- **A1–A8.** Each item gets a fixture test in the row's `.test.mjs` that is RED before the
  change and GREEN after: the exact probes from the review (`checkLocales` with `en` only,
  with no plural family, with `xx.json`; the `UiKitPage`-style count; `&nbsp;`;
  `{{- name}}`; `toastIdFor`; `toast as notify`; a `validate` returning a missing key).
- **`error-codes`.**
  - Unit tests on fixture trees: an unmapped code, a frontend-only name, a stale baseline
    entry, a `bad(msg, 'X')` code, a property-name reference.
  - One real-repo test with an independently derived discriminator: the backend code count
    obtained by a separate `git grep`.
- **Part B.** Vitest:
  - `statusKey` for 0 / 403 / 429 / 500 / 404;
  - the precedence order in `apiErrorToBanner`;
  - every touched mapper for its new exact codes and its `statusKey` fallback;
  - `LoginForm` rendering for 401, 429, status 0 and 500, asserting that no `ApiError.message`
    text appears;
  - `PayoutDialog` re-rendering its error after a language switch.
- **Gates.**
  - `npm run verify` (fast tier).
  - `npm run verify:full`, because the frontend production build and `tsc -b` are where a
    removed prop or a renamed key would fail (see memory: Vitest does not typecheck).
  - Skips are named.
- **Manual.** On the local stack:
  - ten bad logins, then the eleventh shows the 429 sentence in Ukrainian;
  - with the backend stopped, login shows the network sentence;
  - deactivating the last owner shows `LAST_OWNER`'s sentence.
